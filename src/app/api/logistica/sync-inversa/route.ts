import { NextRequest, NextResponse } from "next/server";
import { sigmaLogin } from "@/lib/sigma/client";
import { getStoredToken } from "@/lib/sigma/token";
import { supabaseAdmin } from "@/lib/supabase/admin";

const LIST_URL =
  "https://report-api.sigma-peru.com/api/after-sales/work-orders";
const DETAIL_URL_BASE =
  "https://dms-api.sigma-peru.com/api/after-sale/work-order-spare/work-order";

/** Fixed range for this debug pass (do not switch to rolling 30 days yet). */
const ENTRY_DATE_START = "2026-07-11";
const ENTRY_DATE_END = "2026-08-10";
const PER_PAGE = 100;
const LIST_PAGE = 1;
const DETAIL_CONCURRENCY = 4;
const INSERT_BATCH = 100;

type SigmaWorkOrderListItem = {
  id?: string | number | null;
  work_order_number?: string | number | null;
  number?: string | number | null;
  operation_type?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
};

type SigmaSpare = {
  code?: string | null;
  description?: string | null;
  quantity?: number | null;
  delivery_date?: string | null;
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
  source_payload: SigmaSpare;
};

type DetailError = { id: number; error: string };

type ListDiagnostics = {
  report_status: number | null;
  top_level_keys: string[];
  data_typeof: string;
  detected_count_before_id_filter: number;
  sample_first_3: unknown[];
  entry_date_range: { start: string; end: string };
  request_body: Record<string, unknown>;
  request_method: "POST";
  x_tenant_id: string;
  list_path_used: string | null;
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

function buildListRequestBody(): Record<string, unknown> {
  return {
    advisor_ids: null,
    brand_id: null,
    car_plate: null,
    car_vin: null,
    client_query: null,
    close_date_range: null,
    delivery_date_range: {
      start: null,
      end: null,
    },
    entry_date_range: {
      start: ENTRY_DATE_START,
      end: ENTRY_DATE_END,
    },
    insurer_id: null,
    invoice_date_range: null,
    is_quote: 0,
    page: LIST_PAGE,
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
    work_order_type_operations: [2],
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

async function fetchWorkOrderListPage(token: string): Promise<ListFetchResult> {
  const body = buildListRequestBody();
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

function rowConflictKey(row: {
  ot_id: number;
  linea_codigo: string;
  linea_fecha_entrega: string;
}): string {
  return `${row.ot_id}|${row.linea_codigo}|${row.linea_fecha_entrega}`;
}

/**
 * Map detail → rows. Header fields (placa, cliente, ot_numero) are shared
 * across every spare line of the OT.
 */
function rowsFromDetail(
  detail: SpareDetailPayload | null | undefined,
  fallbackOtNumero: string | null
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

  const rows: LogisticaInversaRow[] = [];

  for (const spare of detail.spares) {
    if (!spare || typeof spare !== "object") continue;
    if (!hasDeliveryDate(spare.delivery_date)) continue;

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
      linea_fecha_entrega: String(spare.delivery_date).trim(),
      source_payload: spare,
    });
  }

  return rows;
}

/**
 * Insert new rows; on conflict fill placa/cliente_nombre/ot_numero ONLY when
 * the existing column is NULL. Never touch manual fields
 * (responsable_entrega, estado_repuesto, observaciones).
 *
 * Equivalent to:
 *   ON CONFLICT (...) DO UPDATE SET
 *     placa = COALESCE(logistica_inversa.placa, EXCLUDED.placa),
 *     cliente_nombre = COALESCE(..., EXCLUDED.cliente_nombre),
 *     ot_numero = COALESCE(..., EXCLUDED.ot_numero)
 */
async function upsertFillNullHeaders(
  rows: LogisticaInversaRow[]
): Promise<number> {
  const valid = rows.filter(
    (r) =>
      r.ot_numero != null &&
      String(r.ot_numero).trim() !== "" &&
      r.linea_codigo != null &&
      r.linea_fecha_entrega != null
  );

  if (valid.length === 0) return 0;

  let attempted = 0;
  for (let i = 0; i < valid.length; i += INSERT_BATCH) {
    const batch = valid.slice(i, i + INSERT_BATCH);

    const { error: insertError } = await supabaseAdmin
      .from("logistica_inversa")
      .upsert(batch, {
        onConflict: "ot_id,linea_codigo,linea_fecha_entrega",
        ignoreDuplicates: true,
      });

    if (insertError) {
      throw new Error(`Supabase upsert insert: ${insertError.message}`);
    }

    const otIds = Array.from(new Set(batch.map((r) => r.ot_id)));
    const { data: existing, error: selectError } = await supabaseAdmin
      .from("logistica_inversa")
      .select(
        "id, ot_id, linea_codigo, linea_fecha_entrega, placa, cliente_nombre, ot_numero"
      )
      .in("ot_id", otIds)
      .or("placa.is.null,cliente_nombre.is.null,ot_numero.is.null");

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
          linea_fecha_entrega: String(ex.linea_fecha_entrega),
        })
      );
      if (!incoming) continue;

      const patch: {
        placa?: string;
        cliente_nombre?: string;
        ot_numero?: string;
      } = {};

      if (ex.placa == null && incoming.placa != null) {
        patch.placa = incoming.placa;
      }
      if (ex.cliente_nombre == null && incoming.cliente_nombre != null) {
        patch.cliente_nombre = incoming.cliente_nombre;
      }
      if (ex.ot_numero == null && incoming.ot_numero != null) {
        patch.ot_numero = incoming.ot_numero;
      }

      if (Object.keys(patch).length === 0) continue;

      const { error: updateError } = await supabaseAdmin
        .from("logistica_inversa")
        .update(patch)
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

function emptyDiagnostics(
  partial?: Partial<ListDiagnostics>
): ListDiagnostics {
  return {
    report_status: null,
    top_level_keys: [],
    data_typeof: "undefined",
    detected_count_before_id_filter: 0,
    sample_first_3: [],
    entry_date_range: { start: ENTRY_DATE_START, end: ENTRY_DATE_END },
    request_body: buildListRequestBody(),
    request_method: "POST",
    x_tenant_id: process.env.SIGMA_TENANT_ID ?? "(missing)",
    list_path_used: null,
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
      diagnostics: diagnostics ?? emptyDiagnostics(),
      errors: [{ id: -1, error: message }],
      error: message,
    },
    { status: 500 }
  );
}

