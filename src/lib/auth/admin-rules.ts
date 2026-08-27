/**
 * Reglas de consistencia para perfiles y usuarios. Solo servidor.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { HttpError } from "./require";
import type { PermisoItem } from "./permissions";
import {
  expandPermisosForClient,
  isCatalogPermission,
  permisoKey,
} from "./permissions";

export const PERFIL_SELECT =
  "id,nombre,descripcion,activo,created_at,updated_at";
export const USUARIO_SELECT =
  "id,username,nombre_completo,perfil_id,activo,last_login_at,created_at";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MIN_PASSWORD_LENGTH = 8;

export type PerfilRow = {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type UsuarioRow = {
  id: string;
  username: string;
  nombre_completo: string | null;
  perfil_id: string;
  activo: boolean;
  last_login_at: string | null;
  created_at: string | null;
};

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function isAdminNombre(nombre: string): boolean {
  return nombre.trim().toLowerCase() === "administrador";
}

export async function perfilTieneGestionAdmin(perfilId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("perfil_permisos")
    .select("pestana,accion,permitido")
    .eq("perfil_id", perfilId)
    .eq("modulo", "administracion")
    .eq("accion", "ver")
    .eq("permitido", true)
    .in("pestana", ["perfiles", "usuarios"]);

  if (error) {
    console.error("[auth] admin-rules permisos:", error.message);
    throw new HttpError("No se pudo verificar el perfil administrador.", 500);
  }

  const pestanas = new Set(
    ((data as { pestana?: string }[] | null) ?? []).map((row) => row.pestana)
  );
  return pestanas.has("perfiles") && pestanas.has("usuarios");
}

export async function isAdminPerfil(
  perfilId: string,
  nombre?: string | null
): Promise<boolean> {
  if (nombre && isAdminNombre(nombre)) return true;
  return perfilTieneGestionAdmin(perfilId);
}

export async function getPerfilById(id: string): Promise<PerfilRow | null> {
  const { data, error } = await supabaseAdmin
    .from("perfiles")
    .select(PERFIL_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[auth] get perfil:", error.message);
    throw new HttpError("No se pudo obtener el perfil.", 500);
  }
  return (data as PerfilRow | null) ?? null;
}

export async function getUsuarioById(id: string): Promise<UsuarioRow | null> {
  const { data, error } = await supabaseAdmin
    .from("usuarios")
    .select(USUARIO_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[auth] get usuario:", error.message);
    throw new HttpError("No se pudo obtener el usuario.", 500);
  }
  return (data as UsuarioRow | null) ?? null;
}

export async function countUsuariosByPerfil(
  perfilId?: string
): Promise<Map<string, number>> {
  let query = supabaseAdmin.from("usuarios").select("perfil_id");
  if (perfilId) query = query.eq("perfil_id", perfilId);
  const { data, error } = await query;
  if (error) {
    console.error("[auth] count usuarios:", error.message);
    throw new HttpError("No se pudo contar usuarios asignados.", 500);
  }
  const map = new Map<string, number>();
  for (const row of (data as { perfil_id?: string }[] | null) ?? []) {
    const id = String(row.perfil_id ?? "");
    if (!id) continue;
    map.set(id, (map.get(id) ?? 0) + 1);
  }
  return map;
}

export async function countActiveUsersOnPerfil(perfilId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("usuarios")
    .select("id", { count: "exact", head: true })
    .eq("perfil_id", perfilId)
    .eq("activo", true);
  if (error) {
    console.error("[auth] count active users:", error.message);
    throw new HttpError("No se pudo verificar usuarios del perfil.", 500);
  }
  return count ?? 0;
}

export async function listActiveAdminUserIds(
  excludeUserId?: string
): Promise<string[]> {
  const { data: perfiles, error: pErr } = await supabaseAdmin
    .from("perfiles")
    .select("id,nombre")
    .eq("activo", true);
  if (pErr) {
    console.error("[auth] list admin perfiles:", pErr.message);
    throw new HttpError("No se pudo verificar administradores.", 500);
  }

  const adminIds: string[] = [];
  for (const row of (perfiles as { id: string; nombre: string }[] | null) ?? []) {
    if (await isAdminPerfil(row.id, row.nombre)) adminIds.push(row.id);
  }
  if (adminIds.length === 0) return [];

  const { data: users, error: uErr } = await supabaseAdmin
    .from("usuarios")
    .select("id,perfil_id")
    .eq("activo", true)
    .in("perfil_id", adminIds);
  if (uErr) {
    console.error("[auth] list admin users:", uErr.message);
    throw new HttpError("No se pudo verificar administradores.", 500);
  }

  return ((users as { id: string }[] | null) ?? [])
    .map((u) => u.id)
    .filter((id) => id !== excludeUserId);
}

export async function listActiveAdminPerfilIds(
  excludePerfilId?: string
): Promise<string[]> {
  const { data: perfiles, error } = await supabaseAdmin
    .from("perfiles")
    .select("id,nombre")
    .eq("activo", true);
  if (error) {
    console.error("[auth] list admin perfiles:", error.message);
    throw new HttpError("No se pudo verificar perfiles administrador.", 500);
  }
  const ids: string[] = [];
  for (const row of (perfiles as { id: string; nombre: string }[] | null) ?? []) {
    if (excludePerfilId && row.id === excludePerfilId) continue;
    if (await isAdminPerfil(row.id, row.nombre)) ids.push(row.id);
  }
  return ids;
}

export async function assertCanDeactivatePerfil(
  perfil: PerfilRow,
  actorPerfilId: string
) {
  const activeUsers = await countActiveUsersOnPerfil(perfil.id);
  if (activeUsers > 0) {
    throw new HttpError(
      "No se puede desactivar un perfil con usuarios activos asignados. Reasigne o desactive esos usuarios primero.",
      409
    );
  }
  if (await isAdminPerfil(perfil.id, perfil.nombre)) {
    const others = await listActiveAdminPerfilIds(perfil.id);
    if (others.length === 0) {
      throw new HttpError(
        "No se puede desactivar el último perfil administrador activo.",
        409
      );
    }
  }
  if (perfil.id === actorPerfilId) {
    throw new HttpError(
      "No puedes desactivar el perfil de tu propia sesión.",
      409
    );
  }
}

export async function assertCanDeactivateUsuario(
  usuario: UsuarioRow,
  actorUserId: string
) {
  if (usuario.id === actorUserId) {
    throw new HttpError("No puedes desactivar tu propio usuario.", 409);
  }
  const perfil = await getPerfilById(usuario.perfil_id);
  const isAdminUser = perfil
    ? await isAdminPerfil(perfil.id, perfil.nombre)
    : false;
  if (isAdminUser && usuario.activo) {
    const others = await listActiveAdminUserIds(usuario.id);
    if (others.length === 0) {
      throw new HttpError(
        "No se puede desactivar el último usuario administrador activo.",
        409
      );
    }
  }
}

export function permisosMakeAdmin(items: PermisoItem[]): boolean {
  const keys = new Set(
    items.map((item) => permisoKey(item.modulo, item.pestana, item.accion))
  );
  return (
    keys.has(permisoKey("administracion", "perfiles", "ver")) &&
    keys.has(permisoKey("administracion", "usuarios", "ver"))
  );
}

/** Evita que el último perfil administrador (o el propio) pierda el rol al editar. */
export async function assertCanChangePerfilAdminRole(opts: {
  perfil: PerfilRow;
  nextNombre: string;
  nextAllowed: PermisoItem[] | null;
  actorPerfilId: string;
}) {
  const currentlyAdmin = await isAdminPerfil(opts.perfil.id, opts.perfil.nombre);
  let nextAdmin = isAdminNombre(opts.nextNombre);
  if (!nextAdmin) {
    if (opts.nextAllowed) nextAdmin = permisosMakeAdmin(opts.nextAllowed);
    else nextAdmin = await perfilTieneGestionAdmin(opts.perfil.id);
  }
  if (!currentlyAdmin || nextAdmin) return;

  const others = await listActiveAdminPerfilIds(opts.perfil.id);
  if (others.length === 0) {
    throw new HttpError(
      "No se puede quitar el último perfil administrador activo.",
      409
    );
  }
  if (opts.perfil.id === opts.actorPerfilId) {
    throw new HttpError(
      "No puedes quitarte a ti mismo el acceso de administración.",
      409
    );
  }
}

