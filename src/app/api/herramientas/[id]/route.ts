import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { enforceIfRealSession } from "@/lib/auth/require";
import { CONFLICTO_ESTADO_MENSAJE } from "@/lib/almacen/herramientas-concurrencia";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const denied = await enforceIfRealSession(
    request,
    "administracion",
    "herramientas",
    "editar"
  );
  if (denied) return denied;

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (!id) {
    return NextResponse.json(
      { success: false, error: "ID inválido" },
      { status: 400 }
    );
  }

  try {
    const body = (await request.json()) as {
      codigo?: string;
      descripcion?: string;
      cantidad?: number;
      cantidad_esperada?: number;
      responsable?: string | null;
      ubicacion?: string | null;
    };

    const codigo = body.codigo?.trim() ?? "";
    const descripcion = body.descripcion?.trim() ?? "";
    const cantidad = Number(body.cantidad);
    const cantidadEsperada = body.cantidad_esperada;
    const responsable = body.responsable?.trim() || null;
    const ubicacion = body.ubicacion?.trim() || null;

    if (
      !codigo ||
      !descripcion ||
      !Number.isFinite(cantidad) ||
      cantidad < 0 ||
      typeof cantidadEsperada !== "number" ||
      !Number.isInteger(cantidadEsperada) ||
      cantidadEsperada < 0
    ) {
      return NextResponse.json(
        { success: false, error: "Datos inválidos" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("herramientas")
      .update({ codigo, descripcion, cantidad, responsable, ubicacion })
      .eq("id", id)
      .eq("cantidad", cantidadEsperada)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("[herramientas] update:", error.message);
      return NextResponse.json(
        { success: false, error: "Error interno." },
        { status: 500 }
      );
    }

    if (!data) {
      const { data: exists, error: existsError } = await supabaseAdmin
        .from("herramientas")
        .select("id")
        .eq("id", id)
        .maybeSingle();
      if (existsError) {
        console.error("[herramientas] update exists:", existsError.message);
        return NextResponse.json(
          { success: false, error: "Error interno." },
          { status: 500 }
        );
      }
      if (!exists) {
        return NextResponse.json(
          { success: false, error: "No se encontró la herramienta." },
          { status: 404 }
        );
      }
      return NextResponse.json(
        {
          success: false,
          codigo: "STOCK_CAMBIO",
          error: CONFLICTO_ESTADO_MENSAJE,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch {
    return NextResponse.json(
      { success: false, error: "Solicitud inválida" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const denied = await enforceIfRealSession(
    request,
    "administracion",
    "herramientas",
    "eliminar"
  );
  if (denied) return denied;

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (!id) {
    return NextResponse.json(
      { success: false, error: "ID inválido" },
      { status: 400 }
    );
  }

  const { error } = await supabaseAdmin
    .from("herramientas")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
