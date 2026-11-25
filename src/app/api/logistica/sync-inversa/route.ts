import { NextRequest, NextResponse } from "next/server";
import { sigmaLogin } from "@/lib/sigma/client";
import { getStoredToken } from "@/lib/sigma/token";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 300;

const LIST_URL =
  "https://report-api.sigma-peru.com/api/after-sales/work-orders";
const DETAIL_URL_BASE =
  "https://dms-api.sigma-peru.com/api/after-sale/work-order-spare/work-order";

const LOOKBACK_DAYS = 60;
const LOOKAHEAD_DAYS = 1;
const ENTRY_TZ = "America/Lima";
const PER_PAGE = 200;
const LIST_PAGE = 1;
const DETAIL_CONCURRENCY = 2;
const INSERT_BATCH = 100;
const DETAIL_WAVE_PAUSE_MS = 350;
const DETAIL_RETRY_DELAYS_MS = [4000, 7000] as const;
const FACTURADO_STATUS = "FACTURADO";

/**
 * Clientes Preventivo que sí entran a logística inversa.
 * Deben coincidir con la grafía exacta de Sigma (detalle: client.names).
 * La comparación es exacta tras trim: este archivo no pasa los nombres
 * de cliente a minúsculas.
 */
const PREVENTIVO_CLIENTES_PERMITIDOS = [
  "LISTO TAXI S.A.C.",
  "TRANSPORTES CARRARA S.A.C.",
] as const;

/**
 * client_query solo acota el listado Preventivo.
 * La pertenencia la deciden PREVENTIVO_CLIENTES_PERMITIDOS.
 */
const PREVENTIVO_CLIENT_QUERIES = ["LISTO TAXI", "CARRARA"] as const;

/**
 * Tope de páginas por cada client_query del listado Preventivo.
 * per_page es 200, así que 10 páginas cubren 2000 OTs por término:
 * por encima del universo Preventivo medido en la ventana (~713, 4 páginas)
 * y de los dos clientes objetivo (~33 OTs, 1 página cada uno).
 * Al llegar al tope se deja constancia en el log y no se piden más páginas.
 */
const PREVENTIVO_MAX_PAGES = 10;

/**
 * Único mapa de tipo_ot. Claves: id de Sigma (type_operation_id.id)
 * y el nombre normalizado (minúsculas, sin tildes) de operation_type
 * o type_operation_id.name. El valor es el texto que se guarda.
 */
const TIPO_OT_POR_CLAVE: Record<string, string> = {
  "2": "Correctivo",
  correctivo: "Correctivo",
  "4": "Garantia",
  garantia: "Garantia",
  "5": "Preventivo",
  preventivo: "Preventivo",
  "6": "Reclamo",
  reclamo: "Reclamo",
  "7": "Siniestro",
  siniestro: "Siniestro",
};

type TipoOtColumnState = { missing: boolean };

/** Prefer real delivery/dispatch fields; never created_at / updated_at. */
const SPARE_DELIVERY_DATE_FIELDS = [
  "delivery_date",
  "shipping_date",
  "dispatched_at",
  "dispatch_date",
  "delivered_at",
  "attention_date",
] as const;

type SigmaWorkOrderListItem = {
  id?: string | number | null;
  work_order_number?: string | number | null;
  number?: string | number | null;
  operation_type?: string | null;
  general_status?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
};

type SigmaSpare = {
  code?: string | null;
  description?: string | null;
  quantity?: number | null;
  delivery_date?: string | null;
  shipping_date?: string | null;
  dispatched_at?: string | null;
  dispatch_date?: string | null;
  delivered_at?: string | null;
  attention_date?: string | null;
  [key: string]: unknown;
};

type SigmaCar = {
  plate?: string | null;
  [key: string]: unknown;
};

type SigmaClient = {
  names?: string | null;
  first_lastname?: string | null;
  second_lastname?: string | null;
  [key: string]: unknown;
};

type SpareDetailPayload = {
  id?: string | number | null;
  work_order_number?: string | number | null;
  number?: string | number | null;
  plate?: string | null;
  client_name?: string | null;
  car?: SigmaCar | null;
  client?: SigmaClient | null;
  type_operation_id?: { id?: string | number | null; name?: string | null } | null;
  spares?: SigmaSpare[] | null;
  services?: unknown;
  [key: string]: unknown;
};

type LogisticaInversaRow = {
  ot_id: number;
  ot_numero: string;
  placa: string | null;
  cliente_nombre: string | null;
  linea_codigo: string;
  linea_descripcion: string | null;
  linea_cantidad: number | null;
  linea_fecha_entrega: string;
  tipo_ot: string | null;
  source_payload: SigmaSpare;
};

type DetailError = { id: number; error: string };

type ListDiagnostics = {
  report_status: number | null;
  top_level_keys: string[];
  data_typeof: string;
  detected_count_before_id_filter: number;
  unique_ot_ids: number;
  sample_first_3: unknown[];
  entry_date_range: { start: string; end: string };
  request_body: Record<string, unknown>;
  request_method: "POST";
  x_tenant_id: string;
  list_path_used: string | null;
  spares_seen: number;
  spares_with_delivery_date: number;
  spares_without_delivery_date: number;
  ots_empty_spares: number[];
  sample_spare_keys: string[];
  spare_date_fields_used: string[];
};

function isAuthorizedSyncRequest(request: NextRequest): boolean {
  const expected = process.env.SYNC_TRIGGER_SECRET;
  if (!expected) return false;
  const provided = request.headers.get("x-sync-secret");
  return provided === expected;
}

function requireTenantId(): string {
  const tenantId = process.env.SIGMA_TENANT_ID;
  if (!tenantId) {
    throw new Error("SIGMA_TENANT_ID no está definido");
  }
  return tenantId;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isFacturadoStatus(value: string | null | undefined) {
  return (value ?? "").trim() === FACTURADO_STATUS;
}

function isTooManyAttempts(status: number, body: string) {
  if (status === 429) return true;
  return status === 500 && /too many attempts/i.test(body);
}

function formatYmdInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addCalendarDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return utc.toISOString().slice(0, 10);
}

