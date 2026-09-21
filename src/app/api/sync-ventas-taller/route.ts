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

type VentaTallerInsert = VentaTallerParsedRow & { last_sync_at: string };

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

async function existingOts(ots: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < ots.length; i += EXISTING_OT_CHUNK) {
    const chunk = ots.slice(i, i + EXISTING_OT_CHUNK);
    const { data, error } = await supabaseAdmin
      .from("ventas_taller")
      .select("ot")
      .in("ot", chunk);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (row.ot) found.add(String(row.ot));
    }
  }
  return found;
}

async function insertBatches(rows: VentaTallerInsert[]) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabaseAdmin.from("ventas_taller").insert(batch);
    if (error) throw new Error(error.message);
  }
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
    const unknownOts: string[] = [];

    for (const [ot, group] of groups) {
      const estado = normalizeEstado(group[0]?.estado);
      if (estado === "ABIERTO") abiertoOts.push(ot);
      else if (estado === "ANULADO" || estado === "FACTURADO") {
        closedOts.push(ot);
      } else {
        unknownOts.push(ot);
      }
    }

    const already = await existingOts(closedOts);
    const closedToInsert = closedOts.filter((ot) => !already.has(ot));
    const skippedExisting = closedOts.length - closedToInsert.length;

    if (abiertoOts.length > 0) {
      for (let i = 0; i < abiertoOts.length; i += EXISTING_OT_CHUNK) {
        const chunk = abiertoOts.slice(i, i + EXISTING_OT_CHUNK);
        const { error } = await supabaseAdmin
          .from("ventas_taller")
          .delete()
          .in("ot", chunk);
        if (error) throw new Error(error.message);
      }
    }

    const toInsert: VentaTallerInsert[] = [];
    for (const ot of abiertoOts) {
      for (const row of groups.get(ot) ?? []) {
        toInsert.push({ ...row, last_sync_at: lastSyncAt });
      }
    }
    for (const ot of closedToInsert) {
      for (const row of groups.get(ot) ?? []) {
        toInsert.push({ ...row, last_sync_at: lastSyncAt });
      }
    }

    await insertBatches(toInsert);

    return NextResponse.json({
      success: true,
      entryDateRange,
      otsProcesadas: groups.size,
      otsReemplazadasAbiertas: abiertoOts.length,
      otsInsertadasNuevasCerradas: closedToInsert.length,
      otsSaltadasCerradasExistentes: skippedExisting,
      otsEstadoDesconocido: unknownOts.length,
      filasParseadas: rows.length,
      filasInsertadas: toInsert.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error("[sync-ventas-taller] error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
