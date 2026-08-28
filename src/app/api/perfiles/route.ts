import { NextRequest } from "next/server";
import {
  expandPermisosForClient,
  parsePermisosPayload,
} from "@/lib/auth/permissions";
import {
  countUsuariosByPerfil,
  getPermisosAllowed,
  getPerfilById,
  type PerfilRow,
  PERFIL_SELECT,
  replacePerfilPermisos,
} from "@/lib/auth/admin-rules";
import {
  handleAuthRoute,
  HttpError,
  jsonOk,
  requirePermission,
} from "@/lib/auth/require";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  return handleAuthRoute(request, async (session) => {
    await requirePermission(session, "administracion", "perfiles", "ver");

    const { data, error } = await supabaseAdmin
      .from("perfiles")
      .select(PERFIL_SELECT)
      .order("nombre", { ascending: true });
    if (error) {
      console.error("[auth] list perfiles:", error.message);
      throw new HttpError("No se pudieron listar los perfiles.", 500);
    }

    const counts = await countUsuariosByPerfil();
    const items = ((data as PerfilRow[] | null) ?? []).map((row) => ({
      id: row.id,
      nombre: row.nombre,
      descripcion: row.descripcion,
      activo: row.activo,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      usuariosAsignados: counts.get(row.id) ?? 0,
    }));
    return jsonOk({ data: items });
  });
}

export async function POST(request: NextRequest) {
  return handleAuthRoute(request, async (session) => {
    await requirePermission(session, "administracion", "perfiles", "crear");

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) throw new HttpError("Solicitud inválida.", 400);

    const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
    if (!nombre) throw new HttpError("El nombre del perfil es obligatorio.", 400);
    if (nombre.length > 80) throw new HttpError("El nombre es demasiado largo.", 400);

    const descripcion =
      typeof body.descripcion === "string" ? body.descripcion.trim() || null : null;

    const parsed = parsePermisosPayload(body.permisos);
    if ("error" in parsed) throw new HttpError(parsed.error, 400);

    const { data: existing } = await supabaseAdmin
      .from("perfiles")
      .select("id")
      .ilike("nombre", nombre)
      .maybeSingle();
    if (existing) {
      throw new HttpError("Ya existe un perfil con ese nombre.", 409);
    }

    const { data: created, error: insErr } = await supabaseAdmin
      .from("perfiles")
      .insert({ nombre, descripcion, activo: true })
      .select(PERFIL_SELECT)
      .single();

    if (insErr || !created) {
      if (insErr?.code === "23505") {
        throw new HttpError("Ya existe un perfil con ese nombre.", 409);
      }
      console.error("[auth] insert perfil:", insErr?.message);
      throw new HttpError("No se pudo crear el perfil.", 500);
    }

    const row = created as PerfilRow;
    try {
      await replacePerfilPermisos(row.id, parsed);
    } catch (err) {
      await supabaseAdmin.from("perfiles").delete().eq("id", row.id);
      throw err;
    }

    const saved = await getPerfilById(row.id);
    if (!saved) throw new HttpError("No se pudo crear el perfil.", 500);
    return jsonOk(
      {
        data: {
          perfil: {
            id: saved.id,
            nombre: saved.nombre,
            descripcion: saved.descripcion,
            activo: saved.activo,
          },
          permisos: expandPermisosForClient(await getPermisosAllowed(saved.id)),
          usuariosAsignados: 0,
        },
      },
      201
    );
  });
}
