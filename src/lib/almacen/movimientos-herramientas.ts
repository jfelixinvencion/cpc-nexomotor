import { NextResponse } from "next/server";
import { HttpError } from "@/lib/auth/require";
import { CONFLICTO_ESTADO_MENSAJE } from "@/lib/almacen/herramientas-concurrencia";
import { supabaseAdmin } from "@/lib/supabase/admin";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INT4_MAX = 2147483647;

export type MovimientoRpc = {
  resultado?: string;
  codigo?: string;
  prestamo_id?: number | null;
  movimiento_id?: number | null;
  herramienta_id?: number | null;
  cantidad?: number | null;
  tipo_movimiento?: string | null;
  cantidad_devuelta?: number | null;
  estado?: string | null;
  stock_cantidad?: number | null;
};

const MENSAJE_VALIDACION: Record<string, string> = {
  RESPONSABLE_REQUERIDO: "Selecciona un responsable.",
  CANTIDAD_INVALIDA: "La cantidad debe ser un entero mayor a 0.",
  CANTIDAD_EXCEDE: "No puedes devolver más que el saldo pendiente.",
};

export function parseUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_RE.test(value.trim())) {
    throw new HttpError("Solicitud inválida.", 400);
  }
  return value.trim();
}

export function parseIdPositivo(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new HttpError("Solicitud inválida.", 400);
  }
  return value;
}

export function parseCantidadPositiva(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > INT4_MAX
  ) {
    throw new HttpError("La cantidad debe ser un entero mayor a 0.", 400);
  }
  return value;
}

export function parseCantidadDevueltaEsperada(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > INT4_MAX
  ) {
    throw new HttpError("Solicitud inválida.", 400);
  }
  return value;
}

function respuestaMovimiento(row: MovimientoRpc) {
  const resultado = row.resultado;
  const codigo = row.codigo ?? "ERROR";
  if (resultado === "ok" || resultado === "replay") {
    return NextResponse.json({
      success: true,
      replay: resultado === "replay",
      codigo,
      data: {
        prestamo_id: row.prestamo_id ?? null,
        movimiento_id: row.movimiento_id ?? null,
        herramienta_id: row.herramienta_id ?? null,
        cantidad: row.cantidad ?? null,
        tipo_movimiento: row.tipo_movimiento ?? null,
        cantidad_devuelta: row.cantidad_devuelta ?? null,
        estado: row.estado ?? null,
        stock_cantidad: row.stock_cantidad ?? null,
      },
    });
  }

  if (resultado === "validacion") {
    return NextResponse.json(
      {
        success: false,
        codigo,
        error: MENSAJE_VALIDACION[codigo] ?? "Solicitud inválida.",
      },
      { status: 400 }
    );
  }

  if (resultado === "conflicto") {
    return NextResponse.json(
      {
        success: false,
        codigo,
        error: CONFLICTO_ESTADO_MENSAJE,
      },
      { status: 409 }
    );
  }

  console.error("[almacen] resultado de movimiento no reconocido:", codigo);
  return NextResponse.json(
    { success: false, error: "Error interno." },
    { status: 500 }
  );
}

function esHerramientaAusente(error: { code?: string; message?: string }) {
  return (
    error.code === "P0001" &&
    (error.message ?? "").includes("HERRAMIENTA_NO_DISPONIBLE")
  );
}

export async function llamarMovimiento(
  fn: "retirar_herramienta" | "devolver_herramienta",
  args: Record<string, unknown>
) {
  const { data, error } = await supabaseAdmin.rpc(fn, args);
  if (error) {
    if (esHerramientaAusente(error)) {
      console.error(`[almacen] ${fn}: herramienta ausente al mover stock`);
      return NextResponse.json(
        {
          success: false,
          codigo: "HERRAMIENTA_NO_DISPONIBLE",
          error: CONFLICTO_ESTADO_MENSAJE,
        },
        { status: 409 }
      );
    }
    console.error(`[almacen] ${fn}:`, error.message);
    throw new HttpError("Error interno.", 500);
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    console.error(`[almacen] ${fn}: respuesta vacía`);
    throw new HttpError("Error interno.", 500);
  }

  return respuestaMovimiento(data as MovimientoRpc);
}
