import { NextRequest, NextResponse } from "next/server";
import { enforceIfRealSession } from "@/lib/auth/require";

export async function POST(request: NextRequest) {
  const target = request.nextUrl.searchParams.get("target");
  if (target === "inversa") {
    const denied = await enforceIfRealSession(
      request,
      "logistica",
      "inversa",
      "sincronizar"
    );
    if (denied) return denied;
  }
  // TODO(auth-enforced): Control OT sync (sin target) no tiene permiso en el catálogo.

  const secret = process.env.SYNC_TRIGGER_SECRET;
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "SYNC_TRIGGER_SECRET no configurado" },
      { status: 500 }
    );
  }

  const syncPath =
    target === "inversa"
      ? "/api/logistica/sync-inversa"
      : "/api/sync-work-orders?mode=full";

  const syncUrl = new URL(
    syncPath,
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  );

  const res = await fetch(syncUrl.toString(), {
    method: "POST",
    headers: {
      "x-sync-secret": secret,
    },
  });

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
