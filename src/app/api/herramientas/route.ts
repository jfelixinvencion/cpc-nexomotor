import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { enforceIfRealSession } from "@/lib/auth/require";

export type HerramientaRow = {
  id: number;
  codigo: string;
  descripcion: string;
  cantidad: number;
  responsable: string | null;
  ubicacion: string | null;
  created_at?: string;
};

function mapRow(row: Record<string, unknown>): HerramientaRow {
  return {
    id: Number(row.id),
    codigo: String(row.codigo ?? ""),
    descripcion: String(row.descripcion ?? ""),
    cantidad: Number(row.cantidad ?? 0),
    responsable:
      row.responsable == null || row.responsable === ""
        ? null
        : String(row.responsable),
    ubicacion:
      row.ubicacion == null || row.ubicacion === ""
        ? null
        : String(row.ubicacion),
    created_at:
      typeof row.created_at === "string" ? row.created_at : undefined,
  };
}

export async function GET(request: NextRequest) {
  const denied = await enforceIfRealSession(
    request,
    "administracion",
    "herramientas",
    "ver"
  );
  if (denied) return denied;

  const { data, error } = await supabaseAdmin
    .from("herramientas")
    .select("*")
    .order("codigo", { ascending: true });

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    data: (data ?? []).map((row) => mapRow(row as Record<string, unknown>)),
  });
}

export async function POST(request: NextRequest) {
  const denied = await enforceIfRealSession(
    request,
    "administracion",
    "herramientas",
    "crear"
  );
  if (denied) return denied;

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
      .insert({ codigo, descripcion, cantidad, responsable, ubicacion })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: mapRow(data as Record<string, unknown>),
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Solicitud inválida" },
      { status: 400 }
    );
  }
}
