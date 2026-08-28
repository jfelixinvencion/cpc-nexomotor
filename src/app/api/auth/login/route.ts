import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "@/lib/auth/password";
import {
  applySessionCookie,
  createSessionToken,
  SESSION_TTL_SECONDS,
} from "@/lib/auth/session";
import { hashSessionToken } from "@/lib/auth/token-hash";
import { supabaseAdmin } from "@/lib/supabase/admin";

const GENERIC_LOGIN_ERROR = "Usuario o contraseña incorrectos";

type UsuarioRow = {
  id: string;
  username: string;
  password_hash: string;
  nombre_completo: string | null;
  perfil_id: string;
  activo: boolean;
};

type PerfilRow = {
  id: string;
  nombre: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      username?: unknown;
      password?: unknown;
    } | null;

    const username =
      typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: GENERIC_LOGIN_ERROR },
        { status: 401 }
      );
    }

    const { data: userData, error: userError } = await supabaseAdmin
      .from("usuarios")
      .select("id,username,password_hash,nombre_completo,perfil_id,activo")
      .eq("username", username)
      .maybeSingle();

    if (userError) {
      console.error("[auth] login usuarios:", userError.message);
      return NextResponse.json(
        { success: false, error: "No se pudo iniciar sesión." },
        { status: 500 }
      );
    }

    const user = userData as UsuarioRow | null;
    if (!user || user.activo !== true || !user.password_hash) {
      return NextResponse.json(
        { success: false, error: GENERIC_LOGIN_ERROR },
        { status: 401 }
      );
    }

    const passwordOk = await verifyPassword(password, user.password_hash);
    if (!passwordOk) {
      return NextResponse.json(
        { success: false, error: GENERIC_LOGIN_ERROR },
        { status: 401 }
      );
    }

    const { data: perfilData, error: perfilError } = await supabaseAdmin
      .from("perfiles")
      .select("id,nombre")
      .eq("id", user.perfil_id)
      .maybeSingle();

    if (perfilError) {
      console.error("[auth] login perfiles:", perfilError.message);
      return NextResponse.json(
        { success: false, error: "No se pudo iniciar sesión." },
        { status: 500 }
      );
    }

    const perfil = perfilData as PerfilRow | null;
    if (!perfil?.id || !perfil.nombre) {
      return NextResponse.json(
        { success: false, error: GENERIC_LOGIN_ERROR },
        { status: 401 }
      );
    }

    const token = await createSessionToken(
      {
        usuarioId: user.id,
        username: user.username,
        perfilId: perfil.id,
        perfilNombre: perfil.nombre,
      },
      SESSION_TTL_SECONDS
    );

    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
    const { error: sessionInsertError } = await supabaseAdmin
      .from("sesiones_app")
      .insert({
        usuario_id: user.id,
        token_hash: hashSessionToken(token),
        expires_at: expiresAt,
      });

    if (sessionInsertError) {
      console.error("[auth] login sesiones_app:", sessionInsertError.message);
    }

    const { error: lastLoginError } = await supabaseAdmin
      .from("usuarios")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", user.id);

    if (lastLoginError) {
      console.error("[auth] login last_login_at:", lastLoginError.message);
    }

    const response = NextResponse.json({
      success: true,
      data: {
        username: user.username,
        nombreCompleto: user.nombre_completo ?? user.username,
        perfil: perfil.nombre,
      },
    });
    applySessionCookie(response, token, SESSION_TTL_SECONDS);
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("[auth] login:", message);
    if (message.includes("AUTH_SESSION_SECRET")) {
      return NextResponse.json(
        { success: false, error: "Configuración de sesión incompleta." },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { success: false, error: "No se pudo iniciar sesión." },
      { status: 500 }
    );
  }
}
