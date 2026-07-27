import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
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
      responsable?: string | null;
      ubicacion?: string | null;
    };

    const codigo = body.codigo?.trim() ?? "";
    const descripcion = body.descripcion?.trim() ?? "";
    const cantidad = Number(body.cantidad);
    const responsable = body.responsable?.trim() || null;
    const ubicacion = body.ubicacion?.trim() || null;

    if (!codigo || !descripcion || !Number.isFinite(cantidad) || cantidad < 0) {
      return NextResponse.json(
        { success: false, error: "Datos inválidos" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("herramientas")
      .update({ codigo, descripcion, cantidad, responsable, ubicacion })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
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

export async function DELETE(_request: NextRequest, context: RouteContext) {
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
