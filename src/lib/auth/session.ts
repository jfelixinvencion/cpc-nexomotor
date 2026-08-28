/**
 * JWT de sesión y cookie httpOnly. Solo servidor (Route Handlers / middleware).
 * No importar desde archivos "use client".
 */
import { SignJWT, jwtVerify } from "jose";
import { NextResponse } from "next/server";

export const AUTH_COOKIE_NAME = "nexo_auth";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

export type SessionPayload = {
  usuarioId: string;
  username: string;
  perfilId: string;
  perfilNombre: string;
};

function getSessionSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SESSION_SECRET?.trim() ?? "";
  if (!secret) {
    const hint =
      process.env.NODE_ENV === "development"
        ? " Defínelo en .env.local (ver .env.local.example)."
        : "";
    throw new Error(
      `AUTH_SESSION_SECRET no está configurado.${hint} Es una variable server-only; no uses un valor por defecto.`
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(
  payload: SessionPayload,
  expiresInSeconds: number
): Promise<string> {
  const key = getSessionSecretKey();
  return new SignJWT({
    usuarioId: payload.usuarioId,
    username: payload.username,
    perfilId: payload.perfilId,
    perfilNombre: payload.perfilNombre,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(payload.usuarioId)
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(key);
}

export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecretKey(), {
      algorithms: ["HS256"],
    });
    const usuarioId = strClaim(payload.usuarioId) ?? strClaim(payload.sub);
    const username = strClaim(payload.username);
    const perfilId = strClaim(payload.perfilId);
    const perfilNombre = strClaim(payload.perfilNombre);
    if (!usuarioId || !username || !perfilId || !perfilNombre) return null;
    return { usuarioId, username, perfilId, perfilNombre };
  } catch {
    return null;
  }
}

function strClaim(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function sessionCookieOptions(expiresInSeconds: number) {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: expiresInSeconds,
  };
}

export function applySessionCookie(
  response: NextResponse,
  token: string,
  expiresInSeconds: number
) {
  response.cookies.set(AUTH_COOKIE_NAME, token, sessionCookieOptions(expiresInSeconds));
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    ...sessionCookieOptions(0),
    maxAge: 0,
  });
}

export function readSessionCookieFromRequest(request: {
  cookies: { get: (name: string) => { value: string } | undefined };
}): string | null {
  const value = request.cookies.get(AUTH_COOKIE_NAME)?.value?.trim() ?? "";
  return value || null;
}