export async function POST(request: NextRequest) {
  const entry_date_range = { start: ENTRY_DATE_START, end: ENTRY_DATE_END };

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

    let listResult = await fetchWorkOrderListPage(token);
    if (
      !listResult.ok &&
      (listResult.status === 401 || listResult.status === 403)
    ) {
      token = await sigmaLogin();
      listResult = await fetchWorkOrderListPage(token);
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
          diagnostics: emptyDiagnostics({
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
    const ids: number[] = [];
    for (const wo of list) {
      const id = parseOtId(wo.id);
      if (id == null) continue;
      ids.push(id);
      const otNum =
        asNonEmptyString(wo.work_order_number) ?? asNonEmptyString(wo.number);
      if (otNum) otNumeroById.set(id, otNum);
    }
    const uniqueIds = Array.from(new Set(ids));

    const diagnostics: ListDiagnostics = {
      report_status: listResult.status,
      top_level_keys: topLevelKeys(payload),
      data_typeof: describeDataType(rootData),
      detected_count_before_id_filter: list.length,
      sample_first_3: list.slice(0, 3).map(sanitizeSampleItem),
      entry_date_range,
      request_body: listResult.body,
      request_method: "POST",
      x_tenant_id: listResult.tenantId,
      list_path_used: path,
    };

    if (uniqueIds.length === 0) {
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
            error:
              list.length === 0
                ? "Listado vacío o estructura de respuesta no reconocida"
                : "Se detectaron filas pero ningún id parseable",
          },
        ],
        error:
          list.length === 0
            ? "Listado vacío o estructura de respuesta no reconocida"
            : "Se detectaron filas pero ningún id parseable",
      });
    }

    const tokenRef = { token };
    const collected: LogisticaInversaRow[] = [];
    let detailsFetched = 0;
    let sparesWithDelivery = 0;
    let skippedNoSpares = 0;
    let skippedNoOtNumero = 0;

    for (let i = 0; i < uniqueIds.length; i += DETAIL_CONCURRENCY) {
      const chunk = uniqueIds.slice(i, i + DETAIL_CONCURRENCY);
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
          // Missing detail or missing spares should not abort the whole sync.
          if (!("error" in r) || !r.error) {
            skippedNoSpares += 1;
            continue;
          }
          console.error(`[sync-inversa] detail ${r.id}:`, errMsg);
          errors.push({ id: r.id, error: errMsg });
          continue;
        }

        if (!Array.isArray(r.detail.spares) || r.detail.spares.length === 0) {
          skippedNoSpares += 1;
          continue;
        }

        detailsFetched += 1;
        const before = collected.length;
        const rows = rowsFromDetail(
          r.detail,
          otNumeroById.get(r.id) ?? null
        );
        if (
          rows.length === 0 &&
          Array.isArray(r.detail.spares) &&
          r.detail.spares.length > 0 &&
          !resolveOtNumero(r.detail, otNumeroById.get(r.id) ?? null)
        ) {
          skippedNoOtNumero += 1;
        }
        sparesWithDelivery += rows.length;
        collected.push(...rows);
        void before;
      }
    }

    let insertedAttempted = 0;
    try {
      insertedAttempted = await upsertFillNullHeaders(collected);
    } catch (insertErr) {
      const message = errorMessage(insertErr);
      console.error("[sync-inversa] insert failed:", message);
      return NextResponse.json(
        {
          success: false,
          entry_date_range,
          total_listed: uniqueIds.length,
          total_details_fetched: detailsFetched,
          spares_with_delivery: sparesWithDelivery,
          inserted_attempted: 0,
          skipped_no_spares: skippedNoSpares,
          skipped_no_ot_numero: skippedNoOtNumero,
          diagnostics,
          errors: [...errors, { id: -1, error: message }],
          error: message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: errors.length === 0,
      entry_date_range,
      total_listed: uniqueIds.length,
      total_details_fetched: detailsFetched,
      spares_with_delivery: sparesWithDelivery,
      inserted_attempted: insertedAttempted,
      skipped_no_spares: skippedNoSpares,
      skipped_no_ot_numero: skippedNoOtNumero,
      diagnostics,
      errors,
    });
  } catch (error) {
    return failureJson(entry_date_range, error);
  }
}
