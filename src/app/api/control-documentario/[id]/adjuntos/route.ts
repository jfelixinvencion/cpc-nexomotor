import { NextRequest } from "next/server";
import { ADJUNTO_SELECT, MAX_ADJUNTOS_POR_DOCUMENTO } from "@/lib/control-documentario/constants";
import {
  adjuntosTable,
  getAdjuntosByDocumento,
  getDocumentoById,
} from "@/lib/control-documentario/db";
import { jsonError, jsonOk, logServerError } from "@/lib/control-documentario/http";
import { isUuid } from "@/lib/control-documentario/parse";
import {
  buildStoragePath,
  removeStoragePaths,
  toAdjuntoPublico,
  uploadArchivo,
  validateArchivo,
} from "@/lib/control-documentario/storage";
import type { AdjuntoRow } from "@/lib/control-documentario/db";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  if (!isUuid(id)) return jsonError("ID inválido.", 400);

  try {
    const doc = await getDocumentoById(id);
    if (doc.error) {
      logServerError("adjuntos get doc", doc.error);
      return jsonError("No se pudo obtener el documento.", 500);
    }
    if (!doc.data) return jsonError("Documento no encontrado.", 404);

    const adjuntos = await getAdjuntosByDocumento(id);
    if (adjuntos.error) {
      logServerError("adjuntos list", adjuntos.error);
      return jsonError("No se pudieron listar los adjuntos.", 500);
    }

    const items = [];
    for (const row of adjuntos.data) {
      const publico = await toAdjuntoPublico(row);
      if (!publico) {
        return jsonError("No se pudo generar el acceso temporal a un adjunto.", 500);
      }
      items.push(publico);
    }

    return jsonOk({ items });
  } catch (err) {
    logServerError("adjuntos get", err);
    return jsonError("Error inesperado al listar adjuntos.", 500);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  if (!isUuid(id)) return jsonError("ID inválido.", 400);

  const uploadedPaths: string[] = [];
  const insertedIds: string[] = [];

  try {
    const doc = await getDocumentoById(id);
    if (doc.error) {
      logServerError("adjuntos post doc", doc.error);
      return jsonError("No se pudo obtener el documento.", 500);
    }
    if (!doc.data) return jsonError("Documento no encontrado.", 404);
    if (doc.data.confirmado) {
      return jsonError(
        "No se pueden agregar adjuntos a un documento confirmado.",
        409
      );
    }

    const form = await request.formData().catch(() => null);
    if (!form) return jsonError("Solicitud inválida.", 400);

    const files = form
      .getAll("files")
      .filter((value): value is File => value instanceof File);

    if (files.length === 0) {
      return jsonError("Debe enviar al menos un archivo en el campo files.", 400);
    }

    const actuales = await getAdjuntosByDocumento(id);
    if (actuales.error) {
      logServerError("adjuntos count", actuales.error);
      return jsonError("No se pudo verificar el número de adjuntos.", 500);
    }

    if (actuales.data.length + files.length > MAX_ADJUNTOS_POR_DOCUMENTO) {
      return jsonError(
        "Este registro admite como máximo 5 archivos adjuntos.",
        400
      );
    }

    for (const file of files) {
      const invalid = validateArchivo(file);
      if (invalid) return jsonError(invalid, 400);
    }

    const created: AdjuntoRow[] = [];

    for (const file of files) {
      const path = buildStoragePath(id, file.name);
      const uploaded = await uploadArchivo(path, file);
      if (uploaded.error) {
        await rollbackAdjuntos(uploadedPaths, insertedIds);
        return jsonError(uploaded.error, 500);
      }
      uploadedPaths.push(path);

      const { data, error } = await adjuntosTable()
        .insert({
          documento_id: id,
          storage_path: path,
          nombre_archivo: file.name.trim(),
          mime_type: file.type || null,
          tamano_bytes: file.size,
        })
        .select(ADJUNTO_SELECT)
        .single();

      if (error || !data) {
        logServerError("insert adjunto", error);
        await rollbackAdjuntos(uploadedPaths, insertedIds);
        return jsonError("No se pudo registrar el archivo adjunto.", 500);
      }

      const row = data as AdjuntoRow;
      insertedIds.push(row.id);
      created.push(row);
    }

    const items = [];
    for (const row of created) {
      const publico = await toAdjuntoPublico(row);
      if (!publico) {
        await rollbackAdjuntos(uploadedPaths, insertedIds);
        return jsonError("No se pudo generar el acceso temporal a un adjunto.", 500);
      }
      items.push(publico);
    }

    return jsonOk({ items }, 201);
  } catch (err) {
    logServerError("adjuntos post", err);
    await rollbackAdjuntos(uploadedPaths, insertedIds);
    return jsonError("Error inesperado al subir adjuntos.", 500);
  }
}

async function rollbackAdjuntos(paths: string[], ids: string[]) {
  if (ids.length > 0) {
    const { error } = await adjuntosTable().delete().in("id", ids);
    if (error) {
      logServerError("rollback adjuntos db", error);
    }
  }
  if (paths.length > 0) {
    await removeStoragePaths(paths);
  }
}