/** OT entry date: today-60 … today+1 (Lima; LOOKBACK_DAYS / LOOKAHEAD_DAYS), not spare delivery date. */
function computeEntryDateRange(now = new Date()): { start: string; end: string } {
  const today = formatYmdInTimeZone(now, ENTRY_TZ);
  return {
    start: addCalendarDaysYmd(today, -LOOKBACK_DAYS),
    end: addCalendarDaysYmd(today, LOOKAHEAD_DAYS),
  };
}

type ListRequestOptions = {
  page?: number;
  clientQuery?: string | null;
  workOrderTypeOperations?: number[];
};

function buildListRequestBody(
  range: {
    start: string;
    end: string;
  },
  options?: ListRequestOptions
): Record<string, unknown> {
  return {
    advisor_ids: null,
    brand_id: null,
    car_plate: null,
    car_vin: null,
    client_query: options?.clientQuery ?? null,
    close_date_range: null,
    delivery_date_range: {
      start: null,
      end: null,
    },
    entry_date_range: {
      start: range.start,
      end: range.end,
    },
    insurer_id: null,
    invoice_date_range: null,
    is_quote: 0,
    page: options?.page ?? LIST_PAGE,
    per_page: PER_PAGE,
    sort_by: null,
    sort_direction: null,
    spare: null,
    store_ids: null,
    type: null,
    vehicle_model_id: null,
    voucher_query: null,
    work_order_general_statuses: null,
    work_order_number: null,
    work_order_type_operations: options?.workOrderTypeOperations ?? [
      2, 4, 6, 7,
    ],
  };
}

function topLevelKeys(value: unknown): string[] {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value as Record<string, unknown>);
}

