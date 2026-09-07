import { NextRequest, NextResponse } from "next/server";
import { enforceIfRealSession } from "@/lib/auth/require";
import { supabaseAdmin } from "@/lib/supabase/admin";

const PAGE_SIZE = 1000;

export type StockActualRow = {
  codigo: string;
  repuesto: string | null;
  ubicacion: string | null;
  stock: number | string | null;
  costo_unitario_soles: number | string | null;
};

function mapRow(row: Record<string, unknown>): StockActualRow {
  return {
    codigo: String(row.codigo ?? ""),
    repuesto:
      row.repuesto == null || row.repuesto === ""
        ? null
        : String(row.repuesto),
    ubicacion:
      row.ubicacion == null || row.ubicacion === ""
        ? null
        : String(row.ubicacion),
    stock: (row.stock as number | string | null) ?? null,
    costo_unitario_soles:
      (row.costo_unitario_soles as number | string | null) ?? null,
  };
}

export async function GET(request: NextRequest) {
  const denied = await enforceIfRealSession(
    request,
    "almacen",
    "stock_actual",
    "ver"
  );
  if (denied) return denied;

  try {
    const items: StockActualRow[] = [];

    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabaseAdmin
        .from("repuestos")
        .select("codigo,repuesto,ubicacion,stock,costo_unitario_soles")
        .order("codigo", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500 }
        );
      }

      const rows = (data ?? []) as Record<string, unknown>[];
      for (const row of rows) items.push(mapRow(row));
      if (rows.length < PAGE_SIZE) break;
    }

    return NextResponse.json({ success: true, items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
