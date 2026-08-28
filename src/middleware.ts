import { NextRequest, NextResponse } from "next/server";

const AUTH_COOKIE_NAME = "nexo_auth";

const PUBLIC_API_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/sync-stock",
  "/api/sync-work-orders",
  "/api/sync-purchase-orders",
  "/api/logistica/sync-inversa",
]);

function isPublicApi(pathname: string) {
  if (PUBLIC_API_PATHS.has(pathname)) return true;
  return false;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (isPublicApi(pathname)) {
    return NextResponse.next();
  }

  // Fase actual (AUTH_MODE=dual): solo observar la cookie. No bloquear APIs de negocio.
  // Fase futura: cambiar a bloquear con 401 cuando AUTH_MODE=enforced y las rutas
  // de negocio ya llamen a requireSession()/requirePermission().
  if (process.env.NODE_ENV === "development") {
    const hasCookie = Boolean(request.cookies.get(AUTH_COOKIE_NAME)?.value);
    console.log(
      `[auth middleware] ${pathname} cookie ${AUTH_COOKIE_NAME}: ${hasCookie ? "presente" : "ausente"}`
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