function describeDataType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(len=${value.length})`;
  return typeof value;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ? `${error.message}\n${error.stack}` : error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Accept string or number ids (e.g. "764" or 764). */
function parseOtId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

function asNonEmptyString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

function looksLikeWorkOrderItem(item: unknown): boolean {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const obj = item as Record<string, unknown>;
  return (
    obj.id != null ||
    obj.work_order_number != null ||
    obj.operation_type != null
  );
}

/**
 * If Sigma nests JSON as a string under `data`, parse it once.
 */
function coercePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const root = { ...(payload as Record<string, unknown>) };
  if (typeof root.data === "string") {
    const raw = root.data.trim();
    if (!raw) {
      root.data = null;
      return root;
    }
    try {
      root.data = JSON.parse(raw);
      console.log(
        "[sync-inversa] report-api data was string; JSON.parse OK. typeof after:",
        describeDataType(root.data)
      );
    } catch (err) {
      console.error(
        "[sync-inversa] report-api data string JSON.parse failed:",
        errorMessage(err)
      );
    }
  }

  // One more nested string level: data.data as string
  if (
    root.data &&
    typeof root.data === "object" &&
    !Array.isArray(root.data) &&
    typeof (root.data as Record<string, unknown>).data === "string"
  ) {
    const nested = root.data as Record<string, unknown>;
    const raw = String(nested.data).trim();
    if (raw) {
      try {
        nested.data = JSON.parse(raw);
        console.log(
          "[sync-inversa] report-api data.data was string; JSON.parse OK"
        );
      } catch (err) {
        console.error(
          "[sync-inversa] report-api data.data JSON.parse failed:",
          errorMessage(err)
        );
      }
    }
  }

  return root;
}

/**
 * Inspect the real payload without assuming a fixed shape.
 */
function extractWorkOrderList(payload: unknown): {
  list: SigmaWorkOrderListItem[];
  path: string | null;
} {
  if (Array.isArray(payload)) {
    return {
      list: payload as SigmaWorkOrderListItem[],
      path: "response",
    };
  }

  if (!payload || typeof payload !== "object") {
    return { list: [], path: null };
  }

  const root = payload as Record<string, unknown>;

  const candidates: Array<{ path: string; value: unknown }> = [
    { path: "response.data", value: root.data },
    {
      path: "response.data.data",
      value:
        root.data && typeof root.data === "object" && !Array.isArray(root.data)
          ? (root.data as Record<string, unknown>).data
          : undefined,
    },
    {
      path: "response.data.data.data",
      value: (() => {
        if (!root.data || typeof root.data !== "object" || Array.isArray(root.data)) {
          return undefined;
        }
        const d1 = (root.data as Record<string, unknown>).data;
        if (!d1 || typeof d1 !== "object" || Array.isArray(d1)) return undefined;
        return (d1 as Record<string, unknown>).data;
      })(),
    },
    {
      path: "response.data.work_orders",
      value:
        root.data && typeof root.data === "object" && !Array.isArray(root.data)
          ? (root.data as Record<string, unknown>).work_orders
          : undefined,
    },
    {
      path: "response.data.data.work_orders",
      value: (() => {
        if (!root.data || typeof root.data !== "object" || Array.isArray(root.data)) {
          return undefined;
        }
        const d1 = (root.data as Record<string, unknown>).data;
        if (!d1 || typeof d1 !== "object" || Array.isArray(d1)) return undefined;
        return (d1 as Record<string, unknown>).work_orders;
      })(),
    },
    { path: "response.work_orders", value: root.work_orders },
    {
      path: "response.data.items",
      value:
        root.data && typeof root.data === "object" && !Array.isArray(root.data)
          ? (root.data as Record<string, unknown>).items
          : undefined,
    },
    {
      path: "response.data.rows",
      value:
        root.data && typeof root.data === "object" && !Array.isArray(root.data)
          ? (root.data as Record<string, unknown>).rows
          : undefined,
    },
    {
      path: "response.data.results",
      value:
        root.data && typeof root.data === "object" && !Array.isArray(root.data)
          ? (root.data as Record<string, unknown>).results
          : undefined,
    },
  ];

  let emptyFallback: { list: SigmaWorkOrderListItem[]; path: string } | null =
    null;

  for (const c of candidates) {
    if (!Array.isArray(c.value)) continue;
    if (c.value.length === 0) {
      if (!emptyFallback) {
        emptyFallback = { list: [], path: c.path };
      }
      continue;
    }
    if (looksLikeWorkOrderItem(c.value[0])) {
      return {
        list: c.value as SigmaWorkOrderListItem[],
        path: c.path,
      };
    }
  }

  for (const [key, value] of Object.entries(root)) {
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      looksLikeWorkOrderItem(value[0])
    ) {
      return { list: value as SigmaWorkOrderListItem[], path: `response.${key}` };
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k2, v2] of Object.entries(value as Record<string, unknown>)) {
        if (
          Array.isArray(v2) &&
          v2.length > 0 &&
          looksLikeWorkOrderItem(v2[0])
        ) {
          return {
            list: v2 as SigmaWorkOrderListItem[],
            path: `response.${key}.${k2}`,
          };
        }
      }
    }
  }

  if (emptyFallback) return emptyFallback;
  return { list: [], path: null };
}

function sanitizeSampleItem(
  item: SigmaWorkOrderListItem
): Record<string, unknown> {
  return {
    id: item.id ?? null,
    work_order_number: item.work_order_number ?? item.number ?? null,
    operation_type: item.operation_type ?? null,
    created_at: item.created_at ?? null,
  };
}

function hasDeliveryDate(value: unknown): value is string {
  if (value == null) return false;
  const s = String(value).trim();
  return s.length > 0;
}

function resolveSpareDeliveryDate(spare: SigmaSpare): {
  value: string | null;
  field: string | null;
} {
  for (const field of SPARE_DELIVERY_DATE_FIELDS) {
    const raw = spare[field];
    if (hasDeliveryDate(raw)) {
      return { value: String(raw).trim(), field };
    }
  }
  return { value: null, field: null };
}

function extractDetailData(json: unknown): SpareDetailPayload | null {
  if (typeof json === "string") {
    try {
      json = JSON.parse(json);
    } catch {
      return null;
    }
  }
  if (!json || typeof json !== "object") return null;

  const root = json as Record<string, unknown>;

  // Observed shape: root-level { id, number, car, spares, client, ... }
  if (Array.isArray(root.spares) || root.car != null || root.id != null) {
    return root as SpareDetailPayload;
  }

  let nested: unknown = root.data;

  if (typeof nested === "string") {
    try {
      nested = JSON.parse(nested);
    } catch {
      nested = null;
    }
  }

  if (nested && typeof nested === "object") {
    const dataObj = nested as Record<string, unknown>;
    if (
      Array.isArray(dataObj.spares) ||
      dataObj.car != null ||
      dataObj.id != null
    ) {
      return dataObj as SpareDetailPayload;
    }
    const workOrder = dataObj.work_order;
    if (workOrder && typeof workOrder === "object") {
      return workOrder as SpareDetailPayload;
    }
  }

  return null;
}

type ListFetchResult =
  | {
      ok: true;
      status: number;
      json: unknown;
      rawText: string;
      body: Record<string, unknown>;
      tenantId: string;
    }
  | {
      ok: false;
      status: number;
      responseText: string;
      body: Record<string, unknown>;
      tenantId: string;
    };

async function fetchWorkOrderListPage(
  token: string,
  range: { start: string; end: string },
  options?: ListRequestOptions
): Promise<ListFetchResult> {
  const body = buildListRequestBody(range, options);
  const tenantId = requireTenantId();

  const res = await fetch(LIST_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-tenant-id": tenantId,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const responseText = await res.text();

  console.log("[sync-inversa] report-api HTTP status:", res.status);
  console.log(
    "[sync-inversa] report-api raw response (truncated):",
    responseText.slice(0, 4000)
  );

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      responseText,
      body,
      tenantId,
    };
  }

  let json: unknown = null;
  try {
    json = responseText ? JSON.parse(responseText) : null;
  } catch (err) {
    console.error(
      "[sync-inversa] report-api JSON.parse failed:",
      errorMessage(err)
    );
    return {
      ok: false,
      status: res.status,
      responseText,
      body,
      tenantId,
    };
  }

  console.log(
    "[sync-inversa] report-api parsed top-level keys:",
    topLevelKeys(json)
  );

  return {
    ok: true,
    status: res.status,
    json,
    rawText: responseText,
    body,
    tenantId,
  };
}

async function fetchSpareDetailOnce(
  tokenRef: { token: string },
  id: number
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
    const authError = new Error(`detail ${id} failed: ${res.status}`);
    (authError as Error & { status?: number }).status = res.status;
    throw authError;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`detail ${id} failed: ${res.status} ${body}`.trim());
    (err as Error & { status?: number; body?: string }).status = res.status;
    (err as Error & { status?: number; body?: string }).body = body;
    throw err;
  }

  const json = await res.json().catch(() => null);
  return extractDetailData(json);
}

async function fetchSpareDetail(
  tokenRef: { token: string },
  id: number
): Promise<SpareDetailPayload | null> {
  let authRetried = false;
  let lastTooMany: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt === 2) await sleep(DETAIL_RETRY_DELAYS_MS[0]);
    if (attempt === 3) await sleep(DETAIL_RETRY_DELAYS_MS[1]);

    try {
      return await fetchSpareDetailOnce(tokenRef, id);
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      const body = (err as Error & { body?: string }).body ?? "";

      if ((status === 401 || status === 403) && !authRetried) {
        tokenRef.token = await sigmaLogin();
        authRetried = true;
        try {
          return await fetchSpareDetailOnce(tokenRef, id);
        } catch (retryErr) {
          const retryStatus = (retryErr as Error & { status?: number }).status;
          const retryBody = (retryErr as Error & { body?: string }).body ?? "";
          if (retryStatus === 401 || retryStatus === 403) {
            throw new Error(
              `detail ${id} failed: ${retryStatus} after relogin`
            );
          }
          if (
            retryStatus != null &&
            isTooManyAttempts(retryStatus, retryBody)
          ) {
            lastTooMany =
              retryErr instanceof Error
                ? retryErr
                : new Error(errorMessage(retryErr));
            continue;
          }
          throw retryErr;
        }
      }

      if (status != null && isTooManyAttempts(status, body)) {
        lastTooMany = err instanceof Error ? err : new Error(errorMessage(err));
        continue;
      }

      throw err;
    }
  }

  throw lastTooMany ?? new Error(`detail ${id} failed: Too Many Attempts`);
}

function resolveOtNumero(
  detail: SpareDetailPayload,
  fallbackFromList: string | null
): string | null {
  // Prefer detalle.number (root field in dms-api), then work_order_number.
  return (
    asNonEmptyString(detail.number) ??
    asNonEmptyString(detail.work_order_number) ??
    fallbackFromList
  );
}

/** placa from detalle.car?.plate ?? detalle.plate */
function resolvePlaca(detail: SpareDetailPayload): string | null {
  const fromCar =
    detail.car && typeof detail.car === "object"
      ? asNonEmptyString(detail.car.plate)
      : null;
  return fromCar ?? asNonEmptyString(detail.plate);
}

/**
 * cliente_nombre from client.names + first_lastname + second_lastname
 * (omit null parts). Fallback to client_name if present.
 */
function isPreventivoClientePermitido(
  nombre: string | null | undefined
): boolean {
  if (nombre == null) return false;
  const trimmed = nombre.trim();
  return (PREVENTIVO_CLIENTES_PERMITIDOS as readonly string[]).includes(
    trimmed
  );
}

function resolveClienteNombre(detail: SpareDetailPayload): string | null {
  const client = detail.client;
  if (client && typeof client === "object") {
    const parts = [
      asNonEmptyString(client.names),
      asNonEmptyString(client.first_lastname),
      asNonEmptyString(client.second_lastname),
    ].filter((p): p is string => p != null);
    if (parts.length > 0) return parts.join(" ");
  }
  return asNonEmptyString(detail.client_name);
}

function rowConflictKey(row: { ot_id: number; linea_codigo: string }): string {
  return `${row.ot_id}|${row.linea_codigo}`;
}

function dedupeRowsByOtAndCode(
  rows: LogisticaInversaRow[]
): LogisticaInversaRow[] {
  const map = new Map<string, LogisticaInversaRow>();
  for (const row of rows) {
    const key = rowConflictKey(row);
    const prev = map.get(key);
    if (!prev || row.linea_fecha_entrega > prev.linea_fecha_entrega) {
      map.set(key, row);
    }
  }
  return Array.from(map.values());
}

function tipoClave(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return String(Number(trimmed));
  return trimmed
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Id del detalle primero; si no está, el nombre del detalle; al final el listado. */
function resolveTipoOt(
  detail: SpareDetailPayload,
  listOperationType: string | null
): string | null {
  const raw = detail.type_operation_id;
  if (raw && typeof raw === "object") {
    const byId = TIPO_OT_POR_CLAVE[tipoClave(raw.id) ?? ""];
    if (byId) return byId;
    const byName = TIPO_OT_POR_CLAVE[tipoClave(raw.name) ?? ""];
    if (byName) return byName;
  }
  const fromList = TIPO_OT_POR_CLAVE[tipoClave(listOperationType) ?? ""];
  return fromList ?? null;
}

function isMissingTipoOtColumn(message: string): boolean {
  return (
    /tipo_ot/i.test(message) &&
    /schema cache|does not exist|could not find|column/i.test(message)
  );
}

function noteTipoOtColumnMissing(state: TipoOtColumnState) {
  if (state.missing) return;
  state.missing = true;
  console.warn(
    "[sync-inversa] columna public.logistica_inversa.tipo_ot no existe; el sync continúa sin guardarla. Ejecute sql/logistica_inversa_tipo_ot.sql"
  );
}

function withoutTipoOt(
  row: LogisticaInversaRow
): Omit<LogisticaInversaRow, "tipo_ot"> {
  const { tipo_ot: _omit, ...rest } = row;
  return rest;
}

/**
 * Rellena tipo_ot solo donde sigue NULL. No toca un valor ya guardado
 * ni certificado, retorno, responsable, estado u observaciones.
 */
async function fillNullTipoOt(
  state: TipoOtColumnState,
  assignments: Array<{ otId: number; tipo: string }>
): Promise<void> {
  if (state.missing || assignments.length === 0) return;

  const idsByTipo = new Map<string, number[]>();
  for (const { otId, tipo } of assignments) {
    if (!tipo) continue;
    const bucket = idsByTipo.get(tipo) ?? [];
    bucket.push(otId);
    idsByTipo.set(tipo, bucket);
  }

  for (const [tipo, otIds] of idsByTipo) {
    const unique = Array.from(new Set(otIds));
    for (let i = 0; i < unique.length; i += 200) {
      const chunk = unique.slice(i, i + 200);
      const { error } = await supabaseAdmin
        .from("logistica_inversa")
        .update({ tipo_ot: tipo })
        .in("ot_id", chunk)
        .is("tipo_ot", null);
      if (!error) continue;
      if (isMissingTipoOtColumn(error.message)) {
        noteTipoOtColumnMissing(state);
        return;
      }
      throw new Error(`Supabase tipo_ot backfill: ${error.message}`);
    }
  }
}

/**
 * Map detail → rows. Header fields (placa, cliente, ot_numero, tipo_ot) are shared
 * across every spare line of the OT.
 */
function rowsFromDetail(
  detail: SpareDetailPayload | null | undefined,
  fallbackOtNumero: string | null,
  listOperationType: string | null
): LogisticaInversaRow[] {
  if (!detail) return [];

  const otId = parseOtId(detail.id);
  if (otId == null) return [];

  if (!Array.isArray(detail.spares) || detail.spares.length === 0) {
    return [];
  }

  const otNumero = resolveOtNumero(detail, fallbackOtNumero);
  // ot_numero is NOT NULL in Supabase — skip rows we cannot populate.
  if (!otNumero) {
    console.warn(
      `[sync-inversa] skipping OT id=${otId}: ot_numero is null/empty`
    );
    return [];
  }

  const placa = resolvePlaca(detail);
  const clienteNombre = resolveClienteNombre(detail);
  const tipoOt = resolveTipoOt(detail, listOperationType);

  const rows: LogisticaInversaRow[] = [];

  for (const spare of detail.spares) {
    if (!spare || typeof spare !== "object") continue;
    const delivery = resolveSpareDeliveryDate(spare);
    if (!delivery.value) continue;

    const codigo = asNonEmptyString(spare.code);
    if (!codigo) continue;

    rows.push({
      ot_id: otId,
      ot_numero: otNumero,
      placa,
      cliente_nombre: clienteNombre,
      linea_codigo: codigo,
      linea_descripcion: asNonEmptyString(spare.description),
      linea_cantidad:
        typeof spare.quantity === "number" && Number.isFinite(spare.quantity)
          ? spare.quantity
          : spare.quantity != null && Number.isFinite(Number(spare.quantity))
            ? Number(spare.quantity)
            : null,
      linea_fecha_entrega: delivery.value,
      tipo_ot: tipoOt,
      source_payload: spare,
    });
  }

  return rows;
}

/**
 * Insert new rows on UNIQUE(ot_id, linea_codigo).
 * Supabase JS cannot express ON CONFLICT ... DO UPDATE ... WHERE, so:
 *   1) upsert + ignoreDuplicates (insert only)
 *   2) update incomplete rows (placa/cliente/descripcion NULL)
 *
 * Never touch certificado_at, fecha_registro_retorno, responsable_entrega,
 * estado_repuesto, observaciones.
 */
async function upsertFillNullHeaders(
  rows: LogisticaInversaRow[],
  tipoOtColumn: TipoOtColumnState
): Promise<number> {
  const valid = dedupeRowsByOtAndCode(
    rows.filter(
      (r) =>
        r.ot_numero != null &&
        String(r.ot_numero).trim() !== "" &&
        r.linea_codigo != null &&
        r.linea_fecha_entrega != null
    )
  );

  if (valid.length === 0) return 0;

  let attempted = 0;
  for (let i = 0; i < valid.length; i += INSERT_BATCH) {
    const batch = valid.slice(i, i + INSERT_BATCH);
    const payload = tipoOtColumn.missing
      ? batch.map(withoutTipoOt)
      : batch;

    let { error: insertError } = await supabaseAdmin
      .from("logistica_inversa")
      .upsert(payload, {
        onConflict: "ot_id,linea_codigo",
        ignoreDuplicates: true,
      });

    if (
      insertError &&
      !tipoOtColumn.missing &&
      isMissingTipoOtColumn(insertError.message)
    ) {
      noteTipoOtColumnMissing(tipoOtColumn);
      const retry = await supabaseAdmin
        .from("logistica_inversa")
        .upsert(batch.map(withoutTipoOt), {
          onConflict: "ot_id,linea_codigo",
          ignoreDuplicates: true,
        });
      insertError = retry.error;
    }

    if (insertError) {
      throw new Error(`Supabase upsert insert: ${insertError.message}`);
    }

    if (!tipoOtColumn.missing) {
      await fillNullTipoOt(
        tipoOtColumn,
        batch.flatMap((row) =>
          row.tipo_ot ? [{ otId: row.ot_id, tipo: row.tipo_ot }] : []
        )
      );
    }

    const otIds = Array.from(new Set(batch.map((r) => r.ot_id)));
    const { data: existing, error: selectError } = await supabaseAdmin
      .from("logistica_inversa")
      .select("id, ot_id, linea_codigo, placa, cliente_nombre, linea_descripcion")
      .in("ot_id", otIds)
      .or("placa.is.null,cliente_nombre.is.null,linea_descripcion.is.null");

    if (selectError) {
      throw new Error(`Supabase select backfill: ${selectError.message}`);
    }

    const incomingByKey = new Map(
      batch.map((r) => [rowConflictKey(r), r] as const)
    );

    for (const ex of existing ?? []) {
      const incoming = incomingByKey.get(
        rowConflictKey({
          ot_id: Number(ex.ot_id),
          linea_codigo: String(ex.linea_codigo),
        })
      );
      if (!incoming) continue;

      const { error: updateError } = await supabaseAdmin
        .from("logistica_inversa")
        .update({
          ot_numero: incoming.ot_numero,
          placa: incoming.placa,
          cliente_nombre: incoming.cliente_nombre,
          linea_descripcion: incoming.linea_descripcion,
          linea_cantidad: incoming.linea_cantidad,
          linea_fecha_entrega: incoming.linea_fecha_entrega,
        })
        .eq("id", ex.id);

      if (updateError) {
        throw new Error(
          `Supabase backfill update id=${ex.id}: ${updateError.message}`
        );
      }
    }

    attempted += batch.length;
  }

  return attempted;
}

function absorbListedWorkOrder(
  wo: SigmaWorkOrderListItem,
  ids: number[],
  otNumeroById: Map<number, string>,
  generalStatusesById: Map<number, Set<string>>,
  operationTypeById: Map<number, string>
): number | null {
  const id = parseOtId(wo.id);
  if (id == null) return null;
  ids.push(id);
  const otNum =
    asNonEmptyString(wo.work_order_number) ?? asNonEmptyString(wo.number);
  if (otNum) otNumeroById.set(id, otNum);
  const operationType = asNonEmptyString(wo.operation_type);
  if (operationType) operationTypeById.set(id, operationType);
  const rawStatus =
    typeof wo.general_status === "string" ? wo.general_status.trim() : "";
  if (!generalStatusesById.has(id)) {
    generalStatusesById.set(id, new Set());
  }
  if (rawStatus) generalStatusesById.get(id)!.add(rawStatus);
  return id;
}

function readWorkOrderListPageInfo(payload: unknown): {
  lastPage: number | null;
  currentPage: number | null;
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { lastPage: null, currentPage: null };
  }
  const data = (payload as Record<string, unknown>).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { lastPage: null, currentPage: null };
  }
  const pagination = (data as Record<string, unknown>).pagination;
  if (
    !pagination ||
    typeof pagination !== "object" ||
    Array.isArray(pagination)
  ) {
    return { lastPage: null, currentPage: null };
  }
  const pag = pagination as Record<string, unknown>;
  const last = Number(pag.last_page);
  const current = Number(pag.current_page);
  return {
    lastPage: Number.isFinite(last) && last >= 1 ? Math.trunc(last) : null,
    currentPage:
      Number.isFinite(current) && current >= 1 ? Math.trunc(current) : null,
  };
}

type PreventivoListStats = {
  client_queries: string[];
  pages_fetched: number;
  page_cap: number;
  capped: boolean;
  raw_rows: number;
  accepted_on_list: number;
  discarded_on_list: number;
  list_error: string | null;
};

async function fetchListPageWithAuth(
  tokenRef: { token: string },
  range: { start: string; end: string },
  options: ListRequestOptions
): Promise<ListFetchResult> {
  let result = await fetchWorkOrderListPage(tokenRef.token, range, options);
  if (!result.ok && (result.status === 401 || result.status === 403)) {
    tokenRef.token = await sigmaLogin();
    result = await fetchWorkOrderListPage(tokenRef.token, range, options);
  }
  return result;
}

/**
 * Segundo listado: solo tipo 5. Pagina cada client_query hasta agotar
 * last_page, con tope PREVENTIVO_MAX_PAGES. El nombre se filtra aquí
 * por igualdad exacta tras trim; el detalle vuelve a validarlo.
 */
async function listPreventivoWorkOrders(
  tokenRef: { token: string },
  range: { start: string; end: string }
): Promise<{ items: SigmaWorkOrderListItem[]; stats: PreventivoListStats }> {
  const items: SigmaWorkOrderListItem[] = [];
  const stats: PreventivoListStats = {
    client_queries: [...PREVENTIVO_CLIENT_QUERIES],
    pages_fetched: 0,
    page_cap: PREVENTIVO_MAX_PAGES,
    capped: false,
    raw_rows: 0,
    accepted_on_list: 0,
    discarded_on_list: 0,
    list_error: null,
  };

  for (const query of PREVENTIVO_CLIENT_QUERIES) {
    for (let page = 1; page <= PREVENTIVO_MAX_PAGES; page++) {
      const result = await fetchListPageWithAuth(tokenRef, range, {
        page,
        clientQuery: query,
        workOrderTypeOperations: [5],
      });
      if (!result.ok) {
        stats.list_error = `report-api preventivo HTTP ${result.status} client_query=${query} page=${page}`;
        console.error(`[sync-inversa] ${stats.list_error}`);
        return { items, stats };
      }

      stats.pages_fetched += 1;
      const payload = coercePayload(result.json);
      const { list } = extractWorkOrderList(payload);
      const pageInfo = readWorkOrderListPageInfo(payload);
      stats.raw_rows += list.length;

      for (const wo of list) {
        const nombre = asNonEmptyString(wo.client_name);
        if (!isPreventivoClientePermitido(nombre)) {
          stats.discarded_on_list += 1;
          const id = parseOtId(wo.id);
          console.warn(
            `[sync-inversa] OT id=${id ?? "?"} descartada en listado preventivo: client_name="${nombre ?? ""}" no coincide tras trim con los clientes permitidos`
          );
          continue;
        }
        items.push(wo);
        stats.accepted_on_list += 1;
      }

      if (pageInfo.currentPage != null && pageInfo.currentPage !== page) {
        console.warn(
          `[sync-inversa] preventivo client_query="${query}" página pedida ${page} pero Sigma respondió current_page=${pageInfo.currentPage}; se detiene este listado`
        );
        break;
      }

      const moreByPagination =
        pageInfo.lastPage != null && page < pageInfo.lastPage;
      const moreBySize = pageInfo.lastPage == null && list.length >= PER_PAGE;
      if (!moreByPagination && !moreBySize) break;
      if (page === PREVENTIVO_MAX_PAGES) {
        stats.capped = true;
        console.warn(
          `[sync-inversa] preventivo client_query="${query}" alcanzó el tope de ${PREVENTIVO_MAX_PAGES} páginas (per_page ${PER_PAGE}); no se piden más`
        );
        break;
      }
    }
  }

  return { items, stats };
}

function isListedAsFacturado(statuses: Set<string> | undefined) {
  if (!statuses || statuses.size === 0) return false;
  return [...statuses].every((status) => isFacturadoStatus(status));
}

async function loadCompletedFacturadaOtIds(
  otIds: number[]
): Promise<Set<number>> {
  const completed = new Set<number>();
  const chunkSize = 200;
  for (let i = 0; i < otIds.length; i += chunkSize) {
    const chunk = otIds.slice(i, i + chunkSize);
    const { data, error } = await supabaseAdmin
      .from("logistica_inversa_ot_sync")
      .select("ot_id")
      .in("ot_id", chunk);
    if (error) {
      throw new Error(`logistica_inversa_ot_sync select: ${error.message}`);
    }
    for (const row of data ?? []) {
      const id = Number((row as { ot_id?: unknown }).ot_id);
      if (Number.isFinite(id)) completed.add(id);
    }
  }
  return completed;
}

async function recordFacturadaConstancia(params: {
  ot_id: number;
  ot_numero: string | null;
  lineas_persistidas: number;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("logistica_inversa_ot_sync").upsert(
    {
      ot_id: params.ot_id,
      ot_numero: params.ot_numero,
      completed_while_facturada_at: new Date().toISOString(),
      lineas_persistidas: params.lineas_persistidas,
    },
    { onConflict: "ot_id", ignoreDuplicates: true }
  );
  if (error) {
    throw new Error(`logistica_inversa_ot_sync insert: ${error.message}`);
  }
}

function emptyDiagnostics(
  range: { start: string; end: string },
  partial?: Partial<ListDiagnostics>
): ListDiagnostics {
  return {
    report_status: null,
    top_level_keys: [],
    data_typeof: "undefined",
    detected_count_before_id_filter: 0,
    unique_ot_ids: 0,
    sample_first_3: [],
    entry_date_range: range,
    request_body: buildListRequestBody(range),
    request_method: "POST",
    x_tenant_id: process.env.SIGMA_TENANT_ID ?? "(missing)",
    list_path_used: null,
    spares_seen: 0,
    spares_with_delivery_date: 0,
    spares_without_delivery_date: 0,
    ots_empty_spares: [],
    sample_spare_keys: [],
    spare_date_fields_used: [],
    ...partial,
  };
}

function failureJson(
  entry_date_range: { start: string; end: string },
  error: unknown,
  diagnostics?: ListDiagnostics
) {
  const message = errorMessage(error);
  console.error("[sync-inversa] error:", message);
  return NextResponse.json(
    {
      success: false,
      entry_date_range,
      total_listed: 0,
      total_details_fetched: 0,
      spares_with_delivery: 0,
      inserted_attempted: 0,
      diagnostics: diagnostics ?? emptyDiagnostics(entry_date_range),
      errors: [{ id: -1, error: message }],
      error: message,
    },
    { status: 500 }
  );
}

export async function POST(request: NextRequest) {
  // TODO(auth-enforced): esta ruta se llama con x-sync-secret desde trigger-sync.
  // El permiso inversa/sincronizar se aplica en /api/logistica/trigger-sync.
  const entry_date_range = computeEntryDateRange();

  try {
    if (!isAuthorizedSyncRequest(request)) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const errors: DetailError[] = [];

    // Same token flow as Control OT (/api/sync-work-orders)
    let token = await getStoredToken();
    if (!token) {
      token = await sigmaLogin();
    }

    let listResult = await fetchWorkOrderListPage(token, entry_date_range);
    if (
      !listResult.ok &&
      (listResult.status === 401 || listResult.status === 403)
    ) {
      token = await sigmaLogin();
      listResult = await fetchWorkOrderListPage(token, entry_date_range);
    }

    if (!listResult.ok) {
      return NextResponse.json(
        {
          success: false,
          entry_date_range,
          total_listed: 0,
          total_details_fetched: 0,
          spares_with_delivery: 0,
          inserted_attempted: 0,
          report_status: listResult.status,
          report_response_body: listResult.responseText.slice(0, 4000),
          error: `report-api HTTP ${listResult.status}`,
          diagnostics: emptyDiagnostics(entry_date_range, {
            report_status: listResult.status,
            request_body: listResult.body,
            x_tenant_id: listResult.tenantId,
          }),
          errors: [
            {
              id: -1,
              error: `report-api HTTP ${listResult.status}`,
            },
          ],
        },
        { status: 200 }
      );
    }

    const payload = coercePayload(listResult.json);
    const rootData =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).data
        : undefined;

    const { list, path } = extractWorkOrderList(payload);

    console.log("[sync-inversa] list path:", path);
    console.log("[sync-inversa] list length:", list.length);
    console.log(
      "[sync-inversa] list sample:",
      JSON.stringify(list.slice(0, 3).map(sanitizeSampleItem))
    );

    const otNumeroById = new Map<number, string>();
    const operationTypeById = new Map<number, string>();
    const generalStatusesById = new Map<number, Set<string>>();
    const ids: number[] = [];
    for (const wo of list) {
      absorbListedWorkOrder(
        wo,
        ids,
        otNumeroById,
        generalStatusesById,
        operationTypeById
      );
    }
    const generalIds = Array.from(new Set(ids));
    console.log(
      `[sync-inversa] unique OT ids from list: ${generalIds.length} (raw rows=${list.length})`
    );

    const diagnostics: ListDiagnostics = {
      report_status: listResult.status,
      top_level_keys: topLevelKeys(payload),
      data_typeof: describeDataType(rootData),
      detected_count_before_id_filter: list.length,
      unique_ot_ids: generalIds.length,
      sample_first_3: list.slice(0, 3).map(sanitizeSampleItem),
      entry_date_range,
      request_body: listResult.body,
      request_method: "POST",
      x_tenant_id: listResult.tenantId,
      list_path_used: path,
      spares_seen: 0,
      spares_with_delivery_date: 0,
      spares_without_delivery_date: 0,
      ots_empty_spares: [],
      sample_spare_keys: [],
      spare_date_fields_used: [],
    };

    if (list.length > 0 && generalIds.length === 0) {
      return NextResponse.json({
        success: false,
        entry_date_range,
        total_listed: 0,
        total_details_fetched: 0,
        spares_with_delivery: 0,
        inserted_attempted: 0,
        diagnostics,
        errors: [
          {
            id: -1,
            error: "Se detectaron filas pero ningún id parseable",
          },
        ],
        error: "Se detectaron filas pero ningún id parseable",
      });
    }

    const tokenRef = { token };
    const preventivo = await listPreventivoWorkOrders(
      tokenRef,
      entry_date_range
    );
    const generalIdSet = new Set(generalIds);
    const preventivoOnlyIds = new Set<number>();
    for (const wo of preventivo.items) {
      const id = absorbListedWorkOrder(
        wo,
        ids,
        otNumeroById,
        generalStatusesById,
        operationTypeById
      );
      if (id == null) continue;
      if (!generalIdSet.has(id)) preventivoOnlyIds.add(id);
    }
    const uniqueIds = Array.from(new Set(ids));
    diagnostics.unique_ot_ids = uniqueIds.length;
    console.log(
      `[sync-inversa] preventivo páginas=${preventivo.stats.pages_fetched} filas=${preventivo.stats.raw_rows} aceptadas=${preventivo.stats.accepted_on_list} descartadas_listado=${preventivo.stats.discarded_on_list} ids_nuevos=${preventivoOnlyIds.size} capped=${preventivo.stats.capped}`
    );
    console.log(
      `[sync-inversa] unique OT ids combinados: ${uniqueIds.length} (general=${generalIds.length})`
    );

    if (uniqueIds.length === 0) {
      const emptyMessage =
        preventivo.stats.list_error ??
        "Listado vacío o estructura de respuesta no reconocida";
      return NextResponse.json({
        success: false,
        entry_date_range,
        total_listed: 0,
        total_details_fetched: 0,
        spares_with_delivery: 0,
        inserted_attempted: 0,
        diagnostics,
        preventivo: { ...preventivo.stats, discarded_on_detail: 0 },
        errors: [
          {
            id: -1,
            error: emptyMessage,
          },
        ],
        error: emptyMessage,
      });
    }

    if (preventivo.stats.list_error) {
      errors.push({ id: -1, error: preventivo.stats.list_error });
    }

    const tipoOtColumn: TipoOtColumnState = { missing: false };
    const completedFacturadaIds = await loadCompletedFacturadaOtIds(uniqueIds);
    const idsToFetch = uniqueIds.filter(
      (id) =>
        !(
          isListedAsFacturado(generalStatusesById.get(id)) &&
          completedFacturadaIds.has(id)
        )
    );
    const skippedFacturadaWithConstancia =
      uniqueIds.length - idsToFetch.length;

    let insertedAttempted = 0;
    let detailsFetched = 0;
    let sparesWithDelivery = 0;
    let skippedNoSpares = 0;
    let skippedNoOtNumero = 0;
    let preventivoDiscardedOnDetail = 0;
    const dateFieldsUsed = new Set<string>();

    for (let i = 0; i < idsToFetch.length; i += DETAIL_CONCURRENCY) {
      if (i > 0) await sleep(DETAIL_WAVE_PAUSE_MS);
      const chunk = idsToFetch.slice(i, i + DETAIL_CONCURRENCY);
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
            "error" in r && r.error ? r.error : "fetch failed / sin detalle";
          if (!("error" in r) || !r.error) {
            skippedNoSpares += 1;
            diagnostics.ots_empty_spares.push(r.id);
            console.warn(
              `[sync-inversa] OT id=${r.id} sin detalle / spares vacío`
            );
            errors.push({ id: r.id, error: errMsg });
            continue;
          }
          console.error(`[sync-inversa] detail ${r.id}:`, errMsg);
          errors.push({ id: r.id, error: errMsg });
          continue;
        }

        detailsFetched += 1;
        if (preventivoOnlyIds.has(r.id)) {
          const clienteDetalle = resolveClienteNombre(r.detail);
          if (!isPreventivoClientePermitido(clienteDetalle)) {
            preventivoDiscardedOnDetail += 1;
            console.warn(
              `[sync-inversa] OT id=${r.id} descartada: cliente del detalle "${clienteDetalle ?? ""}" no está permitido para Preventivo`
            );
            continue;
          }
        }
        const fallbackOtNumero = otNumeroById.get(r.id) ?? null;
        const resolvedOtNumero = resolveOtNumero(r.detail, fallbackOtNumero);
        const facturada = isListedAsFacturado(generalStatusesById.get(r.id));

        if (!Array.isArray(r.detail.spares) || r.detail.spares.length === 0) {
          skippedNoSpares += 1;
          diagnostics.ots_empty_spares.push(r.id);
          console.warn(`[sync-inversa] OT id=${r.id} spares vacío`);
          if (facturada) {
            try {
              await recordFacturadaConstancia({
                ot_id: r.id,
                ot_numero: resolvedOtNumero,
                lineas_persistidas: 0,
              });
            } catch (constanciaErr) {
              const message = errorMessage(constanciaErr);
              console.error(`[sync-inversa] constancia ${r.id}:`, message);
              errors.push({ id: r.id, error: message });
            }
          }
          continue;
        }

        if (diagnostics.sample_spare_keys.length === 0) {
          const firstSpare = r.detail.spares.find(
            (s) => s && typeof s === "object"
          );
          if (firstSpare) {
            diagnostics.sample_spare_keys = Object.keys(firstSpare);
            console.log(
              "[sync-inversa] sample spare keys:",
              diagnostics.sample_spare_keys.join(", ")
            );
          }
        }

        for (const spare of r.detail.spares) {
          if (!spare || typeof spare !== "object") continue;
          diagnostics.spares_seen += 1;
          const delivery = resolveSpareDeliveryDate(spare);
          if (delivery.value) {
            diagnostics.spares_with_delivery_date += 1;
            if (delivery.field) dateFieldsUsed.add(delivery.field);
          } else {
            diagnostics.spares_without_delivery_date += 1;
          }
        }

        const rows = rowsFromDetail(
          r.detail,
          fallbackOtNumero,
          operationTypeById.get(r.id) ?? null
        );
        if (rows.length === 0 && !resolvedOtNumero) {
          skippedNoOtNumero += 1;
          console.warn(
            `[sync-inversa] OT id=${r.id} detalle OK pero sin ot_numero`
          );
          errors.push({
            id: r.id,
            error: "detalle OK pero ot_numero vacío; no se persistió",
          });
          continue;
        }

        try {
          const persisted = await upsertFillNullHeaders(rows, tipoOtColumn);
          insertedAttempted += persisted;
          sparesWithDelivery += rows.length;
          if (facturada) {
            await recordFacturadaConstancia({
              ot_id: r.id,
              ot_numero: resolvedOtNumero,
              lineas_persistidas: persisted,
            });
          }
        } catch (persistErr) {
          const message = errorMessage(persistErr);
          console.error(`[sync-inversa] persist ${r.id}:`, message);
          errors.push({ id: r.id, error: message });
        }
      }
    }

    const listTipoAssignments: Array<{ otId: number; tipo: string }> = [];
    for (const [otId, raw] of operationTypeById) {
      const tipo = TIPO_OT_POR_CLAVE[tipoClave(raw) ?? ""];
      if (tipo) listTipoAssignments.push({ otId, tipo });
    }
    await fillNullTipoOt(tipoOtColumn, listTipoAssignments);

    diagnostics.spare_date_fields_used = Array.from(dateFieldsUsed);
    console.log(
      `[sync-inversa] spares with delivery=${diagnostics.spares_with_delivery_date} without=${diagnostics.spares_without_delivery_date} empty_ot_ids=${diagnostics.ots_empty_spares.join(",") || "(none)"} fields=${diagnostics.spare_date_fields_used.join(",") || "(none)"} skipped_facturada_constancia=${skippedFacturadaWithConstancia} preventivo_descartadas_detalle=${preventivoDiscardedOnDetail}`
    );

    return NextResponse.json({
      success: errors.length === 0,
      entry_date_range,
      total_listed: uniqueIds.length,
      total_details_fetched: detailsFetched,
      details_requested: idsToFetch.length,
      skipped_facturada_with_constancia: skippedFacturadaWithConstancia,
      spares_with_delivery: sparesWithDelivery,
      inserted_attempted: insertedAttempted,
      skipped_no_spares: skippedNoSpares,
      skipped_no_ot_numero: skippedNoOtNumero,
      preventivo: {
        ...preventivo.stats,
        discarded_on_detail: preventivoDiscardedOnDetail,
      },
      diagnostics,
      errors,
    });
  } catch (error) {
    return failureJson(entry_date_range, error);
  }
}
