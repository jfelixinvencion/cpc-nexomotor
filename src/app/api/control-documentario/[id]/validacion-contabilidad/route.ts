import { NextRequest } from "next/server";
import { DOCUMENTO_SELECT } from "@/lib/control-documentario/constants";
import {
  documentosTable,
  getDocumentoById,
  type DocumentoRow,
} from "@/lib/control-documentario/db";
import { jsonError, jsonOk, logServerError } from "@/lib/control-documentario/http";
import { isUuid } from "@/lib/control-documentario/parse";
import { enforceIfRealSession } from "@/lib/auth/require";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const denied = await enforceIfRealSession(
    request,
    "logistica",
    "control_documentario",
    "validar_contabilidad"
  );
  if (denied) return denied;

  const { id } = await context.params;
  if (!isUuid(id)) return jsonError("ID inválido.", 400);

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return jsonError("Solicitud inválida.", 400);
    }
    const raw = (body as Record<string, unknown>).validado_contabilidad;
    if (typeof raw !== "boolean") {
      return jsonError("validado_contabilidad debe ser verdadero o falso.", 400);
    }

    const existing = await getDocumentoById(id);
    if (existing.error) {
      logServerError("validacion-contabilidad get", existing.error);
      return jsonError("No se pudo obtener el documento.", 500);
    }
    if (!existing.data) return jsonError("Documento no encontrado.", 404);
    if (existing.data.confirmado) {
      return jsonError(
        "No se puede cambiar la validación de un documento confirmado.",
        409
      );
    }

    const now = new Date().toISOString();
    const { data, error } = await documentosTable()
      .update({
        validado_contabilidad: raw,
        updated_at: now,
      })
      .eq("id", id)
      .eq("confirmado", false)
      .select(DOCUMENTO_SELECT)
      .maybeSingle();

    if (error) {
      logServerError("validacion-contabilidad update", error);
      return jsonError("No se pudo actualizar la validación de Contabilidad.", 500);
    }
    if (!data) {
      return jsonError(
        "No se puede cambiar la validación de un documento confirmado.",
        409
      );
    }

    return jsonOk({ data: data as DocumentoRow });
  } catch (err) {
    logServerError("validacion-contabilidad", err);
    return jsonError(
      "Error inesperado al actualizar la validación de Contabilidad.",
      500
    );
  }
}
