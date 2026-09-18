import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { enforceIfRealSession } from "@/lib/auth/require";
import {
  fetchAllClasificacion,
  fetchAllRepuestosMinimos,
  INSERT_BATCH_SIZE,
} from "@/lib/repuestos-clasificacion-db";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const denied = await enforceIfRealSession(
    request,
    "administracion",
    "repuestos",
    "editar"
  );
  if (denied) return denied;

  try {
    const [repuestos, clasificacion] = await Promise.all([
      fetchAllRepuestosMinimos(),
      fetchAllClasificacion(),
    ]);

    const existing = new Set(
      clasificacion.map((row) => row.codigo).filter(Boolean)
    );
    const missing = Array.from(
      new Set(repuestos.map((row) => row.codigo).filter(Boolean))
    ).filter((codigo) => !existing.has(codigo));

    if (missing.length === 0) {
      return NextResponse.json({ success: true, inserted: 0 });
    }

    const now = new Date().toISOString();
    let inserted = 0;

    for (let i = 0; i < missing.length; i += INSERT_BATCH_SIZE) {
      const batch = missing.slice(i, i + INSERT_BATCH_SIZE).map((codigo) => ({
        codigo,
        tipo_sku: null,
        categoria: null,
        sub_categoria: null,
        obsolescencia: null,
        consumo_prom_dia: null,
        created_at: now,
        updated_at: now,
      }));

      const { data, error } = await supabaseAdmin
        .from("repuestos_clasificacion")
        .upsert(batch, { onConflict: "codigo", ignoreDuplicates: true })
        .select("codigo");

      if (error) throw new Error(error.message);
      inserted += (data ?? []).length;
    }

    return NextResponse.json({ success: true, inserted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("[repuestos-clasificacion] sync-nuevos:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
