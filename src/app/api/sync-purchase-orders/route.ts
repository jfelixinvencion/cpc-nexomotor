import { NextRequest, NextResponse } from "next/server";
import { sigmaLogin } from "@/lib/sigma/client";
import { getStoredToken } from "@/lib/sigma/token";
import { supabaseAdmin } from "@/lib/supabase/admin";

const BATCH_SIZE = 500;
const SIGMA_OC_URL =
  "https://dms-api.sigma-peru.com/api/administration/logistics/purchase-order";
const PER_PAGE = 500;
const RECENT_DAYS = 30;

type SyncMode = "recent" | "full";

type SigmaPurchaseOrder = {
  id: number;
  number?: number | string | null;
  creation_date?: string | null;
  [key: string]: unknown;
};

type OcPageResponse = {
  data?: SigmaPurchaseOrder[];
  pagination?: {
    total?: number;
    per_page?: number;
    current_page?: number;
    last_page?: number;
  };
};

type OrdenCompraRow = {
  sigma_id: number;
  numero_oc: string | null;
  raw: SigmaPurchaseOrder;
  synced_at: string;
};

function isAuthorizedSyncRequest(request: NextRequest): boolean {
  const expected = process.env.SYNC_TRIGGER_SECRET;
  if (!expected) return false;
  const provided = request.headers.get("x-sync-secret");
  return provided === expected;
}

function isSigmaAuthError(err: unknown): boolean {
  return err instanceof Error && /Sigma error (401|403):/.test(err.message);
}

function parseMode(raw: string | null): SyncMode {
  if (raw === "full") return "full";
  return "recent";
}

function requireTenantId(): string {
  const tenantId = process.env.SIGMA_TENANT_ID;
  if (!tenantId) {
    throw new Error("SIGMA_TENANT_ID no está definido");
  }
  return tenantId;
}

function daysAgoDateOnly(days: number, now = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse Sigma creation_date (YYYY-MM-DD or ISO) to YYYY-MM-DD for comparison. */
function toDateOnly(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function buildPageUrl(page: number): string {
  const url = new URL(SIGMA_OC_URL);
  url.searchParams.set("per_page", String(PER_PAGE));
  url.searchParams.set("all_warehouses", "1");
  url.searchParams.append("store_ids[]", "1");
  url.searchParams.set("page", String(page));
  return url.toString();
}

async function fetchOcPage(
  token: string,
  page: number
): Promise<OcPageResponse> {
  const res = await fetch(buildPageUrl(page), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-tenant-id": requireTenantId(),
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Sigma error ${res.status}: ${await res.text()}`);
  }

  return (await res.json()) as OcPageResponse;
}

function toRow(po: SigmaPurchaseOrder, syncedAt: string): OrdenCompraRow | null {
  if (typeof po.id !== "number" || !Number.isFinite(po.id)) {
    return null;
  }

  return {
    sigma_id: po.id,
    numero_oc: po.number != null && po.number !== "" ? String(po.number) : null,
    raw: po,
    synced_at: syncedAt,
  };
}

async function upsertBatches(rows: OrdenCompraRow[]): Promise<number> {
  let upserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabaseAdmin
      .from("ordenes_compra")
      .upsert(batch, { onConflict: "sigma_id" });

    if (error) {
      throw new Error(error.message);
    }

    upserted += batch.length;
  }

  return upserted;
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const mode = parseMode(request.nextUrl.searchParams.get("mode"));
    const cutoff = daysAgoDateOnly(RECENT_DAYS);
    const syncedAt = new Date().toISOString();

    let token = await getStoredToken();
    if (!token) {
      token = await sigmaLogin();
    }

    const collected: OrdenCompraRow[] = [];
    let pagesFetched = 0;
    let lastPage = 1;
    let stoppedEarly = false;

    let page = 1;
    for (;;) {
      let payload: OcPageResponse;
      try {
        payload = await fetchOcPage(token, page);
      } catch (err) {
        if (isSigmaAuthError(err)) {
          token = await sigmaLogin();
          payload = await fetchOcPage(token, page);
        } else {
          throw err;
        }
      }

      const list = Array.isArray(payload.data) ? payload.data : [];
      lastPage = payload.pagination?.last_page ?? page;
      pagesFetched += 1;

      for (const po of list) {
        const row = toRow(po, syncedAt);
        if (row) collected.push(row);
      }

      if (mode === "recent") {
        const lastPo = list[list.length - 1];
        const lastDate = toDateOnly(lastPo?.creation_date);
        if (lastDate != null && lastDate < cutoff) {
          stoppedEarly = true;
          break;
        }
      }

      if (page >= lastPage) break;
      page += 1;
    }

    const upserted = await upsertBatches(collected);

    return NextResponse.json({
      success: true,
      mode,
      cutoff: mode === "recent" ? cutoff : null,
      pagesFetched,
      lastPage,
      stoppedEarly,
      fetched: collected.length,
      upserted,
      errors: [],
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido";
    console.error("[sync-purchase-orders] error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
