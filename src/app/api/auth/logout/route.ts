import { NextRequest, NextResponse } from "next/server";
import {
  clearSessionCookie,
  readSessionCookieFromRequest,
} from "@/lib/auth/session";
import { hashSessionToken } from "@/lib/auth/token-hash";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const token = readSessionCookieFromRequest(request);
  if (token) {
    const { error } = await supabaseAdmin
      .from("sesiones_app")
      .delete()
      .eq("token_hash", hashSessionToken(token));
    if (error) {
      console.error("[auth] logout sesiones_app:", error.message);
    }
  }

  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);
  return response;
}
