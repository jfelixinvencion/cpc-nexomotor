import { NextRequest, NextResponse } from "next/server";
import { enforceIfRealSession } from "@/lib/auth/require";
import {
  buildVentasTallerDashboard,
  parseDashboardQuery,
} from "@/lib/ventas-taller-dashboard";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = await enforceIfRealSession(
    request,
    "dashboard",
    "ventas_taller",
    "ver"
  );
  if (denied) return denied;

  const parsed = parseDashboardQuery(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json(
      { success: false, error: parsed.error },
      { status: 400 }
    );
  }

  try {
    const payload = await buildVentasTallerDashboard(parsed.query);
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("[ventas-taller-dashboard]", message);
    return NextResponse.json(
      { success: false, error: "No se pudo construir el dashboard de ventas de taller." },
      { status: 500 }
    );
  }
}
