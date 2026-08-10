import { NextRequest, NextResponse } from "next/server";
import { sigmaLogin } from "@/lib/sigma/client";
import { getStoredToken } from "@/lib/sigma/token";
import { supabaseAdmin } from "@/lib/supabase/admin";

const LIST_URL =
  "https://report-api.sigma-peru.com/api/after-sales/work-orders";
const DETAIL_URL_BASE =
  "https://dms-api.sigma-peru.com/api/after-sale/work-order-spare/work-order";

const PER_PAGE = 100;
const LOOKBACK_DAYS = 30;
const DETAIL_CONCURRENCY = 4;
const INSERT_BATCH = 100;

type SigmaWorkOrderListItem = {
  id?: number;
  [key: string]: unknown;
};

type ListPageResponse = {
  code?: number;
  message?: string;
  data?: {
    work_orders?: SigmaWorkOrderListItem[];
    pagination?: {
      total?: number;
      per_page?: number;
      current_page?: number;
      last_page?: number;
    };
  };
  work_orders?: SigmaWorkOrderListItem[];
  pagination?: {
    last_page?: number;
    current_page?: number;
  };
};

type SigmaSpare = {
  code?: string | null;
  description?: string | null;
  quantity?: number | null;
  delivery_date?: string | null;
  [key: string]: unknown;
};

type SpareDetailPayload = {
  id?: number;
  work_order_number?: string | number | null;
  plate?: string | null;
  client_name?: string | null;
  spares?: SigmaSpare[];
  [key: string]: unknown;
};

type LogisticaInversaRow = {
  ot_id: number;
  ot_numero: string | null;
  placa: string | null;
  cliente_nombre: string | null;
  linea_codigo: string;
  linea_descripcion: string | null;
  linea_cantidad: number | null;
  linea_fecha_entrega: string;
  source_payload: SigmaSpare;
};

type DetailError = { id: number; error: string };

function isAuthorizedSyncRequest(request: NextRequest): boolean {
  const expected = process.env.SYNC_TRIGGER_SECRET;
  if (!expected) return false;
  const provided = request.headers.get("x-sync-secret");
  return provided === expected;
}

function isSigmaAuthError(err: unknown): boolean {
  return err instanceof Error && /Sigma error (401|403):/.test(err.message);
}

function requireTenantId(): string {
  const tenantId = process.env.SIGMA_TENANT_ID;
  if (!tenantId) {
    throw new Error("SIGMA_TENANT_ID no está definido");
  }
  return tenantId;
}

function dateOnlyDaysAgo(days: number, now = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateOnlyToday(now = new Date()): string {
  return dateOnlyDaysAgo(0, now);
}

function hasDeliveryDate(value: unknown): value is string {
  if (value == null) return false;
  const s = String(value).trim();
  return s.length > 0;
}

function extractWorkOrders(payload: ListPageResponse): SigmaWorkOrderListItem[] {
  if (Array.isArray(payload.data?.work_orders)) {
    return payload.data.work_orders;
  }
  if (Array.isArray(payload.work_orders)) {
    return payload.work_orders;
  }
  return [];
}

function extractLastPage(payload: ListPageResponse, fallback: number): number {
  return (
    payload.data?.pagination?.last_page ??
    payload.pagination?.last_page ??
    fallback
  );
}

function extractDetailData(json: unknown): SpareDetailPayload | null {
  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, unknown>;
  const nested = root.data;
  if (nested && typeof nested === "object") {
    const dataObj = nested as Record<string, unknown>;
    if (Array.isArray(dataObj.spares) || dataObj.id != null) {
      return dataObj as SpareDetailPayload;
    }
    const workOrder = dataObj.work_order;
    if (workOrder && typeof workOrder === "object") {
      return workOrder as SpareDetailPayload;
    }
  }
  if (Array.isArray(root.spares) || root.id != null) {
    return root as SpareDetailPayload;
  }
  return null;
}

async function fetchWorkOrderListPage(
  token: string,
  page: number,
  start: string,
  end: string
): Promise<ListPageResponse> {
  const res = await fetch(LIST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-tenant-id": requireTenantId(),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      work_order_type_operations: [2],
      entry_date_range: { start, end },
      is_quote: 0,
      per_page: PER_PAGE,
      page,
    }),
  });

  if (!res.ok) {
    throw new Error(`Sigma error ${res.status}: ${await res.text()}`);
  }

  return (await res.json()) as ListPageResponse;
}

async function fetchSpareDetail(
  tokenRef: { token: string },
  id: number,
  retried = false
): Promise<SpareDetailPayload | null> {
  const res = await fetch(`${DETAIL_URL_BASE}/${id}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${tokenRef.token}`,
      "x-tenant-id": requireTenantId(),
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (res.status === 401 || res.status === 403) {
    if (retried) {
      throw new Error(`detail ${id} failed: ${res.status} after relogin`);
    }
    tokenRef.token = await sigmaLogin();
    return fetchSpareDetail(tokenRef, id, true);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`detail ${id} failed: ${res.status} ${body}`);
  }

  const json = await res.json().catch(() => null);
  return extractDetailData(json);
}

