import { NextResponse } from "next/server";

export async function POST() {
  const secret = process.env.SYNC_TRIGGER_SECRET;
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "SYNC_TRIGGER_SECRET no configurado" },
      { status: 500 }
    );
  }

  const syncUrl = new URL(
    "/api/sync-purchase-orders?mode=recent",
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
