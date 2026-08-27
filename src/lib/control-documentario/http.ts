import { NextResponse } from "next/server";

export function jsonOk(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json({ success: true, ...payload }, { status });
}

export function jsonError(
  error: string,
  status: number,
  extra?: Record<string, unknown>
) {
  return NextResponse.json(
    extra ? { success: false, error, ...extra } : { success: false, error },
    { status }
  );
}

export function logServerError(scope: string, err: unknown) {
  const message = err instanceof Error ? err.message : "Error desconocido";
  console.error(`[control-documentario] ${scope}:`, message);
}
