import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const secret = process.env.SYNC_TRIGGER_SECRET;
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "SYNC_TRIGGER_SECRET no configurado" },
      { status: 500 }
    );
  }

  const target = request.nextUrl.searchParams.get("target");
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
