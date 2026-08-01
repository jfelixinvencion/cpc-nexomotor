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
  store?: { id?: number | null } | null;
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

type OrdenTrabajoDetalleRow = {
  source_id: number;
  work_order_number: string | null;
  status: string | null;
  store_id: number | null;
  fetched_at: string;
  payload: SigmaWorkOrder;
};

type DetailError = { id: number; error: string };

const REQUEST_STATUSES = ["ON_REQUEST", "UNATTENDED"] as const;

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

function getDetailConcurrency(): number {
  const n = Number(process.env.SIGMA_DETAIL_CONCURRENCY || 4);
  if (!Number.isFinite(n) || n < 1) return 4;
  return Math.floor(n);
}

function getDetailBatchDelayMs(): number {
  const n = Number(process.env.SIGMA_DETAIL_BATCH_DELAY_MS || 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
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

function buildPageUrl(
  page: number,
  perPage: number,
  requestStatus?: string
): string {
  const url = new URL(getOtEndpoint());
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("work_order_is_quote", "0");
  url.searchParams.append("store_ids[]", getStoreId());
  if (requestStatus) {
    url.searchParams.set("request_status", requestStatus);
  }
  return url.toString();
}

function buildDetailUrlFromListEndpoint(
  listEndpoint: string,
  id: number
): string {
  const u = new URL(listEndpoint);
  // remove trailing /requests if present
  u.pathname = u.pathname.replace(/\/requests\/?$/, "");
  // ensure there's no trailing slash
  u.pathname = u.pathname.replace(/\/$/, "");
  u.pathname = `${u.pathname}/work-order/${id}`;
  u.search = "";
  return u.toString();
}

async function fetchOtPage(
  token: string,
  page: number,
  perPage: number,
  requestStatus?: string
): Promise<OtPageResponse> {
  const res = await fetch(buildPageUrl(page, perPage, requestStatus), {
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

async function fetchWorkOrderDetail(
  tokenRef: { token: string },
  id: number,
  retried = false
): Promise<SigmaWorkOrder | null> {
  const url = buildDetailUrlFromListEndpoint(process.env.SIGMA_OT_ENDPOINT!, id);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${tokenRef.token}`,
      "x-tenant-id": process.env.SIGMA_TENANT_ID || "",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401) {
    if (retried) {
      throw new Error(`detail ${id} failed: 401 after relogin`);
    }
    // try re-login once
    const newToken = await sigmaLogin();
    if (!newToken) throw new Error("relogin failed");
    tokenRef.token = newToken;
    return fetchWorkOrderDetail(tokenRef, id, true);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`detail ${id} failed: ${res.status} ${body}`);
  }
  const json = await res.json().catch(() => null);
  // Response format observed: { code:200, data: { work_order: { ... } } }
  return json?.data?.work_order ?? json?.work_order ?? json;
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

function toDetalleRow(
  detail: SigmaWorkOrder,
  fetchedAt: string
): OrdenTrabajoDetalleRow | null {
  if (typeof detail.id !== "number" || !Number.isFinite(detail.id)) {
    return null;
  }

  const storeId = detail.store?.id;
  return {
    source_id: detail.id,
    work_order_number:
      detail.number != null && detail.number !== ""
        ? String(detail.number)
        : null,
    status:
      detail.status != null && detail.status !== ""
        ? String(detail.status)
        : null,
    store_id:
      typeof storeId === "number" && Number.isFinite(storeId) ? storeId : null,
    fetched_at: fetchedAt,
    payload: detail,
  };
}

/**
 * Upsert por página (modo recent → ordenes_trabajo_raw).
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

async function insertDetalleRows(
  rows: OrdenTrabajoDetalleRow[]
): Promise<number> {
  if (rows.length === 0) return 0;

  const { error } = await supabaseAdmin
    .from("ordenes_trabajo_detalle")
    .insert(rows);

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

async function listIdsForStatus(
  tokenRef: { token: string },
  requestStatus: string,
  perPage: number,
  maxPages: number,
  errors: DetailError[]
): Promise<number[]> {
  const ids: number[] = [];
  let page = 1;

  for (;;) {
    if (page > maxPages) {
      errors.push({
        id: -1,
        error: `Se alcanzó SIGMA_OT_MAX_PAGES=${maxPages} listando ${requestStatus}`,
      });
      break;
    }

    let payload: OtPageResponse;
    try {
      try {
        payload = await fetchOtPage(
          tokenRef.token,
          page,
          perPage,
          requestStatus
        );
      } catch (err) {
        if (isSigmaAuthError(err)) {
          tokenRef.token = await sigmaLogin();
          payload = await fetchOtPage(
            tokenRef.token,
            page,
            perPage,
            requestStatus
          );
        } else {
          throw err;
        }
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error desconocido en página";
      console.error(
        `[sync-work-orders] list ${requestStatus} page ${page}:`,
        message
      );
      errors.push({ id: -1, error: `${requestStatus} page ${page}: ${message}` });
      page += 1;
      continue;
    }

    const list = Array.isArray(payload.data?.work_orders)
      ? payload.data.work_orders
      : [];
    const lastPage = payload.data?.pagination?.last_page ?? page;

    for (const wo of list) {
      if (typeof wo.id === "number" && Number.isFinite(wo.id)) {
        ids.push(wo.id);
      }
    }

    if (page >= lastPage) break;
    page += 1;
  }

  return ids;
}

async function runFullDetailRefresh(
  token: string
): Promise<{
  truncated: boolean;
  total_listed: number;
  total_details_fetched: number;
  errors: DetailError[];
}> {
  const perPage = getPerPage();
  const maxPages = getMaxPages();
  const concurrency = getDetailConcurrency();
  const delayMs = getDetailBatchDelayMs();
  const errors: DetailError[] = [];
  const tokenRef = { token };

  let truncated = false;
  try {
    const { error: truncateError } = await supabaseAdmin.rpc(
      "truncate_ordenes_trabajo_detalle"
    );
    if (truncateError) {
      // Fallback: delete all rows if RPC is not yet applied
      const { error: deleteError } = await supabaseAdmin
        .from("ordenes_trabajo_detalle")
        .delete()
        .gte("id", 0);
      if (deleteError) {
        throw new Error(
          `No se pudo vaciar ordenes_trabajo_detalle: ${truncateError.message}; fallback: ${deleteError.message}`
        );
      }
      truncated = true;
    } else {
      truncated = true;
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error al truncar tabla";
    errors.push({ id: -1, error: message });
    return {
      truncated: false,
      total_listed: 0,
      total_details_fetched: 0,
      errors,
    };
  }

  const idSet = new Set<number>();
  for (const status of REQUEST_STATUSES) {
    const listed = await listIdsForStatus(
      tokenRef,
      status,
      perPage,
      maxPages,
      errors
    );
    for (const id of listed) idSet.add(id);
  }

  const ids = Array.from(idSet);
  const detailsMap = new Map<number, SigmaWorkOrder>();

  for (let i = 0; i < ids.length; i += concurrency) {
    const chunk = ids.slice(i, i + concurrency);
    const promises = chunk.map((id) =>
      fetchWorkOrderDetail(tokenRef, id).then(
        (detail) => ({ id, detail }),
        (err) => ({
          id,
          detail: null as SigmaWorkOrder | null,
          error: err instanceof Error ? err.message : String(err),
        })
      )
    );
    const results = await Promise.all(promises);
    results.forEach((r) => {
      if (r.detail) {
        detailsMap.set(r.id, r.detail);
      } else {
        const errMsg =
          "error" in r && r.error ? r.error : "fetch failed";
        console.error(`[sync-work-orders] detail ${r.id}:`, errMsg);
        errors.push({ id: r.id, error: errMsg });
      }
    });
    if (delayMs && i + concurrency < ids.length) {
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }

  const fetchedAt = new Date().toISOString();
  const rows: OrdenTrabajoDetalleRow[] = [];
  for (const detail of detailsMap.values()) {
    const row = toDetalleRow(detail, fetchedAt);
    if (row) rows.push(row);
  }

  let total_details_fetched = 0;
  const INSERT_BATCH = 100;
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH);
    try {
      total_details_fetched += await insertDetalleRows(batch);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error de insert detalle";
      console.error(`[sync-work-orders] insert batch ${i}:`, message);
      errors.push({ id: -1, error: `insert batch ${i}: ${message}` });
    }
  }

  return {
    truncated,
    total_listed: ids.length,
    total_details_fetched,
    errors,
  };
}

async function runRecentRawSync(token: string, requestedMode: SyncMode) {
  const perPage = getPerPage();
  const maxPages = getMaxPages();
  const errors: string[] = [];

  let pagesFetched = 0;
  let lastPage = 1;
  let stoppedEarly = false;
  let fetched = 0;
  let upserted = 0;
  let effectiveMode: SyncMode = requestedMode;
  let maxCreatedAt: string | null = null;

  if (requestedMode === "recent") {
    maxCreatedAt = await getMaxCreatedAt();
    if (maxCreatedAt == null) {
      effectiveMode = "full";
    }
  }

  let currentToken = token;
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
        payload = await fetchOtPage(currentToken, page, perPage);
      } catch (err) {
        if (isSigmaAuthError(err)) {
          currentToken = await sigmaLogin();
          payload = await fetchOtPage(currentToken, page, perPage);
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
        if (
          woTs != null &&
          new Date(woTs).getTime() <= new Date(maxCreatedAt).getTime()
        ) {
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

  return {
    success: errors.length === 0,
    mode: effectiveMode,
    requestedMode,
    maxCreatedAt: effectiveMode === "recent" ? maxCreatedAt : null,
    pagesFetched,
    lastPage,
    stoppedEarly,
    fetched,
    upserted,
    errors,
  };
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const mode = parseMode(request.nextUrl.searchParams.get("mode"));

  try {
    getOtEndpoint();

    let token = await getStoredToken();
    if (!token) {
      token = await sigmaLogin();
    }

    if (mode === "full") {
      const summary = await runFullDetailRefresh(token);
      return NextResponse.json({
        success: summary.errors.length === 0,
        mode: "full",
        ...summary,
      });
    }

    return NextResponse.json(await runRecentRawSync(token, mode));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido";
    console.error("[sync-work-orders] error:", message);
    if (mode === "full") {
      return NextResponse.json(
        {
          success: false,
          mode: "full",
          truncated: false,
          total_listed: 0,
          total_details_fetched: 0,
          errors: [{ id: -1, error: message }],
          error: message,
        },
        { status: 200 }
      );
    }
    return NextResponse.json(
      {
        success: false,
        mode,
        pagesFetched: 0,
        lastPage: 1,
        stoppedEarly: false,
        fetched: 0,
        upserted: 0,
        errors: [message],
        error: message,
      },
      { status: 200 }
    );
  }
}
