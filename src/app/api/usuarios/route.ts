import { NextRequest } from "next/server";
import { hashPassword } from "@/lib/auth/password";
import {
  getPerfilById,
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

export async function GET(request: NextRequest) {
  return handleAuthRoute(request, async (session) => {
    await requirePermission(session, "administracion", "usuarios", "ver");

    const { data, error } = await supabaseAdmin
      .from("usuarios")
      .select(USUARIO_SELECT)
      .order("username", { ascending: true });
    if (error) {
      console.error("[auth] list usuarios:", error.message);
      throw new HttpError("No se pudieron listar los usuarios.", 500);
    }

    const rows = (data as UsuarioRow[] | null) ?? [];
    const perfilIds = Array.from(new Set(rows.map((r) => r.perfil_id)));
    const nombres = new Map<string, string>();
    if (perfilIds.length > 0) {
      const { data: perfiles, error: pErr } = await supabaseAdmin
        .from("perfiles")
        .select("id,nombre")
        .in("id", perfilIds);
      if (pErr) {
        console.error("[auth] list usuarios perfiles:", pErr.message);
        throw new HttpError("No se pudieron listar los usuarios.", 500);
      }
      for (const row of (perfiles as { id: string; nombre: string }[] | null) ?? []) {
        nombres.set(row.id, row.nombre);
      }
    }

    const { data: perfilesActivos, error: actErr } = await supabaseAdmin
      .from("perfiles")
      .select("id,nombre")
      .eq("activo", true)
      .order("nombre", { ascending: true });
    if (actErr) {
      console.error("[auth] list perfiles activos:", actErr.message);
      throw new HttpError("No se pudieron listar los usuarios.", 500);
    }

    return jsonOk({
      data: {
        usuarios: rows.map((row) =>
          publicUsuario(row, nombres.get(row.perfil_id) ?? null)
        ),
        perfilesActivos: (
          (perfilesActivos as { id: string; nombre: string }[] | null) ?? []
        ).map((row) => ({ id: row.id, nombre: row.nombre })),
      },
    });
  });
}

export async function POST(request: NextRequest) {
  return handleAuthRoute(request, async (session) => {
    await requirePermission(session, "administracion", "usuarios", "crear");

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) throw new HttpError("Solicitud inválida.", 400);

    const usernameRaw = typeof body.username === "string" ? body.username : "";
    const usernameError = validateUsername(usernameRaw);
    if (usernameError) throw new HttpError(usernameError, 400);
    const username = usernameRaw.trim();

    const nombreCompleto =
      typeof body.nombreCompleto === "string"
        ? body.nombreCompleto.trim()
        : typeof body.nombre_completo === "string"
          ? body.nombre_completo.trim()
          : "";
    if (!nombreCompleto) {
      throw new HttpError("El nombre completo es obligatorio.", 400);
    }

    const perfilId = typeof body.perfilId === "string" ? body.perfilId.trim() : "";
    const perfil = await getPerfilById(perfilId);
    if (!perfil) throw new HttpError("Debe seleccionar un perfil válido.", 400);
    if (!perfil.activo) throw new HttpError("No se puede asignar un perfil inactivo.", 400);

    const password = typeof body.password === "string" ? body.password : "";
    const passwordError = validatePassword(password);
    if (passwordError) throw new HttpError(passwordError, 400);

    const activo = body.activo === false ? false : true;
    const passwordHash = await hashPassword(password);

    const { data: dup } = await supabaseAdmin
      .from("usuarios")
      .select("id")
      .ilike("username", username)
      .maybeSingle();
    if (dup) throw new HttpError("Ya existe un usuario con ese nombre.", 409);

    const { data: created, error: insErr } = await supabaseAdmin
      .from("usuarios")
      .insert({
        username,
        nombre_completo: nombreCompleto,
        perfil_id: perfil.id,
        password_hash: passwordHash,
        activo,
      })
      .select(USUARIO_SELECT)
      .single();

    if (insErr || !created) {
      if (insErr?.code === "23505") {
        throw new HttpError("Ya existe un usuario con ese nombre.", 409);
      }
      console.error("[auth] insert usuario:", insErr?.message);
      throw new HttpError("No se pudo crear el usuario.", 500);
    }

    return jsonOk(
      { data: publicUsuario(created as UsuarioRow, perfil.nombre) },
      201
    );
  });
}
