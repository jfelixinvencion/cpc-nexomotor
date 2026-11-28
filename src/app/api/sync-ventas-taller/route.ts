import { NextRequest, NextResponse } from "next/server";
import { sigmaLogin } from "@/lib/sigma/client";
import {
  parseVentasTallerXlsxFromUrl,
  type VentaTallerParsedRow,
} from "@/lib/sigma/parse-ventas-taller-xlsx";
import { getStoredToken } from "@/lib/sigma/token";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 300;

const BATCH_SIZE = 500;
const EXPORT_URL =
  "https://report-api.sigma-peru.com/api/after-sales/workshop-sales/export";
const EXISTING_OT_CHUNK = 100;
/** Tope por respuesta de PostgREST. Cada página de lectura y cada DELETE se quedan dentro. */
const POSTGREST_ROW_CAP = 1000;

type VentaTallerInsert = VentaTallerParsedRow & { last_sync_at: string };
type EstadoOt = "ABIERTO" | "FACTURADO" | "ANULADO";

function isAuthorizedSyncRequest(request: NextRequest): boolean {
  const expected = process.env.SYNC_TRIGGER_SECRET;
  if (!expected) return false;
  return request.headers.get("x-sync-secret") === expected;
}

function isSigmaAuthError(err: unknown): boolean {
  return err instanceof Error && /Sigma error (401|403):/.test(err.message);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} no está definido en las variables de entorno`);
  }
  return value;
}

function toDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildEntryDateRange(now = new Date()) {
  const start = new Date(now);
  start.setMonth(start.getMonth() - 4);
  const end = new Date(now);
  end.setDate(end.getDate() + 1);
  return { start: toDateOnly(start), end: toDateOnly(end) };
}

function coerceId(value: string): string | number {
  const n = Number(value);
  return Number.isFinite(n) && String(n) === value.trim() ? n : value;
}

function normalizeEstado(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

async function fetchWorkshopSalesExport(
  token: string,
  range: { start: string; end: string }
): Promise<string> {
  const body = {
    companyId: coerceId(requireEnv("SIGMA_COMPANY_ID")),
    storeId: coerceId(requireEnv("SIGMA_STORE_ID")),
    section: null,
    withTax: 1,
    type: "DETAIL",
    coinType: null,
    entryDateRange: range,
    closeDateRange: null,
    deliveryDateRange: null,
    invoiceDateRange: null,
  };

  const res = await fetch(EXPORT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-tenant-id": requireEnv("SIGMA_TENANT_ID"),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Sigma error ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as { data?: { fileUrl?: unknown } };
  const fileUrl = json.data?.fileUrl;
  if (typeof fileUrl !== "string" || !fileUrl) {
    throw new Error("No fileUrl in Sigma workshop-sales export response");
  }
  return fileUrl;
}

async function fetchExportWithAuthRetry(range: {
  start: string;
  end: string;
}): Promise<string> {
  let token = await getStoredToken();
  if (!token) token = await sigmaLogin();

  try {
    return await fetchWorkshopSalesExport(token, range);
  } catch (err) {
    if (!isSigmaAuthError(err)) throw err;
    token = await sigmaLogin();
    return fetchWorkshopSalesExport(token, range);
  }
}

function groupByOt(rows: VentaTallerParsedRow[]) {
  const groups = new Map<string, VentaTallerParsedRow[]>();
  for (const row of rows) {
    const list = groups.get(row.ot) ?? [];
    list.push(row);
    groups.set(row.ot, list);
  }
  return groups;
}

function isClosedEstado(estado: string): boolean {
  return estado === "FACTURADO" || estado === "ANULADO";
}

/**
 * El estado de la OT es el del conjunto, no el de una línea.
 * ANULADO gana si aparece una vez. Si no, FACTURADO gana si aparece
 * una vez. Cualquier otro conjunto queda ABIERTO.
 */
function estadoDeOt(
  rows: readonly { estado?: string | null }[]
): EstadoOt {
  let facturado = false;
  for (const row of rows) {
    const estado = normalizeEstado(row.estado);
    if (estado === "ANULADO") return "ANULADO";
    if (estado === "FACTURADO") facturado = true;
  }
  return facturado ? "FACTURADO" : "ABIERTO";
}

/**
 * Estado guardado por OT. Pagina de POSTGREST_ROW_CAP en POSTGREST_ROW_CAP
 * hasta agotar las filas del .in("ot"): una sola respuesta se corta en 1000
 * y las OT que quedan fuera se verían como inexistentes.
 */
async function existingOts(ots: string[]): Promise<Map<string, EstadoOt>> {
  const found = new Map<string, EstadoOt>();

  for (let i = 0; i < ots.length; i += EXISTING_OT_CHUNK) {
    const chunk = ots.slice(i, i + EXISTING_OT_CHUNK);
    const lineas = new Map<string, { estado: string | null }[]>();
    let from = 0;

    for (;;) {
      const { data, error } = await supabaseAdmin
        .from("ventas_taller")
        .select("id,ot,estado")
        .in("ot", chunk)
        .order("id", { ascending: true })
        .range(from, from + POSTGREST_ROW_CAP - 1);
      if (error) throw new Error(error.message);

      const page = data ?? [];
      for (const row of page) {
        if (!row.ot) continue;
        const ot = String(row.ot);
        const list = lineas.get(ot) ?? [];
        list.push({ estado: row.estado ?? null });
        lineas.set(ot, list);
      }

      if (page.length < POSTGREST_ROW_CAP) break;
      from += POSTGREST_ROW_CAP;
    }

    for (const [ot, rows] of lineas) {
      found.set(ot, estadoDeOt(rows));
    }
  }

  return found;
}

function rowsForOts(
  groups: Map<string, VentaTallerParsedRow[]>,
  ots: string[],
  lastSyncAt: string
): VentaTallerInsert[] {
  const rows: VentaTallerInsert[] = [];
  for (const ot of ots) {
    for (const row of groups.get(ot) ?? []) {
      rows.push({ ...row, last_sync_at: lastSyncAt });
    }
  }
  return rows;
}

async function insertBatches(rows: VentaTallerInsert[]) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabaseAdmin.from("ventas_taller").insert(batch);
    if (error) throw new Error(error.message);
  }
}

type FilteredQuery = PromiseLike<{
  count: number | null;
  error: { message: string } | null;
}>;

type TimestampQuery = {
  eq: (column: string, value: string) => FilteredQuery;
  neq: (column: string, value: string) => FilteredQuery;
};

function timestampFilter(
  query: object,
  lastSyncAt: string,
  mode: "new" | "previous"
): FilteredQuery {
  const builder = query as TimestampQuery;
  return mode === "new"
    ? builder.eq("last_sync_at", lastSyncAt)
    : builder.neq("last_sync_at", lastSyncAt);
}

/**
 * Un DELETE también se corta en POSTGREST_ROW_CAP filas y responde sin error.
 * Se repite hasta que el conteo devuelto quede por debajo de ese tope.
 */
async function deleteMatching(
  ots: string[],
  lastSyncAt: string,
  mode: "new" | "previous"
) {
  if (ots.length === 0) return;
  for (let pass = 0; pass < 200; pass++) {
    const query = timestampFilter(
      supabaseAdmin.from("ventas_taller").delete({ count: "exact" }).in("ot", ots),
      lastSyncAt,
      mode
    );
    const { count, error } = await query;
    if (error) throw new Error(error.message);
    const deleted = count ?? 0;
    if (deleted < POSTGREST_ROW_CAP) return;
  }
  throw new Error("borrado incompleto");
}

async function countMatching(
  ots: string[],
  lastSyncAt: string,
  mode: "new" | "previous"
): Promise<number> {
  if (ots.length === 0) return 0;
  const query = timestampFilter(
    supabaseAdmin
      .from("ventas_taller")
      .select("id", { count: "exact", head: true })
      .in("ot", ots),
    lastSyncAt,
    mode
  );
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  if (count == null) throw new Error("sin conteo de filas");
  return count;
}

async function rollbackNewRows(ots: string[], lastSyncAt: string) {
  if (ots.length === 0) return;
  try {
    await deleteMatching(ots, lastSyncAt, "new");
    const left = await countMatching(ots, lastSyncAt, "new");
    if (left !== 0) {
      throw new Error(`revertir insert dejó ${left} filas nuevas`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error(
      `[sync-ventas-taller] no se pudo revertir el insert (${ots.length} OT): ${message}`
    );
    throw err instanceof Error ? err : new Error(message);
  }
}

/**
 * Inserta las filas de esta corrida. Si un lote falla, borra lo ya
 * insertado de esas OT (mismo last_sync_at) y conserva la foto anterior.
 */
async function insertOrRestore(
  ots: string[],
  rows: VentaTallerInsert[],
  lastSyncAt: string
) {
  if (rows.length === 0) return;
  try {
    await insertBatches(rows);
  } catch (err) {
    try {
      await rollbackNewRows(ots, lastSyncAt);
    } catch (rollbackErr) {
      throw new Error(
        `${errorMessage(err)}. Rollback: ${errorMessage(rollbackErr)}`
      );
    }
    throw err;
  }
}

type ClearOutcome = "ok" | "reverted" | "parcial" | "kept";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Error desconocido";
}

/**
 * Borra la foto anterior de una sola OT.
 * Revierte la foto nueva solo cuando el conteo no cambió.
 * Si ya se borró una parte y el reintento no llega a cero, conserva la nueva.
 */
async function clearPreviousSnapshot(
  ot: string,
  lastSyncAt: string
): Promise<ClearOutcome> {
  let antes: number;
  try {
    antes = await countMatching([ot], lastSyncAt, "previous");
  } catch (err) {
    console.error(
      `[sync-ventas-taller] OT ${ot}: no se pudo contar la foto anterior: ${errorMessage(err)}`
    );
    await rollbackNewRows([ot], lastSyncAt);
    return "reverted";
  }
  if (antes === 0) return "ok";

  try {
    await deleteMatching([ot], lastSyncAt, "previous");
  } catch (err) {
    console.error(
      `[sync-ventas-taller] OT ${ot}: borrado de la foto anterior falló: ${errorMessage(err)}`
    );
  }

  let despues: number;
  try {
    despues = await countMatching([ot], lastSyncAt, "previous");
  } catch (err) {
    console.error(
      `[sync-ventas-taller] OT ${ot}: no se pudo verificar el borrado: ${errorMessage(err)}`
    );
    return "kept";
  }

  if (despues === 0) return "ok";
  if (despues === antes) {
    await rollbackNewRows([ot], lastSyncAt);
    return "reverted";
  }
  if (despues > antes) {
    console.error(
      `[sync-ventas-taller] OT ${ot}: las filas viejas pasaron de ${antes} a ${despues}`
    );
    return "kept";
  }

  try {
    await deleteMatching([ot], lastSyncAt, "previous");
  } catch (err) {
    console.error(
      `[sync-ventas-taller] OT ${ot}: reintento de borrado falló: ${errorMessage(err)}`
    );
  }

  let trasReintento: number;
  try {
    trasReintento = await countMatching([ot], lastSyncAt, "previous");
  } catch (err) {
    console.error(
      `[sync-ventas-taller] OT ${ot}: no se pudo verificar el reintento: ${errorMessage(err)}`
    );
    return "parcial";
  }
  if (trasReintento === 0) return "ok";
  return "parcial";
}

type ReplaceReport = {
  reverted: string[];
  parcial: string[];
  kept: string[];
  rollbackFailed: string[];
  errores: string[];
};

/**
 * Inserta la foto nueva y después borra la anterior, OT por OT.
 * rollbackNewRows solo se llama cuando no se borró ninguna fila vieja.
 */
async function replaceStoredOts(
  ots: string[],
  rows: VentaTallerInsert[],
  lastSyncAt: string
): Promise<ReplaceReport> {
  const report: ReplaceReport = {
    reverted: [],
    parcial: [],
    kept: [],
    rollbackFailed: [],
    errores: [],
  };
  if (ots.length === 0 || rows.length === 0) return report;
  await insertOrRestore(ots, rows, lastSyncAt);

  for (const ot of ots) {
    try {
      const outcome = await clearPreviousSnapshot(ot, lastSyncAt);
      if (outcome === "reverted") report.reverted.push(ot);
      else if (outcome === "parcial") report.parcial.push(ot);
      else if (outcome === "kept") report.kept.push(ot);
    } catch (err) {
      const message = errorMessage(err);
      report.rollbackFailed.push(ot);
      report.errores.push(`OT ${ot}: ${message}`);
      console.error(
        `[sync-ventas-taller] OT ${ot}: falló el rollback de la foto nueva: ${message}`
      );
    }
  }

  return report;
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const entryDateRange = buildEntryDateRange();
    const fileUrl = await fetchExportWithAuthRetry(entryDateRange);
    const { rows } = await parseVentasTallerXlsxFromUrl(fileUrl);
    const groups = groupByOt(rows);
    const lastSyncAt = new Date().toISOString();

    const abiertoOts: string[] = [];
    const closedOts: string[] = [];

    for (const [ot, group] of groups) {
      if (estadoDeOt(group) === "ABIERTO") abiertoOts.push(ot);
      else closedOts.push(ot);
    }

    const stored = await existingOts(closedOts);
    const closedNew: string[] = [];
    const closedFirstReplace: string[] = [];
    const closedSkipped: string[] = [];

    for (const ot of closedOts) {
      const saved = stored.get(ot);
      if (!saved) {
        closedNew.push(ot);
      } else if (isClosedEstado(saved)) {
        closedSkipped.push(ot);
      } else {
        closedFirstReplace.push(ot);
      }
    }

    const toReplace = [...abiertoOts, ...closedFirstReplace];
    const replaceRows = rowsForOts(groups, toReplace, lastSyncAt);
    const newClosedRows = rowsForOts(groups, closedNew, lastSyncAt);

    const replaceReport = await replaceStoredOts(
      toReplace,
      replaceRows,
      lastSyncAt
    );
    await insertOrRestore(closedNew, newClosedRows, lastSyncAt);

    const failedDeletes = [
      ...replaceReport.reverted,
      ...replaceReport.parcial,
      ...replaceReport.kept,
      ...replaceReport.rollbackFailed,
    ];
    const reverted = new Set(replaceReport.reverted);
    const filasInsertadas =
      replaceRows.filter((row) => !reverted.has(row.ot)).length +
      newClosedRows.length;
    const borradoFallido = failedDeletes.length > 0;
    const errorDetail = [
      borradoFallido
        ? `Borrado incompleto en ${failedDeletes.length} OT (${replaceReport.parcial.length} con borrado parcial).`
        : "",
      ...replaceReport.errores,
    ]
      .filter(Boolean)
      .join(" ");

    console.log(
      `[sync-ventas-taller] reemplazadas_abiertas=${abiertoOts.length} reemplazadas_primera_cierre=${closedFirstReplace.length} insertadas_cerradas_nuevas=${closedNew.length} saltadas_ya_cerradas=${closedSkipped.length} ots_con_borrado_fallido=${failedDeletes.length} ots_con_borrado_parcial=${replaceReport.parcial.length}`
    );
    if (failedDeletes.length > 0) {
      console.error(
        `[sync-ventas-taller] ots_con_borrado_fallido ${failedDeletes.join(",")}`
      );
    }
    if (replaceReport.parcial.length > 0) {
      console.error(
        `[sync-ventas-taller] ots_con_borrado_parcial ${replaceReport.parcial.join(",")}`
      );
    }

    return NextResponse.json(
      {
        success: !borradoFallido,
        ...(errorDetail ? { error: errorDetail } : {}),
        entryDateRange,
        otsProcesadas: groups.size,
        otsReemplazadasAbiertas: abiertoOts.length,
        otsReemplazadasPrimeraCierre: closedFirstReplace.length,
        otsInsertadasNuevasCerradas: closedNew.length,
        otsSaltadasCerradasExistentes: closedSkipped.length,
        otsConBorradoFallido: failedDeletes.length,
        otsConBorradoParcial: replaceReport.parcial.length,
        filasParseadas: rows.length,
        filasInsertadas,
      },
      { status: borradoFallido ? 500 : 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error("[sync-ventas-taller] error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
