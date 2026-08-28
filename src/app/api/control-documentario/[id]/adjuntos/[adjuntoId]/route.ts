import { NextRequest } from "next/server";
import { ADJUNTO_SELECT } from "@/lib/control-documentario/constants";
import {
  adjuntosTable,
  getDocumentoById,
  type AdjuntoRow,
} from "@/lib/control-documentario/db";
import { jsonError, jsonOk, logServerError } from "@/lib/control-documentario/http";
import { isUuid } from "@/lib/control-documentario/parse";
import { enforceIfRealSession } from "@/lib/auth/require";
import { removeStoragePaths } from "@/lib/control-documentario/storage";

type RouteContext = { params: Promise<{ id: string; adjuntoId: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  const denied = await enforceIfRealSession(
    request,
    "logistica",
    "control_documentario",
    "adjuntos_eliminar"
  );
  if (denied) return denied;

  const { id, adjuntoId } = await context.params;
  if (!isUuid(id) || !isUuid(adjuntoId)) {
    return jsonError("ID inválido.", 400);
  }

  try {
    const doc = await getDocumentoById(id);
    if (doc.error) {
      logServerError("delete adjunto doc", doc.error);
      return jsonError("No se pudo obtener el documento.", 500);
    }
    if (!doc.data) return jsonError("Documento no encontrado.", 404);
    if (doc.data.confirmado) {
      return jsonError(
        "No se pueden eliminar adjuntos de un documento confirmado.",
        409
      );
    }

    const { data, error } = await adjuntosTable()
      .select(ADJUNTO_SELECT)
      .eq("id", adjuntoId)
      .eq("documento_id", id)
      .maybeSingle();

    if (error) {
      logServerError("delete adjunto get", error);
      return jsonError("No se pudo obtener el adjunto.", 500);
    }
    if (!data) return jsonError("Adjunto no encontrado.", 404);

    const adjunto = data as AdjuntoRow;
    const removed = await removeStoragePaths([adjunto.storage_path]);
    if (removed.error) return jsonError(removed.error, 500);

    const { error: deleteError } = await adjuntosTable()
      .delete()
      .eq("id", adjuntoId)
      .eq("documento_id", id);

    if (deleteError) {
      logServerError("delete adjunto row", deleteError);
      return jsonError("No se pudo eliminar el registro del adjunto.", 500);
    }

    return jsonOk({ message: "Adjunto eliminado." });
  } catch (err) {
    logServerError("delete adjunto", err);
    return jsonError("Error inesperado al eliminar el adjunto.", 500);
  }
}
