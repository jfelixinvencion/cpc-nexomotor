export const BUCKET_DOCUMENTOS = "documentos-logistica";
export const MAX_ADJUNTOS_POR_DOCUMENTO = 5;
export const MAX_TAMANO_BYTES = 10_485_760;
export const SIGNED_URL_TTL_SECONDS = 600;

export const TIPOS_PAGO = ["Caja Chica", "Programado", "Otros"] as const;
export const TIPOS_DOCUMENTO = ["Factura", "Boleta", "Otros"] as const;
export const RAZONES_SOCIALES_DELIVERY = ["INDRIVE", "OTRO"] as const;
export const TEXTO_SIN_OC = "Sin OC";

export const MIME_PERMITIDOS = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/xml",
  "text/xml",
  "application/zip",
  "application/x-zip-compressed",
  "text/html",
] as const;

export const DOCUMENTO_SELECT =
  "id,es_delivery,numero_oc,tipo_pago,empresa,autoriza,fecha_emision,tipo_documento,numero_documento,doc_transferencia,ruc,razon_social,placa,descripcion,valor_sin_igv,valor_con_igv,observaciones,validado_contabilidad,confirmado,confirmado_at,created_at,updated_at,created_by";

export const ITEM_SELECT =
  "id,documento_id,sigma_id,numero_oc,linea_orden,codigo_repuesto,descripcion_repuesto,cantidad,precio_total_con_igv_soles,created_at";

export const ADJUNTO_SELECT =
  "id,documento_id,storage_path,nombre_archivo,mime_type,tamano_bytes,created_at";

export const OC_DETALLE_SELECT =
  "sigma_id,numero_oc,linea_orden,codigo_repuesto,descripcion_repuesto,cantidad,precio_total_con_igv_soles";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
