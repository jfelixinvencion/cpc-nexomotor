import {
  DESCARGA_MASIVA_ESTRUCTURAS,
  DESCARGA_MASIVA_MAX_DIAS,
  type DescargaMasivaEstructura,
} from "./constants";
import { asTrimmed, daysInclusiveYmd, isYmd } from "./parse";

export type DescargaMasivaParsed = {
  desde: string;
  hasta: string;
  estructura: DescargaMasivaEstructura;
};

export function parseDescargaMasivaPayload(
  body: unknown
): { ok: true; data: DescargaMasivaParsed } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Solicitud inválida." };
  }
  const b = body as Record<string, unknown>;
  const desde = asTrimmed(b.desde);
  const hasta = asTrimmed(b.hasta);
  const estructura = asTrimmed(b.estructura);

  if (!desde || !hasta) {
    return { ok: false, error: "desde y hasta son obligatorios." };
  }
  if (!isYmd(desde) || !isYmd(hasta)) {
    return { ok: false, error: "desde y hasta deben tener formato YYYY-MM-DD." };
  }
  if (desde > hasta) {
    return { ok: false, error: "desde no puede ser mayor que hasta." };
  }
  const dias = daysInclusiveYmd(desde, hasta);
  if (dias == null || dias > DESCARGA_MASIVA_MAX_DIAS) {
    return {
      ok: false,
      error: `El rango no puede superar ${DESCARGA_MASIVA_MAX_DIAS} días.`,
    };
  }
  if (
    !(DESCARGA_MASIVA_ESTRUCTURAS as readonly string[]).includes(estructura)
  ) {
    return {
      ok: false,
      error:
        "estructura debe ser transferencia_oc o proveedor_transferencia_oc.",
    };
  }

  return {
    ok: true,
    data: {
      desde,
      hasta,
      estructura: estructura as DescargaMasivaEstructura,
    },
  };
}

export function sanitizeZipSegment(value: string, fallback: string): string {
  let t = value.trim().replace(/[\\/:*?"<>|]/g, "_");
  t = t.replace(/\s+/g, " ").trim();
  if (t === "." || t === "..") t = "";
  if (t.length > 80) t = t.slice(0, 80).trim();
  return t || fallback;
}

export function zipFolderName(
  value: string | null | undefined,
  emptyLabel: string
): string {
  return sanitizeZipSegment(value ?? "", emptyLabel);
}

export function uniqueZipPath(used: Set<string>, path: string): string {
  if (!used.has(path)) {
    used.add(path);
    return path;
  }
  const lastSlash = path.lastIndexOf("/");
  const dir = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : "";
  const file = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const dot = file.lastIndexOf(".");
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : "";
  let n = 2;
  let next = `${dir}${stem}_${n}${ext}`;
  while (used.has(next)) {
    n += 1;
    next = `${dir}${stem}_${n}${ext}`;
  }
  used.add(next);
  return next;
}

export function buildZipEntryPath(
  estructura: DescargaMasivaEstructura,
  doc: {
    doc_transferencia: string | null;
    numero_oc: string | null;
    razon_social: string | null;
  },
  nombreArchivo: string
): string {
  const transferencia = zipFolderName(
    doc.doc_transferencia,
    "SIN_TRANSFERENCIA"
  );
  const oc = zipFolderName(doc.numero_oc, "SIN_OC");
  const archivo = sanitizeZipSegment(nombreArchivo, "archivo");
  if (estructura === "proveedor_transferencia_oc") {
    const proveedor = zipFolderName(doc.razon_social, "SIN_PROVEEDOR");
    return `${proveedor}/${transferencia}/${oc}/${archivo}`;
  }
  return `${transferencia}/${oc}/${archivo}`;
}

export function zipFileName(desde: string, hasta: string): string {
  return `adjuntos-control-documentario-${desde}_${hasta}.zip`;
}