export async function assertCanChangeUsuarioPerfil(
  usuario: UsuarioRow,
  nextPerfil: PerfilRow,
  actorUserId: string
) {
  if (!nextPerfil.activo) {
    throw new HttpError("No se puede asignar un perfil inactivo.", 400);
  }
  const current = await getPerfilById(usuario.perfil_id);
  const wasAdmin = current
    ? await isAdminPerfil(current.id, current.nombre)
    : false;
  const willBeAdmin = await isAdminPerfil(nextPerfil.id, nextPerfil.nombre);
  if (wasAdmin && !willBeAdmin) {
    const others = await listActiveAdminUserIds(usuario.id);
    if (others.length === 0) {
      throw new HttpError(
        "No se puede quitar el último usuario administrador activo.",
        409
      );
    }
    if (usuario.id === actorUserId) {
      throw new HttpError(
        "No puedes quitarte a ti mismo el perfil administrador.",
        409
      );
    }
  }
}

export async function getPermisosAllowed(perfilId: string): Promise<PermisoItem[]> {
  const { data, error } = await supabaseAdmin
    .from("perfil_permisos")
    .select("modulo,pestana,accion,permitido")
    .eq("perfil_id", perfilId)
    .eq("permitido", true);
  if (error) {
    console.error("[auth] get permisos:", error.message);
    throw new HttpError("No se pudieron obtener los permisos del perfil.", 500);
  }
  const items: PermisoItem[] = [];
  for (const row of (data as Record<string, unknown>[] | null) ?? []) {
    const modulo = String(row.modulo ?? "");
    const pestana = String(row.pestana ?? "");
    const accion = String(row.accion ?? "");
    if (!isCatalogPermission(modulo, pestana, accion)) continue;
    items.push({
      modulo: modulo as PermisoItem["modulo"],
      pestana: pestana as PermisoItem["pestana"],
      accion: accion as PermisoItem["accion"],
    });
  }
  return items;
}

