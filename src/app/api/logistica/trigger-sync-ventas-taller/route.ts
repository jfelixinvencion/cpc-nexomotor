import { NextRequest, NextResponse } from "next/server";
import { enforceIfRealSession } from "@/lib/auth/require";

export const maxDuration = 300;

function errorFromBody(data: unknown, status: number): string {
  if (data && typeof data === "object") {
    const error = (data as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return `Error HTTP ${status}`;
}

export async function POST(request: NextRequest) {
  const denied = await enforceIfRealSession(
    request,
    "logistica",
    "ventas_taller",
    "sincronizar"
  );
  if (denied) return denied;

  const secret = process.env.SYNC_TRIGGER_SECRET;
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "SYNC_TRIGGER_SECRET no configurado" },
      { status: 500 }
    );
  }

  const syncUrl = new URL(
    "/api/sync-ventas-taller",
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  );

  try {
    const res = await fetch(syncUrl.toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "x-sync-secret": secret,
      },
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || data.success === false) {
      return NextResponse.json(
        {
          success: false,
          error: errorFromBody(data, res.status),
        },
        { status: res.status }
      );
    }

    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
