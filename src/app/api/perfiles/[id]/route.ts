import { NextRequest } from "next/server";
import {
  expandPermisosForClient,
  parsePermisosPayload,
} from "@/lib/auth/permissions";
import {
  assertCanChangePerfilAdminRole,
  assertCanDeactivatePerfil,
  countUsuariosByPerfil,
  getPermisosAllowed,
  getPerfilById,
  isUuid,
  PERFIL_SELECT,
  replacePerfilPermisos,
  type PerfilRow,
} from "@/lib/auth/admin-rules";
import {
  handleAuthRoute,
  HttpError,
  jsonOk,
  requirePermission,
} from "@/lib/auth/require";
import { supabaseAdmin } from "@/lib/supabase/admin";

type RouteContext = { params: Promise<{ id: string }> };

async function parseId(context: RouteContext) {
  const { id } = await context.params;
  if (!isUuid(id)) throw new HttpError("ID inválido.", 400);
  return id;
}

function detailPayload(perfil: PerfilRow, usuariosAsignados: number, permisos: ReturnType<typeof expandPermisosForClient>) {
  return {
    perfil: {
      id: perfil.id,
      nombre: perfil.nombre,
      descripcion: perfil.descripcion,
      activo: perfil.activo,
    },
    permisos,
    usuariosAsignados,
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  return handleAuthRoute(request, async (session) => {
    await requirePermission(session, "administracion", "perfiles", "ver");
    const id = await parseId(context);
    const perfil = await getPerfilById(id);
    if (!perfil) throw new HttpError("Perfil no encontrado.", 404);
    const counts = await countUsuariosByPerfil(id);
    const permisos = expandPermisosForClient(await getPermisosAllowed(id));
    return jsonOk({
      data: detailPayload(perfil, counts.get(id) ?? 0, permisos),
    });
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return handleAuthRoute(request, async (session) => {
    const id = await parseId(context);
    const existing = await getPerfilById(id);
    if (!existing) throw new HttpError("Perfil no encontrado.", 404);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) throw new HttpError("Solicitud inválida.", 400);

    const hasNombre = typeof body.nombre === "string";
    const hasDescripcion = "descripcion" in body;
    const hasPermisos = "permisos" in body;
    const hasActivo = typeof body.activo === "boolean";

    if (!hasNombre && !hasDescripcion && !hasPermisos && !hasActivo) {
      throw new HttpError("No hay campos para actualizar.", 400);
    }

    const wantsDeactivate = hasActivo && body.activo === false;
    const otherChanges =
      hasNombre ||
      hasDescripcion ||
      hasPermisos ||
      (hasActivo && body.activo === true);

    if (wantsDeactivate) {
      await requirePermission(session, "administracion", "perfiles", "desactivar");
      if (existing.activo) {
        await assertCanDeactivatePerfil(existing, session.perfilId);
      }
    }
    if (otherChanges) {
      await requirePermission(session, "administracion", "perfiles", "editar");
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (hasNombre) {
      const nombre = String(body.nombre).trim();
      if (!nombre) throw new HttpError("El nombre del perfil es obligatorio.", 400);
      if (nombre.length > 80) throw new HttpError("El nombre es demasiado largo.", 400);
      if (nombre.toLowerCase() !== existing.nombre.toLowerCase()) {
        const { data: dup } = await supabaseAdmin
          .from("perfiles")
          .select("id")
          .ilike("nombre", nombre)
          .neq("id", id)
          .maybeSingle();
        if (dup) throw new HttpError("Ya existe un perfil con ese nombre.", 409);
      }
      patch.nombre = nombre;
    }

    if (hasDescripcion) {
      patch.descripcion =
        typeof body.descripcion === "string"
          ? body.descripcion.trim() || null
          : null;
    }

    if (hasActivo) patch.activo = body.activo;

    let parsedPermisos: ReturnType<typeof parsePermisosPayload> | null = null;
    if (hasPermisos) {
      parsedPermisos = parsePermisosPayload(body.permisos);
      if ("error" in parsedPermisos) throw new HttpError(parsedPermisos.error, 400);
    }

    await assertCanChangePerfilAdminRole({
      perfil: existing,
      nextNombre: hasNombre ? String(body.nombre).trim() : existing.nombre,
      nextAllowed:
        parsedPermisos && !("error" in parsedPermisos) ? parsedPermisos : null,
      actorPerfilId: session.perfilId,
    });

    const { data: updated, error: updErr } = await supabaseAdmin
      .from("perfiles")
      .update(patch)
      .eq("id", id)
      .select(PERFIL_SELECT)
      .single();

    if (updErr || !updated) {
      if (updErr?.code === "23505") {
        throw new HttpError("Ya existe un perfil con ese nombre.", 409);
      }
      console.error("[auth] patch perfil:", updErr?.message);
      throw new HttpError("No se pudo actualizar el perfil.", 500);
    }

    if (parsedPermisos && !("error" in parsedPermisos)) {
      await replacePerfilPermisos(id, parsedPermisos);
    }

    const saved = await getPerfilById(id);
    if (!saved) throw new HttpError("Perfil no encontrado.", 404);
    const counts = await countUsuariosByPerfil(id);
    return jsonOk({
      data: detailPayload(
        saved,
        counts.get(id) ?? 0,
        expandPermisosForClient(await getPermisosAllowed(id))
      ),
    });
  });
}

/** Desactivación lógica. No borra filas si hay usuarios asignados. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  return handleAuthRoute(request, async (session) => {
    await requirePermission(session, "administracion", "perfiles", "desactivar");
    const id = await parseId(context);
    const existing = await getPerfilById(id);
    if (!existing) throw new HttpError("Perfil no encontrado.", 404);
    await assertCanDeactivatePerfil(existing, session.perfilId);

    const { data, error } = await supabaseAdmin
      .from("perfiles")
      .update({ activo: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(PERFIL_SELECT)
      .single();
    if (error || !data) {
      console.error("[auth] deactivate perfil:", error?.message);
      throw new HttpError("No se pudo desactivar el perfil.", 500);
    }
    const saved = data as PerfilRow;
    const counts = await countUsuariosByPerfil(id);
    return jsonOk({
      data: detailPayload(
        saved,
        counts.get(id) ?? 0,
        expandPermisosForClient(await getPermisosAllowed(id))
      ),
    });
  });
}
