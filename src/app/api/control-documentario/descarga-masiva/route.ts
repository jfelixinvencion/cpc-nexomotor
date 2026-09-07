import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import {
  DESCARGA_MASIVA_MAX_ARCHIVOS,
  DESCARGA_MASIVA_MAX_BYTES,
} from "@/lib/control-documentario/constants";
import {
  adjuntosTable,
  documentosTable,
} from "@/lib/control-documentario/db";
import { jsonError, logServerError } from "@/lib/control-documentario/http";
import {
  buildZipEntryPath,
  parseDescargaMasivaPayload,
  uniqueZipPath,
  zipFileName,
} from "@/lib/control-documentario/descarga-masiva";
import { downloadStorageObject } from "@/lib/control-documentario/storage";
import { enforceIfRealSession } from "@/lib/auth/require";

export const maxDuration = 60;

type DocumentoZipRow = {
  id: string;
  numero_oc: string | null;
  doc_transferencia: string | null;
  razon_social: string | null;
};

type AdjuntoZipRow = {
  id: string;
  documento_id: string;
  storage_path: string;
  nombre_archivo: string;
  tamano_bytes: number | null;
};

export async function POST(request: NextRequest) {
  const denied = await enforceIfRealSession(
    request,
    "logistica",
    "control_documentario",
    "descargar_adjuntos_masivo"
  );
  if (denied) return denied;

  try {
    const body = await request.json().catch(() => null);
    const parsed = parseDescargaMasivaPayload(body);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const { desde, hasta, estructura } = parsed.data;

    const { data: docsRaw, error: docsError } = await documentosTable()
      .select("id,numero_oc,doc_transferencia,razon_social")
      .gte("fecha_emision", desde)
      .lte("fecha_emision", hasta);

    if (docsError) {
      logServerError("descarga-masiva docs", docsError);
      return jsonError("No se pudieron listar los documentos del rango.", 500);
    }

    const docs = (docsRaw as DocumentoZipRow[] | null) ?? [];
    if (docs.length === 0) {
      return jsonError("No hay adjuntos en el rango seleccionado.", 400);
    }

    const ids = docs.map((row) => row.id);
    const { data: adjRaw, error: adjError } = await adjuntosTable()
      .select("id,documento_id,storage_path,nombre_archivo,tamano_bytes")
      .in("documento_id", ids);

    if (adjError) {
      logServerError("descarga-masiva adjuntos", adjError);
      return jsonError("No se pudieron listar los adjuntos del rango.", 500);
    }

    const adjuntos = (adjRaw as AdjuntoZipRow[] | null) ?? [];
    if (adjuntos.length === 0) {
      return jsonError("No hay adjuntos en el rango seleccionado.", 400);
    }
    if (adjuntos.length > DESCARGA_MASIVA_MAX_ARCHIVOS) {
      return jsonError(
        `El rango supera el máximo de ${DESCARGA_MASIVA_MAX_ARCHIVOS} archivos.`,
        400
      );
    }

    const knownBytes = adjuntos.reduce((sum, row) => {
      const n = row.tamano_bytes;
      if (n == null || !Number.isFinite(n) || n < 0) return sum;
      return sum + n;
    }, 0);
    if (knownBytes > DESCARGA_MASIVA_MAX_BYTES) {
      return jsonError("El rango supera el máximo de 50 MB.", 400);
    }

    const byId = new Map(docs.map((row) => [row.id, row]));
    const zip = new JSZip();
    const usedPaths = new Set<string>();
    let totalBytes = 0;

    for (const adjunto of adjuntos) {
      const doc = byId.get(adjunto.documento_id);
      if (!doc) continue;
      if (!adjunto.storage_path) {
        return jsonError("Hay un adjunto sin ruta de almacenamiento.", 500);
      }

      const downloaded = await downloadStorageObject(adjunto.storage_path);
      if (downloaded.error || !downloaded.data) {
        return jsonError(
          downloaded.error || "No se pudo descargar un adjunto.",
          500
        );
      }

      totalBytes += downloaded.data.byteLength;
      if (totalBytes > DESCARGA_MASIVA_MAX_BYTES) {
        return jsonError("El rango supera el máximo de 50 MB.", 400);
      }

      const entry = uniqueZipPath(
        usedPaths,
        buildZipEntryPath(estructura, doc, adjunto.nombre_archivo)
      );
      zip.file(entry, downloaded.data);
    }

    if (usedPaths.size === 0) {
      return jsonError("No hay adjuntos en el rango seleccionado.", 400);
    }

    const filename = zipFileName(desde, hasta);
    const bytes = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(bytes.byteLength),
      },
    });
  } catch (err) {
    logServerError("descarga-masiva", err);
    return jsonError("Error inesperado al generar el ZIP.", 500);
  }
}
