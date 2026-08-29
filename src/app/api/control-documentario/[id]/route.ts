import { NextRequest } from "next/server";
import { DOCUMENTO_SELECT } from "@/lib/control-documentario/constants";
import {
  buscarConflictos,
  documentosTable,
  getAdjuntosByDocumento,
  getDocumentoById,
  getItemsByDocumento,
  itemsTable,
  isUniqueViolation,
  ocNumeroExiste,
  verificarLineasEnVista,
  type DocumentoRow,
} from "@/lib/control-documentario/db";
import { jsonError, jsonOk, logServerError } from "@/lib/control-documentario/http";
import { enforceIfRealSession } from "@/lib/auth/require";
import { isUuid, parseDocumentoPayload, resumenDescripcionItems, TEXTO_SIN_OC, type DocumentoParsed } from "@/lib/control-documentario/parse";
import {
  removeStoragePaths,
  toAdjuntoPublico,
} from "@/lib/control-documentario/storage";

type RouteContext = { params: Promise<{ id: string }> };

async function parseId(context: RouteContext) {
  const { id } = await context.params;
  if (!isUuid(id)) return null;
  return id;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const denied = await enforceIfRealSession(
    request,
    "logistica",
    "control_documentario",
    "ver"
  );
  if (denied) return denied;

  const id = await parseId(context);
  if (!id) return jsonError("ID inválido.", 400);

  try {
    const doc = await getDocumentoById(id);
    if (doc.error) {
      logServerError("get documento", doc.error);
      return jsonError("No se pudo obtener el documento.", 500);
    }
    if (!doc.data) return jsonError("Documento no encontrado.", 404);

    const [itemsRes, adjuntosRes] = await Promise.all([
      getItemsByDocumento(id),
      getAdjuntosByDocumento(id),
    ]);
    if (itemsRes.error) {
      logServerError("get items", itemsRes.error);
      return jsonError("No se pudieron obtener las líneas del documento.", 500);
    }
    if (adjuntosRes.error) {
      logServerError("get adjuntos", adjuntosRes.error);
      return jsonError("No se pudieron obtener los adjuntos del documento.", 500);
    }

    const adjuntos = [];
    for (const row of adjuntosRes.data) {
      const publico = await toAdjuntoPublico(row);
      if (!publico) {
        return jsonError("No se pudo generar el acceso temporal a un adjunto.", 500);
      }
      adjuntos.push(publico);
    }

    return jsonOk({
      data: {
        ...doc.data,
        items: itemsRes.data,
        adjuntos,
      },
    });
  } catch (err) {
    logServerError("get", err);
    return jsonError("Error inesperado al obtener el documento.", 500);
  }
}

