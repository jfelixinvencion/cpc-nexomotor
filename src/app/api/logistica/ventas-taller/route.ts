import { NextRequest, NextResponse } from "next/server";
import { enforceIfRealSession } from "@/lib/auth/require";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 60;

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_FILTER_VALUES = 40;
const MAX_FILTER_VALUE_LEN = 80;
const FACET_PAGE_SIZE = 1000;
const FACET_ROW_CAP = 20000;

const VENTAS_TALLER_SELECT = [
  "id",
  "seccion",
  "ot",
  "fecha_ingreso",
  "tipo_ot",
  "estado",
  "estado_vehiculo",
  "placa",
  "vin",
  "motor",
  "marca",
  "modelo_tecnico",
  "anio_modelo",
  "tipo",
  "codigo",
  "descripcion",
  "cant_solicitada",
  "precio_total_soles",
  "costo_unitario_soles",
  "costo_total_soles",
  "margen_total_soles",
  "observaciones",
].join(",");

const SEARCH_TEXT_COLUMNS = [
  "ot",
  "placa",
  "codigo",
  "descripcion",
] as const;

const ESTADOS_PERMITIDOS = ["ABIERTO", "ANULADO", "FACTURADO"] as const;
const ESTADOS_PERMITIDOS_SET = new Set<string>(ESTADOS_PERMITIDOS);

function parseStates(raw: string | null): string[] {
  if (raw == null || raw.trim() === "") return [];
  const seen = new Set<string>();
  const allowed: string[] = [];
  for (const part of raw.split(",")) {
    const value = part.trim().toUpperCase();
    if (!ESTADOS_PERMITIDOS_SET.has(value) || seen.has(value)) continue;
    seen.add(value);
    allowed.push(value);
  }
  return allowed;
}

function parseFilterValues(raw: string | null): string[] {
  if (raw == null || raw.trim() === "") return [];
  const seen = new Set<string>();
  const allowed: string[] = [];
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (!value || value.length > MAX_FILTER_VALUE_LEN) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    allowed.push(value);
    if (allowed.length >= MAX_FILTER_VALUES) break;
  }
  return allowed;
}

function escapeIlike(raw: string) {
  return raw
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/"/g, '\\"');
}

function parsePage(raw: string | null, fallback: number) {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function parseFechaSearch(raw: string): string | null {
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const month = m[2].padStart(2, "0");
  return `${m[3]}-${month}-${day}`;
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

function uniqueSorted(values: Set<string>) {
  return Array.from(values).sort((a, b) => a.localeCompare(b, "es"));
}

async function loadFacets() {
  const tipoOt = new Set<string>();
  const tipos = new Set<string>();
  let from = 0;

  for (;;) {
    const { data, error } = await supabaseAdmin
      .from("ventas_taller")
      .select("tipo_ot,tipo")
      .range(from, from + FACET_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    const rows = (data as { tipo_ot?: unknown; tipo?: unknown }[] | null) ?? [];
    for (const row of rows) {
      const tipoOtValue = String(row.tipo_ot ?? "").trim();
      if (tipoOtValue) tipoOt.add(tipoOtValue);
      const tipoValue = String(row.tipo ?? "").trim();
      if (tipoValue) tipos.add(tipoValue);
    }

    if (rows.length < FACET_PAGE_SIZE) break;
    from += FACET_PAGE_SIZE;
    if (from >= FACET_ROW_CAP) break;
  }

  return {
    estados: [...ESTADOS_PERMITIDOS],
    tipo_ot: uniqueSorted(tipoOt),
    tipos: uniqueSorted(tipos),
  };
}

export async function GET(request: NextRequest) {
  const denied = await enforceIfRealSession(
    request,
    "logistica",
    "ventas_taller",
    "ver"
  );
  if (denied) return denied;

  try {
    const sp = request.nextUrl.searchParams;

    if (sp.get("facets") === "1") {
      const facets = await loadFacets();
      return NextResponse.json({ success: true, facets });
    }

    const search = (sp.get("search") ?? "").trim();
    const states = parseStates(sp.get("states"));
    const tipoOt = parseFilterValues(sp.get("tipo_ot"));
    const tipos = parseFilterValues(sp.get("tipos"));
    const page = parsePage(sp.get("page"), DEFAULT_PAGE);
    const pageSizeRaw = parsePage(sp.get("page_size"), DEFAULT_PAGE_SIZE);
    if (page == null) return jsonError("page inválido.", 400);
    if (pageSizeRaw == null) return jsonError("page_size inválido.", 400);
    const page_size = Math.min(pageSizeRaw, MAX_PAGE_SIZE);

    const from = (page - 1) * page_size;
    const to = from + page_size - 1;

    let query = supabaseAdmin
      .from("ventas_taller")
      .select(VENTAS_TALLER_SELECT, { count: "exact" })
      .order("fecha_ingreso", { ascending: false, nullsFirst: false })
      .order("ot", { ascending: false })
      .order("id", { ascending: false });

    if (states.length > 0) query = query.in("estado", states);
    if (tipoOt.length > 0) query = query.in("tipo_ot", tipoOt);
    if (tipos.length > 0) query = query.in("tipo", tipos);

    if (search) {
      const pattern = `"%${escapeIlike(search)}%"`;
      const orParts = SEARCH_TEXT_COLUMNS.map(
        (col) => `${col}.ilike.${pattern}`
      );
      const fecha = parseFechaSearch(search);
      if (fecha) orParts.push(`fecha_ingreso.eq.${fecha}`);
      query = query.or(orParts.join(","));
    }

    const { data, error, count } = await query.range(from, to);
    if (error) {
      console.error("[ventas-taller] list:", error.message);
      return jsonError("No se pudieron listar las ventas de taller.", 500);
    }

    const items = data ?? [];
    const total = count ?? items.length;
    const has_more = from + items.length < total;

    return NextResponse.json({
      success: true,
      items,
      total,
      page,
      page_size,
      has_more,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("[ventas-taller] list:", message);
    return NextResponse.json(
      { success: false, error: "Error interno." },
      { status: 500 }
    );
  }
}
