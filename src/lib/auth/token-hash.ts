import { createHash } from "node:crypto";

/** Hash SHA-256 del JWT para public.sesiones_app. Solo Node (Route Handlers). */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