function headerUpdate(parsed: DocumentoParsed, descripcion: string | null) {
  return {
    es_delivery: parsed.es_delivery,
    numero_oc: parsed.numero_oc,
    tipo_pago: parsed.tipo_pago,
    empresa: parsed.empresa,
    autoriza: parsed.autoriza,
    fecha_emision: parsed.fecha_emision,
    tipo_documento: parsed.tipo_documento,
    numero_documento: parsed.numero_documento,
    doc_transferencia: parsed.doc_transferencia,
    ruc: parsed.ruc,
    razon_social: parsed.razon_social,
    placa: parsed.placa,
    descripcion,
    valor_sin_igv: parsed.valor_sin_igv,
    valor_con_igv: parsed.valor_con_igv,
    observaciones: parsed.observaciones,
    updated_at: new Date().toISOString(),
  };
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const denied = await enforceIfRealSession(
    request,
    "logistica",
    "control_documentario",
    "editar"
  );
  if (denied) return denied;

  const id = await parseId(context);
  if (!id) return jsonError("ID inválido.", 400);

  try {
    const existing = await getDocumentoById(id);
    if (existing.error) {
      logServerError("patch get", existing.error);
      return jsonError("No se pudo obtener el documento.", 500);
    }
    if (!existing.data) return jsonError("Documento no encontrado.", 404);
    if (existing.data.confirmado) {
      return jsonError("El documento confirmado no puede editarse.", 409);
    }

    const body = await request.json().catch(() => null);
    const parsed = parseDocumentoPayload(body);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    let payload = parsed.data;
    let descripcion = payload.descripcion;

    if (payload.es_delivery) {
      if (payload.numero_oc !== TEXTO_SIN_OC) {
        const oc = await ocNumeroExiste(payload.numero_oc ?? "");
        if (oc.error) {
          logServerError("oc exists", oc.error);
          return jsonError("No se pudo validar el número de OC.", 500);
        }
        if (!oc.exists) {
          return jsonError(
            "La OC indicada no existe. Use un número válido o exactamente “Sin OC”.",
            400
          );
        }
      }
    } else {
      const verified = await verificarLineasEnVista(payload.items);
      if (!verified.ok) return jsonError(verified.error, 400);
      payload = { ...payload, items: verified.items };
      descripcion = resumenDescripcionItems(verified.items);

      const conflictos = await buscarConflictos(verified.items, id);
      if (conflictos.error) {
        logServerError("conflictos patch", conflictos.error);
        return jsonError("No se pudo verificar si las líneas ya están vinculadas.", 500);
      }
      if (conflictos.conflictos.length > 0) {
        return jsonError(
          "Una o más líneas ya están vinculadas a otro documento.",
          409,
          { conflictos: conflictos.conflictos }
        );
      }
    }

    const { error: deleteItemsError } = await itemsTable()
      .delete()
      .eq("documento_id", id);
    if (deleteItemsError) {
      logServerError("delete items patch", deleteItemsError);
      return jsonError("No se pudieron actualizar las líneas del documento.", 500);
    }

    if (payload.items.length > 0) {
      const rows = payload.items.map((item) => ({
        documento_id: id,
        sigma_id: item.sigma_id,
        numero_oc: item.numero_oc,
        linea_orden: item.linea_orden,
        codigo_repuesto: item.codigo_repuesto,
        descripcion_repuesto: item.descripcion_repuesto,
        cantidad: item.cantidad,
        precio_total_con_igv_soles: item.precio_total_con_igv_soles,
      }));
      const { error: insertItemsError } = await itemsTable().insert(rows);
      if (insertItemsError) {
        logServerError("insert items patch", insertItemsError);
        if (isUniqueViolation(insertItemsError)) {
          return jsonError(
            "Una o más líneas ya están vinculadas a otro documento.",
            409
          );
        }
        return jsonError("No se pudieron guardar las líneas del documento.", 500);
      }
    }

    const { data: updated, error: updateError } = await documentosTable()
      .update(headerUpdate(payload, descripcion))
      .eq("id", id)
      .eq("confirmado", false)
      .select(DOCUMENTO_SELECT)
      .maybeSingle();

    if (updateError) {
      logServerError("update documento", updateError);
      return jsonError("No se pudo actualizar el documento.", 500);
    }
    if (!updated) {
      return jsonError("El documento confirmado no puede editarse.", 409);
    }

    const itemsRes = await getItemsByDocumento(id);
    if (itemsRes.error) {
      logServerError("patch items reload", itemsRes.error);
      return jsonError("Documento actualizado, pero no se pudieron leer las líneas.", 500);
    }

    return jsonOk({
      data: { ...(updated as DocumentoRow), items: itemsRes.data },
    });
  } catch (err) {
    logServerError("patch", err);
    return jsonError("Error inesperado al actualizar el documento.", 500);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const denied = await enforceIfRealSession(
    request,
    "logistica",
    "control_documentario",
    "eliminar"
  );
  if (denied) return denied;

  const id = await parseId(context);
  if (!id) return jsonError("ID inválido.", 400);

  try {
    const existing = await getDocumentoById(id);
    if (existing.error) {
      logServerError("delete get", existing.error);
      return jsonError("No se pudo obtener el documento.", 500);
    }
    if (!existing.data) return jsonError("Documento no encontrado.", 404);
    if (existing.data.confirmado) {
      return jsonError("El documento confirmado no puede eliminarse.", 409);
    }

    const adjuntos = await getAdjuntosByDocumento(id);
    if (adjuntos.error) {
      logServerError("delete adjuntos list", adjuntos.error);
      return jsonError("No se pudieron leer los adjuntos del documento.", 500);
    }

    const paths = adjuntos.data.map((row) => row.storage_path).filter(Boolean);
    const removed = await removeStoragePaths(paths);
    if (removed.error) {
      return jsonError(removed.error, 500);
    }

    const { error: deleteError } = await documentosTable()
      .delete()
      .eq("id", id)
      .eq("confirmado", false);

    if (deleteError) {
      logServerError("delete documento", deleteError);
      return jsonError("No se pudo eliminar el documento.", 500);
    }

    return jsonOk({ message: "Documento eliminado." });
  } catch (err) {
    logServerError("delete", err);
    return jsonError("Error inesperado al eliminar el documento.", 500);
  }
}