function rowsFromDetail(detail: SpareDetailPayload): LogisticaInversaRow[] {
  if (typeof detail.id !== "number" || !Number.isFinite(detail.id)) {
    return [];
  }

  const spares = Array.isArray(detail.spares) ? detail.spares : [];
  const rows: LogisticaInversaRow[] = [];

  for (const spare of spares) {
    if (!hasDeliveryDate(spare.delivery_date)) continue;

    const codigo =
      spare.code != null && String(spare.code).trim() !== ""
        ? String(spare.code).trim()
        : null;
    if (!codigo) continue;

    rows.push({
      ot_id: detail.id,
      ot_numero:
        detail.work_order_number != null && detail.work_order_number !== ""
          ? String(detail.work_order_number)
          : null,
      placa:
        detail.plate != null && String(detail.plate).trim() !== ""
          ? String(detail.plate)
          : null,
      cliente_nombre:
        detail.client_name != null && String(detail.client_name).trim() !== ""
          ? String(detail.client_name)
          : null,
      linea_codigo: codigo,
      linea_descripcion:
        spare.description != null && String(spare.description).trim() !== ""
          ? String(spare.description)
          : null,
      linea_cantidad:
        typeof spare.quantity === "number" && Number.isFinite(spare.quantity)
          ? spare.quantity
          : spare.quantity != null && Number.isFinite(Number(spare.quantity))
            ? Number(spare.quantity)
            : null,
      linea_fecha_entrega: String(spare.delivery_date).trim(),
      source_payload: spare,
    });
  }

  return rows;
}

async function insertIgnoreDuplicates(
  rows: LogisticaInversaRow[]
): Promise<number> {
  if (rows.length === 0) return 0;

  let attempted = 0;
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH);
    const { error } = await supabaseAdmin.from("logistica_inversa").upsert(batch, {
      onConflict: "ot_id,linea_codigo,linea_fecha_entrega",
      ignoreDuplicates: true,
    });

    if (error) {
      throw new Error(error.message);
    }

    attempted += batch.length;
  }

  return attempted;
}

async function listWorkOrderIds(
  tokenRef: { token: string },
  start: string,
  end: string,
  errors: DetailError[]
): Promise<number[]> {
  const ids: number[] = [];
  let page = 1;

  for (;;) {
    let payload: ListPageResponse;
    try {
      try {
        payload = await fetchWorkOrderListPage(
          tokenRef.token,
          page,
          start,
          end
        );
      } catch (err) {
        if (isSigmaAuthError(err)) {
          tokenRef.token = await sigmaLogin();
          payload = await fetchWorkOrderListPage(
            tokenRef.token,
            page,
            start,
            end
          );
        } else {
          throw err;
        }
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error desconocido en listado";
      console.error(`[sync-inversa] list page ${page}:`, message);
      errors.push({ id: -1, error: `list page ${page}: ${message}` });
      break;
    }

    const list = extractWorkOrders(payload);
    const lastPage = extractLastPage(payload, page);

    for (const wo of list) {
      if (typeof wo.id === "number" && Number.isFinite(wo.id)) {
        ids.push(wo.id);
      }
    }

    if (list.length === 0 || page >= lastPage) break;
    page += 1;
  }

  return Array.from(new Set(ids));
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const errors: DetailError[] = [];
  const end = dateOnlyToday();
  const start = dateOnlyDaysAgo(LOOKBACK_DAYS);

  try {
    let token = await getStoredToken();
    if (!token) {
      token = await sigmaLogin();
    }

    const tokenRef = { token };
    const ids = await listWorkOrderIds(tokenRef, start, end, errors);

    const collected: LogisticaInversaRow[] = [];
    let detailsFetched = 0;
    let sparesWithDelivery = 0;

    for (let i = 0; i < ids.length; i += DETAIL_CONCURRENCY) {
      const chunk = ids.slice(i, i + DETAIL_CONCURRENCY);
      const results = await Promise.all(
        chunk.map((id) =>
          fetchSpareDetail(tokenRef, id).then(
            (detail) => ({ id, detail }),
            (err) => ({
              id,
              detail: null as SpareDetailPayload | null,
              error: err instanceof Error ? err.message : String(err),
            })
          )
        )
      );

      for (const r of results) {
        if (!r.detail) {
          const errMsg =
            "error" in r && r.error ? r.error : "fetch failed";
          console.error(`[sync-inversa] detail ${r.id}:`, errMsg);
          errors.push({ id: r.id, error: errMsg });
          continue;
        }

        detailsFetched += 1;
        const rows = rowsFromDetail(r.detail);
        sparesWithDelivery += rows.length;
        collected.push(...rows);
      }
    }

    const insertedAttempted = await insertIgnoreDuplicates(collected);

    return NextResponse.json({
      success: errors.length === 0,
      entry_date_range: { start, end },
      total_listed: ids.length,
      total_details_fetched: detailsFetched,
      spares_with_delivery: sparesWithDelivery,
      inserted_attempted: insertedAttempted,
      errors,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido";
    console.error("[sync-inversa] error:", message);
    return NextResponse.json(
      {
        success: false,
        entry_date_range: { start, end },
        total_listed: 0,
        total_details_fetched: 0,
        spares_with_delivery: 0,
        inserted_attempted: 0,
        errors: [{ id: -1, error: message }],
        error: message,
      },
      { status: 500 }
    );
  }
}
