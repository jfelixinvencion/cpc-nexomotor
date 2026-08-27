import { NextRequest } from "next/server";
import { hashPassword } from "@/lib/auth/password";
import {
  assertCanChangeUsuarioPerfil,
  assertCanDeactivateUsuario,
  getPerfilById,
  getUsuarioById,
  isUuid,
  publicUsuario,
  USUARIO_SELECT,
  type UsuarioRow,
  validatePassword,
  validateUsername,
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

export async function GET(request: NextRequest, context: RouteContext) {
  return handleAuthRoute(request, async (session) => {
    await requirePermission(session, "administracion", "usuarios", "ver");
    const id = await parseId(context);
    const usuario = await getUsuarioById(id);
    if (!usuario) throw new HttpError("Usuario no encontrado.", 404);
    const perfil = await getPerfilById(usuario.perfil_id);
    return jsonOk({
      data: publicUsuario(usuario, perfil?.nombre ?? null),
    });
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return handleAuthRoute(request, async (session) => {
    const id = await parseId(context);
    const existing = await getUsuarioById(id);
    if (!existing) throw new HttpError("Usuario no encontrado.", 404);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) throw new HttpError("Solicitud inválida.", 400);

    const hasUsername = typeof body.username === "string";
    const hasNombre =
      typeof body.nombreCompleto === "string" ||
      typeof body.nombre_completo === "string";
    const hasPerfil = typeof body.perfilId === "string";
    const hasActivo = typeof body.activo === "boolean";
    const hasPassword =
      typeof body.password === "string" && body.password.length > 0;

    if (!hasUsername && !hasNombre && !hasPerfil && !hasActivo && !hasPassword) {
      throw new HttpError("No hay campos para actualizar.", 400);
    }

    const wantsDeactivate = hasActivo && body.activo === false;
    const otherChanges =
      hasUsername ||
      hasNombre ||
      hasPerfil ||
      hasPassword ||
      (hasActivo && body.activo === true);

    if (wantsDeactivate) {
      await requirePermission(session, "administracion", "usuarios", "desactivar");
      if (existing.activo) {
        await assertCanDeactivateUsuario(existing, session.usuarioId);
      }
    }
    if (otherChanges) {
      await requirePermission(session, "administracion", "usuarios", "editar");
    }

    const patch: Record<string, unknown> = {};

    if (hasUsername) {
      const usernameError = validateUsername(String(body.username));
      if (usernameError) throw new HttpError(usernameError, 400);
      const username = String(body.username).trim();
      if (username.toLowerCase() !== existing.username.toLowerCase()) {
        const { data: dup } = await supabaseAdmin
          .from("usuarios")
          .select("id")
          .ilike("username", username)
          .neq("id", id)
          .maybeSingle();
        if (dup) throw new HttpError("Ya existe un usuario con ese nombre.", 409);
      }
      patch.username = username;
    }

    if (hasNombre) {
      const nombreCompleto = (
        typeof body.nombreCompleto === "string"
          ? body.nombreCompleto
          : String(body.nombre_completo)
      ).trim();
      if (!nombreCompleto) {
        throw new HttpError("El nombre completo es obligatorio.", 400);
      }
      patch.nombre_completo = nombreCompleto;
    }

    let nextPerfilNombre: string | null = null;
    if (hasPerfil) {
      const perfil = await getPerfilById(String(body.perfilId).trim());
      if (!perfil) throw new HttpError("Debe seleccionar un perfil válido.", 400);
      await assertCanChangeUsuarioPerfil(existing, perfil, session.usuarioId);
      patch.perfil_id = perfil.id;
      nextPerfilNombre = perfil.nombre;
    }

    if (hasPassword) {
      const passwordError = validatePassword(String(body.password));
      if (passwordError) throw new HttpError(passwordError, 400);
      patch.password_hash = await hashPassword(String(body.password));
    }

    if (hasActivo) patch.activo = body.activo;

    const { data: updated, error: updErr } = await supabaseAdmin
      .from("usuarios")
      .update(patch)
      .eq("id", id)
      .select(USUARIO_SELECT)
      .single();

    if (updErr || !updated) {
      if (updErr?.code === "23505") {
        throw new HttpError("Ya existe un usuario con ese nombre.", 409);
      }
      console.error("[auth] patch usuario:", updErr?.message);
      throw new HttpError("No se pudo actualizar el usuario.", 500);
    }

    const row = updated as UsuarioRow;
    if (!nextPerfilNombre) {
      const perfil = await getPerfilById(row.perfil_id);
      nextPerfilNombre = perfil?.nombre ?? null;
    }
    return jsonOk({ data: publicUsuario(row, nextPerfilNombre) });
  });
}

/** Desactivación lógica. No elimina el usuario. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  return handleAuthRoute(request, async (session) => {
    await requirePermission(session, "administracion", "usuarios", "desactivar");
    const id = await parseId(context);
    const existing = await getUsuarioById(id);
    if (!existing) throw new HttpError("Usuario no encontrado.", 404);
    await assertCanDeactivateUsuario(existing, session.usuarioId);

    const { data, error } = await supabaseAdmin
      .from("usuarios")
      .update({ activo: false })
      .eq("id", id)
      .select(USUARIO_SELECT)
      .single();
    if (error || !data) {
      console.error("[auth] deactivate usuario:", error?.message);
      throw new HttpError("No se pudo desactivar el usuario.", 500);
    }
    const row = data as UsuarioRow;
    const perfil = await getPerfilById(row.perfil_id);
    return jsonOk({ data: publicUsuario(row, perfil?.nombre ?? null) });
  });
}
