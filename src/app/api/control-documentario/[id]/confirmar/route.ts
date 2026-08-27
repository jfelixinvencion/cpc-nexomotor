import { NextRequest } from "next/server";
import { DOCUMENTO_SELECT, RAZONES_SOCIALES_DELIVERY } from "@/lib/control-documentario/constants";
import {
  documentosTable,
  getDocumentoById,
  getItemsByDocumento,
} from "@/lib/control-documentario/db";
import { jsonError, jsonOk, logServerError } from "@/lib/control-documentario/http";
import { isUuid } from "@/lib/control-documentario/parse";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  if (!isUuid(id)) return jsonError("ID inválido.", 400);

  try {
    const existing = await getDocumentoById(id);
    if (existing.error) {
      logServerError("confirmar get", existing.error);
      return jsonError("No se pudo obtener el documento.", 500);
    }
    if (!existing.data) return jsonError("Documento no encontrado.", 404);
    if (existing.data.confirmado) {
      return jsonError("El documento ya está confirmado.", 409);
    }

    const doc = existing.data;
    if (!doc.fecha_emision) {
      return jsonError("No se puede confirmar: falta fecha_emision.", 400);
    }
    if (!doc.tipo_pago) {
      return jsonError("No se puede confirmar: falta tipo_pago.", 400);
    }
    if (!doc.tipo_documento) {
      return jsonError("No se puede confirmar: falta tipo_documento.", 400);
    }

    if (doc.es_delivery) {
      const razon = (doc.razon_social ?? "").trim();
      if (
        !(RAZONES_SOCIALES_DELIVERY as readonly string[]).includes(razon)
      ) {
        return jsonError(
          "No se puede confirmar: razon_social de Delivery inválida.",
          400
        );
      }
      if (!(doc.descripcion ?? "").trim()) {
        return jsonError("No se puede confirmar: falta descripcion.", 400);
      }
      const monto = Number(doc.valor_con_igv);
      if (!Number.isFinite(monto) || monto < 0) {
        return jsonError("No se puede confirmar: valor_con_igv inválido.", 400);
      }
    } else {
      if (!(doc.numero_oc ?? "").trim()) {
        return jsonError("No se puede confirmar: falta numero_oc.", 400);
      }
      if (!(doc.ruc ?? "").trim()) {
        return jsonError("No se puede confirmar: falta RUC.", 400);
      }
      if (!(doc.razon_social ?? "").trim()) {
        return jsonError("No se puede confirmar: falta razón social.", 400);
      }
      const items = await getItemsByDocumento(id);
      if (items.error) {
        logServerError("confirmar items", items.error);
        return jsonError("No se pudieron validar las líneas del documento.", 500);
      }
      if (items.data.length < 1) {
        return jsonError(
          "No se puede confirmar: el documento debe tener al menos una línea.",
          400
        );
      }
    }

    const now = new Date().toISOString();
    const { data, error } = await documentosTable()
      .update({
        confirmado: true,
        confirmado_at: now,
        updated_at: now,
      })
      .eq("id", id)
      .eq("confirmado", false)
      .select(DOCUMENTO_SELECT)
      .maybeSingle();

    if (error) {
      logServerError("confirmar update", error);
      return jsonError("No se pudo confirmar el documento.", 500);
    }
    if (!data) {
      return jsonError("El documento ya está confirmado.", 409);
    }

    return jsonOk({ data, message: "Documento confirmado." });
  } catch (err) {
    logServerError("confirmar", err);
    return jsonError("Error inesperado al confirmar el documento.", 500);
  }
}
