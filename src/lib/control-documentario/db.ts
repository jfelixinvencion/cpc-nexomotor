import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  ADJUNTO_SELECT,
  DOCUMENTO_SELECT,
  ITEM_SELECT,
  OC_DETALLE_SELECT,
} from "./constants";
import type { LineaParsed } from "./parse";

export type DocumentoRow = {
  id: string;
  es_delivery: boolean;
  numero_oc: string | null;
  tipo_pago: string;
  empresa: string;
  autoriza: string;
  fecha_emision: string;
  tipo_documento: string;
  numero_documento: string | null;
  doc_transferencia: string | null;
  ruc: string | null;
  razon_social: string | null;
  placa: string | null;
  descripcion: string | null;
  valor_sin_igv: number | string | null;
  valor_con_igv: number | string | null;
  observaciones: string | null;
  validado_contabilidad: boolean;
  confirmado: boolean;
  confirmado_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
};

export type ItemRow = {
  id: string;
  documento_id: string;
  sigma_id: number;
  numero_oc: string;
  linea_orden: number;
  codigo_repuesto: string;
  descripcion_repuesto: string | null;
  cantidad: number | string | null;
  precio_total_con_igv_soles: number | string | null;
  created_at: string | null;
};

export type AdjuntoRow = {
  id: string;
  documento_id: string;
  storage_path: string;
  nombre_archivo: string;
  mime_type: string | null;
  tamano_bytes: number | null;
  created_at: string | null;
};

export type LineaConflicto = {
  sigma_id: number;
  linea_orden: number;
  numero_oc: string;
};

function documentosTable() {
  return supabaseAdmin.from("control_documentario");
}

function itemsTable() {
  return supabaseAdmin.from("control_documentario_items");
}

function adjuntosTable() {
  return supabaseAdmin.from("control_documentario_adjuntos");
}

function ocDetallesTable() {
  return supabaseAdmin.schema("vista").from("oc_detalles");
}

export async function getDocumentoById(
  id: string
): Promise<{ data: DocumentoRow | null; error: string | null }> {
  const { data, error } = await documentosTable()
    .select(DOCUMENTO_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) return { data: null, error: error.message };
  return { data: (data as DocumentoRow | null) ?? null, error: null };
}

export async function getItemsByDocumento(
  documentoId: string
): Promise<{ data: ItemRow[]; error: string | null }> {
  const { data, error } = await itemsTable()
    .select(ITEM_SELECT)
    .eq("documento_id", documentoId)
    .order("linea_orden", { ascending: true });

  if (error) return { data: [], error: error.message };
  return { data: (data as ItemRow[] | null) ?? [], error: null };
}

export async function getAdjuntosByDocumento(
  documentoId: string
): Promise<{ data: AdjuntoRow[]; error: string | null }> {
  const { data, error } = await adjuntosTable()
    .select(ADJUNTO_SELECT)
    .eq("documento_id", documentoId)
    .order("created_at", { ascending: true });

  if (error) return { data: [], error: error.message };
  return { data: (data as AdjuntoRow[] | null) ?? [], error: null };
}

export async function ocNumeroExiste(numeroOc: string): Promise<{
  exists: boolean;
  error: string | null;
}> {
  const { data, error } = await ocDetallesTable()
    .select("numero_oc")
    .eq("numero_oc", numeroOc)
    .limit(1);

  if (error) return { exists: false, error: error.message };
  return { exists: Array.isArray(data) && data.length > 0, error: null };
}

