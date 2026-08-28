/**
 * requireSession / requirePermission. Solo Route Handlers y Server Components.
 * No importar desde archivos "use client".
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AuthAccion, AuthModulo, AuthPestana } from "./permissions";
import {
  readSessionCookieFromRequest,
  verifySessionToken,
  type SessionPayload,
} from "./session";

export class AuthError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function authErrorResponse(error: AuthError | HttpError) {
  return NextResponse.json(
    { success: false, error: error.message },
    { status: error.status }
  );
}

export function jsonOk(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json({ success: true, ...payload }, { status });
}

export async function handleAuthRoute(
  req: NextRequest,
  fn: (session: SessionPayload) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    const session = await requireSession(req);
    return await fn(session);
  } catch (err) {
    if (err instanceof AuthError || err instanceof HttpError) {
      return authErrorResponse(err);
    }
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("[auth] route:", message);
    return NextResponse.json(
      { success: false, error: "Error interno." },
      { status: 500 }
    );
  }
}

export async function requireSession(
  req: NextRequest
): Promise<SessionPayload> {
  const token = readSessionCookieFromRequest(req);
  if (!token) {
    throw new AuthError("No autenticado.", 401);
  }
  const payload = await verifySessionToken(token);
  if (!payload) {
    throw new AuthError("No autenticado.", 401);
  }
  return payload;
}

/**
 * Si hay cookie de sesión real, exige el permiso.
 * Sin cookie (login mock o llamadas antiguas sin sesión server-side) no bloquea.
 * TODO(auth-enforced): cuando AUTH_MODE=enforced, exigir sesión en todas las rutas de negocio.
 */
export async function enforceIfRealSession(
  req: NextRequest,
  modulo: AuthModulo,
  pestana: AuthPestana,
  accion: AuthAccion
): Promise<NextResponse | null> {
  const token = readSessionCookieFromRequest(req);
  if (!token) return null;
  try {
    const session = await requireSession(req);
    await requirePermission(session, modulo, pestana, accion);
    return null;
  } catch (err) {
    if (err instanceof AuthError || err instanceof HttpError) {
      return authErrorResponse(err);
    }
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("[auth] enforceIfRealSession:", message);
    return NextResponse.json(
      { success: false, error: "Error interno." },
      { status: 500 }
    );
  }
}

export async function requirePermission(
  session: SessionPayload,
  modulo: AuthModulo,
  pestana: AuthPestana,
  accion: AuthAccion
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("perfil_permisos")
    .select("permitido")
    .eq("perfil_id", session.perfilId)
    .eq("modulo", modulo)
    .eq("pestana", pestana)
    .eq("accion", accion)
    .maybeSingle();

  if (error) {
    console.error("[auth] perfil_permisos:", error.message);
    throw new AuthError("No se pudo verificar el permiso.", 500);
  }

  const permitido = (data as { permitido?: boolean } | null)?.permitido === true;
  if (!permitido) {
    throw new AuthError("No autorizado.", 403);
  }
}
