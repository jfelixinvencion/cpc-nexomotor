import { NextRequest } from "next/server";
import {
  handleAuthRoute,
  HttpError,
  requirePermission,
} from "@/lib/auth/require";
import {
  llamarMovimiento,
  parseCantidadPositiva,
  parseIdPositivo,
  parseUuid,
} from "@/lib/almacen/movimientos-herramientas";

export async function POST(request: NextRequest) {
  return handleAuthRoute(request, async (session) => {
    await requirePermission(session, "almacen", "herramientas", "prestar");

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) throw new HttpError("Solicitud inválida.", 400);

    const idempotencyKey = parseUuid(body.idempotency_key);
    const herramientaId = parseIdPositivo(body.herramienta_id);
    const cantidad = parseCantidadPositiva(body.cantidad);
    const responsable =
      typeof body.responsable === "string" ? body.responsable : "";
    const destino = typeof body.destino === "string" ? body.destino : "";

    return llamarMovimiento("retirar_herramienta", {
      p_idempotency_key: idempotencyKey,
      p_herramienta_id: herramientaId,
      p_cantidad: cantidad,
      p_responsable: responsable,
      p_destino: destino,
    });
  });
}