export async function replacePerfilPermisos(
  perfilId: string,
  allowed: PermisoItem[]
) {
  const previous = await getPermisosAllowed(perfilId);

  const { error: delErr } = await supabaseAdmin
    .from("perfil_permisos")
    .delete()
    .eq("perfil_id", perfilId);
  if (delErr) {
    console.error("[auth] delete permisos:", delErr.message);
    throw new HttpError("No se pudieron actualizar los permisos.", 500);
  }

  if (allowed.length > 0) {
    const rows = allowed.map((p) => ({
      perfil_id: perfilId,
      modulo: p.modulo,
      pestana: p.pestana,
      accion: p.accion,
      permitido: true,
    }));
    const { error: insErr } = await supabaseAdmin
      .from("perfil_permisos")
      .insert(rows);
    if (insErr) {
      console.error("[auth] insert permisos:", insErr.message);
      if (previous.length > 0) {
        await supabaseAdmin.from("perfil_permisos").insert(
          previous.map((p) => ({
            perfil_id: perfilId,
            modulo: p.modulo,
            pestana: p.pestana,
            accion: p.accion,
            permitido: true,
          }))
        );
      }
      throw new HttpError("No se pudieron guardar los permisos.", 500);
    }
  }
}

export function publicUsuario(
  row: UsuarioRow,
  perfilNombre: string | null
) {
  return {
    id: row.id,
    username: row.username,
    nombreCompleto: row.nombre_completo,
    perfilId: row.perfil_id,
    perfilNombre,
    activo: row.activo,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
}

export function publicPerfil(
  row: PerfilRow,
  usuariosAsignados: number,
  permisos?: ReturnType<typeof expandPermisosForClient>
) {
  return {
    id: row.id,
    nombre: row.nombre,
    descripcion: row.descripcion,
    activo: row.activo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    usuariosAsignados,
    ...(permisos ? { permisos } : {}),
  };
}

export function validatePassword(password: string): string | null {
  if (!password) return "La contraseña es obligatoria.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (password.length > 200) return "La contraseña es demasiado larga.";
  return null;
}

export function validateUsername(username: string): string | null {
  const trimmed = username.trim();
  if (!trimmed) return "El usuario es obligatorio.";
  if (trimmed.length < 3) return "El usuario debe tener al menos 3 caracteres.";
  if (trimmed.length > 64) return "El usuario es demasiado largo.";
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    return "El usuario solo puede contener letras, números, punto, guion y guion bajo.";
  }
  return null;
}
