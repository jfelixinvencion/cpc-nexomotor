import { NextRequest, NextResponse } from "next/server";
import {
  isAuthAccion,
  isAuthModulo,
  isAuthPestana,
  type PermisoItem,
} from "@/lib/auth/permissions";
import { AuthError, authErrorResponse, requireSession } from "@/lib/auth/require";
import { supabaseAdmin } from "@/lib/supabase/admin";

type PermisoRow = {
  modulo?: string;
  pestana?: string;
  accion?: string;
  permitido?: boolean;
};

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request);

    const { data: userData, error: userError } = await supabaseAdmin
      .from("usuarios")
      .select("username,nombre_completo,perfil_id,activo")
      .eq("id", session.usuarioId)
      .maybeSingle();

    if (userError) {
      console.error("[auth] me usuarios:", userError.message);
      return NextResponse.json(
        { success: false, error: "No se pudo obtener la sesión." },
        { status: 500 }
      );
    }

    const user = userData as {
      username?: string;
      nombre_completo?: string | null;
      perfil_id?: string;
      activo?: boolean;
    } | null;

    if (!user || user.activo !== true) {
      return NextResponse.json({ success: false, error: "No autenticado." }, { status: 401 });
    }

    const { data: perfilData, error: perfilError } = await supabaseAdmin
      .from("perfiles")
      .select("id,nombre")
      .eq("id", session.perfilId)
      .maybeSingle();

    if (perfilError) {
      console.error("[auth] me perfiles:", perfilError.message);
      return NextResponse.json(
        { success: false, error: "No se pudo obtener el perfil." },
        { status: 500 }
      );
    }

    const perfilNombre =
      (perfilData as { nombre?: string } | null)?.nombre ?? session.perfilNombre;

    const { data: permisoRows, error: permisosError } = await supabaseAdmin
      .from("perfil_permisos")
      .select("modulo,pestana,accion,permitido")
      .eq("perfil_id", session.perfilId)
      .eq("permitido", true);

    if (permisosError) {
      console.error("[auth] me perfil_permisos:", permisosError.message);
      return NextResponse.json(
        { success: false, error: "No se pudieron obtener los permisos." },
        { status: 500 }
      );
    }

    const permisos: PermisoItem[] = [];
    for (const row of (permisoRows as PermisoRow[] | null) ?? []) {
      const modulo = String(row.modulo ?? "");
      const pestana = String(row.pestana ?? "");
      const accion = String(row.accion ?? "");
      if (!isAuthModulo(modulo) || !isAuthPestana(pestana) || !isAuthAccion(accion)) {
        continue;
      }
      permisos.push({ modulo, pestana, accion });
    }

    return NextResponse.json({
      success: true,
      data: {
        username: user.username ?? session.username,
        nombreCompleto: user.nombre_completo ?? session.username,
        perfil: perfilNombre,
        permisos,
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("[auth] me:", message);
    return NextResponse.json(
      { success: false, error: "No se pudo obtener la sesión." },
      { status: 500 }
    );
  }
}
