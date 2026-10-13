import { NextRequest, NextResponse } from "next/server";
import { enforceIfRealSession } from "@/lib/auth/require";
import {
  INVERSA_PAGE_SIZE,
  addCategoriaCandidate,
  addCostoCandidate,
  buildInversaResumen,
  enrichInversaLines,
  matchesDetalleFiltros,
  parseDetalleSearchParams,
  toDetalleRow,
  type ClasificacionCategoriaRow,
  type InversaRawRow,
  type RepuestoCostoRow,
} from "@/lib/dashboard-inversa";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 60;

const INVERSA_COLUMNS = [
  "id",
  "ot_id",
  "ot_numero",
  "placa",
  "linea_codigo",
  "linea_descripcion",
  "linea_cantidad",
  "linea_fecha_entrega",
  "estado_repuesto",
  "observaciones",
  "vendido_chatarrero_at",
  "fecha_registro_retorno",
].join(",");

async function fetchAllPages<T>(
  query: (
    from: number,
    to: number
  ) => Promise<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const items: T[] = [];
  for (let from = 0; ; from += INVERSA_PAGE_SIZE) {
    const { data, error } = await query(from, from + INVERSA_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    items.push(...rows);
    if (rows.length < INVERSA_PAGE_SIZE) break;
  }
  return items;
}

async function loadEnrichedLines() {
  const [inversa, stock, clasif] = await Promise.all([
    fetchAllPages<InversaRawRow>(async (from, to) => {
      const { data, error } = await supabaseAdmin
        .from("logistica_inversa")
        .select(INVERSA_COLUMNS)
        .range(from, to);
      return { data: (data as InversaRawRow[] | null) ?? null, error };
    }),
    fetchAllPages<RepuestoCostoRow>(async (from, to) => {
      const { data, error } = await supabaseAdmin
        .from("repuestos")
        .select("codigo,stock,costo_unitario_soles")
        .range(from, to);
      return { data: (data as RepuestoCostoRow[] | null) ?? null, error };
    }),
    fetchAllPages<ClasificacionCategoriaRow>(async (from, to) => {
      const { data, error } = await supabaseAdmin
        .from("repuestos_clasificacion")
        .select("codigo,categoria")
        .range(from, to);
      return {
        data: (data as ClasificacionCategoriaRow[] | null) ?? null,
        error,
      };
    }),
  ]);

  const costos = new Map<string, { stock: number; costo: number | null }>();
  for (const row of stock) addCostoCandidate(costos, row);

  const categorias = new Map<string, string>();
  for (const row of clasif) addCategoriaCandidate(categorias, row);

  return enrichInversaLines(inversa, costos, categorias);
}

export async function GET(request: NextRequest) {
  const denied = await enforceIfRealSession(
    request,
    "dashboard",
    "inversa",
    "ver"
  );
  if (denied) return denied;

  try {
    const detalle = request.nextUrl.searchParams.get("detalle") === "1";
    const { lines, excluidasVendido } = await loadEnrichedLines();

    if (detalle) {
      const parsed = parseDetalleSearchParams(request.nextUrl.searchParams);
      if ("error" in parsed) {
        return NextResponse.json(
          { success: false, error: parsed.error },
          { status: 400 }
        );
      }
      const items = lines
        .filter((line) => matchesDetalleFiltros(line, parsed))
        .map(toDetalleRow);
      return NextResponse.json({ success: true, items });
    }

    const resumen = buildInversaResumen(lines, excluidasVendido);
    return NextResponse.json({ success: true, ...resumen });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("[dashboard-inversa] GET:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
