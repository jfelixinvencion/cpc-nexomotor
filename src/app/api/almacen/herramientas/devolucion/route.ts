import { NextRequest } from "next/server";
import {
  handleAuthRoute,
  HttpError,
  requirePermission,
} from "@/lib/auth/require";
import {
  llamarMovimiento,
  parseCantidadDevueltaEsperada,
  parseCantidadPositiva,
  parseIdPositivo,
  parseUuid,
} from "@/lib/almacen/movimientos-herramientas";

export async function POST(request: NextRequest) {
  return handleAuthRoute(request, async (session) => {
    await requirePermission(session, "almacen", "herramientas", "devolver");

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) throw new HttpError("Solicitud inválida.", 400);

    const idempotencyKey = parseUuid(body.idempotency_key);
    const prestamoId = parseIdPositivo(body.prestamo_id);
    const cantidad = parseCantidadPositiva(body.cantidad);
    const cantidadDevueltaEsperada = parseCantidadDevueltaEsperada(
      body.cantidad_devuelta_esperada
    );

    return llamarMovimiento("devolver_herramienta", {
      p_idempotency_key: idempotencyKey,
      p_prestamo_id: prestamoId,
      p_cantidad: cantidad,
      p_cantidad_devuelta_esperada: cantidadDevueltaEsperada,
    });
  });
}
