import { NextRequest, NextResponse } from "next/server";
import { enforceIfRealSession } from "@/lib/auth/require";
import { importarClasificacion } from "@/lib/repuestos-clasificacion-db";
import type { ImportFilaRaw } from "@/lib/repuestos-clasificacion";

export const maxDuration = 60;

const MAX_FILAS = 8000;

export async function POST(request: NextRequest) {
  const denied = await enforceIfRealSession(
    request,
    "administracion",
    "repuestos",
    "editar"
  );
  if (denied) return denied;

  try {
    const body = (await request.json().catch(() => null)) as {
      filas?: unknown;
      apply?: unknown;
    } | null;
    if (!body || !Array.isArray(body.filas)) {
      return NextResponse.json(
        { success: false, error: "Debe enviar un arreglo de filas." },
        { status: 400 }
      );
    }
    if (body.filas.length > MAX_FILAS) {
      return NextResponse.json(
        {
          success: false,
          error: `El Excel supera el máximo de ${MAX_FILAS} filas.`,
        },
        { status: 400 }
      );
    }

    const filas: ImportFilaRaw[] = body.filas.map((item) => {
      const row = (item ?? {}) as Record<string, unknown>;
      return {
        codigo: row.codigo,
        tipo_sku: row.tipo_sku,
        categoria: row.categoria,
        sub_categoria: row.sub_categoria,
        obsolescencia: row.obsolescencia,
      };
    });

    const apply = body.apply === true;
    const result = await importarClasificacion(filas, apply);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("[repuestos-clasificacion] importar:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