export async function verificarLineasEnVista(items: LineaParsed[]): Promise<{
  ok: true;
  items: LineaParsed[];
} | { ok: false; error: string }> {
  if (items.length === 0) {
    return { ok: false, error: "Debe seleccionar al menos una línea de compra." };
  }

  const sigmaId = items[0].sigma_id;
  if (items.some((item) => item.sigma_id !== sigmaId)) {
    return {
      ok: false,
      error: "Todas las líneas deben pertenecer a la misma orden de compra.",
    };
  }

  const numeroOc = items[0].numero_oc;
  const lineaOrdenes = items.map((item) => item.linea_orden);

  const { data, error } = await ocDetallesTable()
    .select(OC_DETALLE_SELECT)
    .eq("sigma_id", sigmaId)
    .in("linea_orden", lineaOrdenes);

  if (error) {
    console.error("[control-documentario] vista.oc_detalles:", error.message);
    return { ok: false, error: "No se pudieron validar las líneas de compra." };
  }

  const rows = (data as Record<string, unknown>[] | null) ?? [];
  const byOrden = new Map<number, Record<string, unknown>>();
  for (const row of rows) {
    const orden = Number(row.linea_orden);
    if (Number.isInteger(orden)) byOrden.set(orden, row);
  }

  const verified: LineaParsed[] = [];
  for (const item of items) {
    const row = byOrden.get(item.linea_orden);
    if (!row) {
      return {
        ok: false,
        error: `La línea ${item.linea_orden} de la OC ${item.numero_oc} no existe.`,
      };
    }
    const vistaOc = row.numero_oc == null ? "" : String(row.numero_oc).trim();
    if (vistaOc !== numeroOc) {
      return {
        ok: false,
        error: "Las líneas no pertenecen a la OC indicada.",
      };
    }
    const codigo =
      row.codigo_repuesto == null ? "" : String(row.codigo_repuesto).trim();
    if (!codigo) {
      return {
        ok: false,
        error: `La línea ${item.linea_orden} no tiene código de repuesto válido.`,
      };
    }

    const cantidad =
      row.cantidad == null || row.cantidad === ""
        ? null
        : Number(row.cantidad);
    const precio =
      row.precio_total_con_igv_soles == null ||
      row.precio_total_con_igv_soles === ""
        ? null
        : Number(row.precio_total_con_igv_soles);

    verified.push({
      sigma_id: Number(row.sigma_id),
      numero_oc: vistaOc,
      linea_orden: item.linea_orden,
      codigo_repuesto: codigo,
      descripcion_repuesto:
        row.descripcion_repuesto == null || row.descripcion_repuesto === ""
          ? null
          : String(row.descripcion_repuesto).trim(),
      cantidad:
        cantidad != null && Number.isFinite(cantidad) ? cantidad : null,
      precio_total_con_igv_soles:
        precio != null && Number.isFinite(precio) ? precio : null,
    });
  }

  return { ok: true, items: verified };
}

export async function buscarConflictos(
  items: LineaParsed[],
  excludeDocumentoId?: string
): Promise<{ conflictos: LineaConflicto[]; error: string | null }> {
  if (items.length === 0) return { conflictos: [], error: null };

  const sigmaIds = Array.from(new Set(items.map((item) => item.sigma_id)));
  const { data, error } = await itemsTable()
    .select("sigma_id,linea_orden,numero_oc,documento_id")
    .in("sigma_id", sigmaIds);

  if (error) return { conflictos: [], error: error.message };

  const wanted = new Set(
    items.map((item) => `${item.sigma_id}:${item.linea_orden}`)
  );
  const conflictos: LineaConflicto[] = [];

  for (const row of (data as Record<string, unknown>[] | null) ?? []) {
    const documentoId = String(row.documento_id ?? "");
    if (excludeDocumentoId && documentoId === excludeDocumentoId) continue;
    const key = `${Number(row.sigma_id)}:${Number(row.linea_orden)}`;
    if (!wanted.has(key)) continue;
    conflictos.push({
      sigma_id: Number(row.sigma_id),
      linea_orden: Number(row.linea_orden),
      numero_oc: String(row.numero_oc ?? ""),
    });
  }

  return { conflictos, error: null };
}

export function isUniqueViolation(error: { code?: string } | null) {
  return error?.code === "23505";
}

export { documentosTable, itemsTable, adjuntosTable, ocDetallesTable };
