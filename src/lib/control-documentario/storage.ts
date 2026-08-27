import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  BUCKET_DOCUMENTOS,
  MAX_TAMANO_BYTES,
  MIME_PERMITIDOS,
  SIGNED_URL_TTL_SECONDS,
} from "./constants";
import type { AdjuntoRow } from "./db";

export type AdjuntoPublico = {
  id: string;
  nombre_archivo: string;
  mime_type: string | null;
  tamano_bytes: number | null;
  created_at: string | null;
  signed_url: string;
};

const MIME_SET = new Set<string>(MIME_PERMITIDOS);

export function sanitizeFileName(name: string): string {
  const trimmed = name.trim();
  const base = trimmed.replace(/^.*[\\/]/, "");
  const cleaned = base
    .replace(/[^\w.\-()+ ]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_");
  const sliced = cleaned.slice(0, 80).replace(/^\.+/, "");
  return sliced || "archivo";
}

export function validateArchivo(file: File): string | null {
  const nombre = file.name?.trim() ?? "";
  if (!nombre) return "Hay un archivo sin nombre.";
  if (file.size <= 0) return `El archivo “${nombre}” está vacío.`;
  if (file.size > MAX_TAMANO_BYTES) {
    return `El archivo “${nombre}” supera el máximo de 10 MB.`;
  }
  const mime = (file.type || "").toLowerCase();
  if (!MIME_SET.has(mime)) {
    return `El archivo “${nombre}” tiene un tipo no permitido.`;
  }
  return null;
}

export function buildStoragePath(documentoId: string, originalName: string) {
  return `control-documentario/${documentoId}/${randomUUID()}-${sanitizeFileName(originalName)}`;
}

export async function createSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_DOCUMENTOS)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    console.error(
      "[control-documentario] signed url:",
      error?.message ?? "sin URL"
    );
    return null;
  }
  return data.signedUrl;
}

export async function toAdjuntoPublico(
  row: AdjuntoRow
): Promise<AdjuntoPublico | null> {
  const signed_url = await createSignedUrl(row.storage_path);
  if (!signed_url) return null;
  return {
    id: row.id,
    nombre_archivo: row.nombre_archivo,
    mime_type: row.mime_type,
    tamano_bytes: row.tamano_bytes,
    created_at: row.created_at,
    signed_url,
  };
}

export async function uploadArchivo(
  path: string,
  file: File
): Promise<{ error: string | null }> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await supabaseAdmin.storage
    .from(BUCKET_DOCUMENTOS)
    .upload(path, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (error) {
    console.error("[control-documentario] upload:", error.message);
    return { error: "No se pudo subir el archivo." };
  }
  return { error: null };
}

export async function removeStoragePaths(
  paths: string[]
): Promise<{ error: string | null }> {
  if (paths.length === 0) return { error: null };
  const { error } = await supabaseAdmin.storage
    .from(BUCKET_DOCUMENTOS)
    .remove(paths);

  if (error) {
    console.error("[control-documentario] storage remove:", error.message);
    return { error: "No se pudieron eliminar los archivos del almacenamiento." };
  }
  return { error: null };
}
