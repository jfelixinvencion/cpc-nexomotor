import { NextRequest, NextResponse } from "next/server";
import { sigmaLogin } from "@/lib/sigma/client";
import { getStoredToken } from "@/lib/sigma/token";
import { supabaseAdmin } from "@/lib/supabase/admin";

type SyncMode = "recent" | "full";

type SigmaWorkOrder = {
  id: number;
  number?: number | string | null;
  status?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
};

type OtPageResponse = {
  code?: number;
  message?: string;
  data?: {
    work_orders?: SigmaWorkOrder[];
    pagination?: {
      total?: number;
      per_page?: number;
      current_page?: number;
      last_page?: number;
    };
  };
};

type OrdenTrabajoRow = {
  source_id: number;
  payload: SigmaWorkOrder;
  work_order_number: string | null;
  status: string | null;
  created_at: string | null;
  fetched_at: string;
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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} no está definido`);
  }
  return value;
}

function requireTenantId(): string {
  return requireEnv("SIGMA_TENANT_ID");
}

function getOtEndpoint(): string {
  return requireEnv("SIGMA_OT_ENDPOINT");
}

function getPerPage(): number {
  const raw = process.env.SIGMA_OT_PER_PAGE;
  const n = raw ? Number(raw) : 50;
  if (!Number.isFinite(n) || n < 1) return 50;
  return Math.floor(n);
}

function getMaxPages(): number {
  const raw = process.env.SIGMA_OT_MAX_PAGES;
  const n = raw ? Number(raw) : 100;
  if (!Number.isFinite(n) || n < 1) return 100;
  return Math.floor(n);
}

function getStoreId(): string {
  return process.env.STORE_ID || process.env.SIGMA_STORE_ID || "1";
}

/** Parse Sigma created_at to ISO timestamptz string, or null. */
function toTimestamptz(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function buildPageUrl(page: number, perPage: number): string {
  const url = new URL(getOtEndpoint());
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("work_order_is_quote", "0");
  url.searchParams.append("store_ids[]", getStoreId());
  return url.toString();
}

async function fetchOtPage(
  token: string,
  page: number,
  perPage: number
): Promise<OtPageResponse> {
  const res = await fetch(buildPageUrl(page, perPage), {
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

  return (await res.json()) as OtPageResponse;
}

async function getMaxCreatedAt(): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("ordenes_trabajo_raw")
    .select("created_at")
    .not("created_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo leer max(created_at): ${error.message}`);
  }

  return data?.created_at ?? null;
}

function toRow(
  wo: SigmaWorkOrder,
  fetchedAt: string
): OrdenTrabajoRow | null {
  if (typeof wo.id !== "number" || !Number.isFinite(wo.id)) {
    return null;
  }

  return {
    source_id: wo.id,
    payload: wo,
    work_order_number:
      wo.number != null && wo.number !== "" ? String(wo.number) : null,
    status: wo.status != null && wo.status !== "" ? String(wo.status) : null,
    created_at: toTimestamptz(wo.created_at),
    fetched_at: fetchedAt,
  };
}

/**
 * Upsert por página.
 * ON CONFLICT (source_id) DO UPDATE de payload, work_order_number, status,
 * fetched_at y created_at. Si created_at entrante es null, se omite en el
 * payload de update para aproximar COALESCE(EXCLUDED.created_at, existing).
 */
async function upsertPageRows(rows: OrdenTrabajoRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  const payload = rows.map((row) => {
    if (row.created_at != null) return row;
    const { created_at: _omit, ...rest } = row;
    void _omit;
    return rest;
  });

  const { error } = await supabaseAdmin
    .from("ordenes_trabajo_raw")
    .upsert(payload, { onConflict: "source_id" });

  if (error) {
    throw new Error(error.message);
  }

  return rows.length;
}

function pageAllOlderOrEqual(
  list: SigmaWorkOrder[],
  maxCreatedAt: string
): boolean {
  if (list.length === 0) return false;
  const maxMs = new Date(maxCreatedAt).getTime();
  if (Number.isNaN(maxMs)) return false;

  return list.every((wo) => {
    const ts = toTimestamptz(wo.created_at);
    if (ts == null) return false;
    return new Date(ts).getTime() <= maxMs;
  });
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const mode = parseMode(request.nextUrl.searchParams.get("mode"));
  const perPage = getPerPage();
  const maxPages = getMaxPages();
  const errors: string[] = [];

  let pagesFetched = 0;
  let lastPage = 1;
  let stoppedEarly = false;
  let fetched = 0;
  let upserted = 0;

  try {
    getOtEndpoint();

    let effectiveMode: SyncMode = mode;
    let maxCreatedAt: string | null = null;

    if (mode === "recent") {
      maxCreatedAt = await getMaxCreatedAt();
      if (maxCreatedAt == null) {
        effectiveMode = "full";
      }
    }

    let token = await getStoredToken();
    if (!token) {
      token = await sigmaLogin();
    }

    let page = 1;
    for (;;) {
      if (page > maxPages) {
        stoppedEarly = true;
        errors.push(
          `Se alcanzó SIGMA_OT_MAX_PAGES=${maxPages}; sync detenido.`
        );
        break;
      }

      let payload: OtPageResponse;
      try {
        try {
          payload = await fetchOtPage(token, page, perPage);
        } catch (err) {
          if (isSigmaAuthError(err)) {
            token = await sigmaLogin();
            payload = await fetchOtPage(token, page, perPage);
          } else {
            throw err;
          }
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Error desconocido en página";
        console.error(`[sync-work-orders] page ${page}:`, message);
        errors.push(`page ${page}: ${message}`);
        pagesFetched += 1;
        page += 1;
        continue;
      }

      const list = Array.isArray(payload.data?.work_orders)
        ? payload.data.work_orders
        : [];
      const pagination = payload.data?.pagination;
      lastPage = pagination?.last_page ?? page;
      pagesFetched += 1;

      if (
        effectiveMode === "recent" &&
        maxCreatedAt != null &&
        pageAllOlderOrEqual(list, maxCreatedAt)
      ) {
        stoppedEarly = true;
        break;
      }

      const fetchedAt = new Date().toISOString();
      const rows: OrdenTrabajoRow[] = [];

      for (const wo of list) {
        if (effectiveMode === "recent" && maxCreatedAt != null) {
          const woTs = toTimestamptz(wo.created_at);
          if (woTs != null && new Date(woTs).getTime() <= new Date(maxCreatedAt).getTime()) {
            // Skip already-seen older/equal items; keep scanning page for newer ones
            continue;
          }
        }

        const row = toRow(wo, fetchedAt);
        if (row) rows.push(row);
      }

      fetched += rows.length;

      try {
        upserted += await upsertPageRows(rows);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Error de upsert";
        console.error(`[sync-work-orders] upsert page ${page}:`, message);
        errors.push(`upsert page ${page}: ${message}`);
      }

      if (stoppedEarly) break;
      if (page >= lastPage) break;
      page += 1;
    }

    return NextResponse.json({
      success: errors.length === 0,
      mode: effectiveMode,
      requestedMode: mode,
      maxCreatedAt: effectiveMode === "recent" ? maxCreatedAt : null,
      pagesFetched,
      lastPage,
      stoppedEarly,
      fetched,
      upserted,
      errors,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido";
    console.error("[sync-work-orders] error:", message);
    return NextResponse.json(
      {
        success: false,
        mode,
        pagesFetched,
        lastPage,
        stoppedEarly,
        fetched,
        upserted,
        errors: [...errors, message],
        error: message,
      },
      { status: 200 }
    );
  }
}
