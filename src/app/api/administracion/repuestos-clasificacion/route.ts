import { NextRequest, NextResponse } from "next/server";
import { enforceIfRealSession } from "@/lib/auth/require";
import { listRepuestosClasificacion } from "@/lib/repuestos-clasificacion-db";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = await enforceIfRealSession(
    request,
    "administracion",
    "repuestos",
    "ver"
  );
  if (denied) return denied;

  try {
    const items = await listRepuestosClasificacion();
    return NextResponse.json({ success: true, items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("[repuestos-clasificacion] GET:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
