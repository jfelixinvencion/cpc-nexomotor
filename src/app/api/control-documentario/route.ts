import { NextRequest } from "next/server";
import {
  DOCUMENTO_SELECT,
  ITEM_SELECT,
  YMD_RE,
} from "@/lib/control-documentario/constants";
import {
  adjuntosTable,
  buscarConflictos,
  documentosTable,
  itemsTable,
  isUniqueViolation,
  ocNumeroExiste,
  verificarLineasEnVista,
  type DocumentoRow,
} from "@/lib/control-documentario/db";
import { jsonError, jsonOk, logServerError } from "@/lib/control-documentario/http";
import {
  isYmd,
  parseDocumentoPayload,
  resumenDescripcionItems,
  TEXTO_SIN_OC,
  type DocumentoParsed,
} from "@/lib/control-documentario/parse";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function escapeIlike(raw: string) {
  return raw
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/"/g, '\\"');
}

function parsePage(raw: string | null, fallback: number) {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function headerInsert(parsed: DocumentoParsed, descripcion: string | null) {
  const now = new Date().toISOString();
  return {
    es_delivery: parsed.es_delivery,
    numero_oc: parsed.numero_oc,
    tipo_pago: parsed.tipo_pago,
    empresa: parsed.empresa,
    autoriza: parsed.autoriza,
    fecha_emision: parsed.fecha_emision,
    tipo_documento: parsed.tipo_documento,
    numero_documento: parsed.numero_documento,
    ruc: parsed.ruc,
    razon_social: parsed.razon_social,
    placa: parsed.placa,
    descripcion,
    valor_sin_igv: parsed.valor_sin_igv,
    valor_con_igv: parsed.valor_con_igv,
    observaciones: parsed.observaciones,
    confirmado: false,
    confirmado_at: null,
    updated_at: now,
  };
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const search = (sp.get("search") ?? "").trim();
    const fechaDesde = (sp.get("fecha_desde") ?? "").trim();
    const fechaHasta = (sp.get("fecha_hasta") ?? "").trim();

    if (fechaDesde && !isYmd(fechaDesde)) {
      return jsonError("fecha_desde debe tener formato YYYY-MM-DD.", 400);
    }
    if (fechaHasta && !isYmd(fechaHasta)) {
      return jsonError("fecha_hasta debe tener formato YYYY-MM-DD.", 400);
    }
    if (fechaDesde && fechaHasta && fechaDesde > fechaHasta) {
      return jsonError("fecha_desde no puede ser mayor que fecha_hasta.", 400);
    }

    const page = parsePage(sp.get("page"), DEFAULT_PAGE);
    const pageSizeRaw = parsePage(sp.get("page_size"), DEFAULT_PAGE_SIZE);
    if (page == null) return jsonError("page inválido.", 400);
    if (pageSizeRaw == null) return jsonError("page_size inválido.", 400);
    const page_size = Math.min(pageSizeRaw, MAX_PAGE_SIZE);

    const from = (page - 1) * page_size;
    const to = from + page_size - 1;

    let query = documentosTable()
      .select(DOCUMENTO_SELECT, { count: "exact" })
      .order("fecha_emision", { ascending: false })
      .order("created_at", { ascending: false });

    if (fechaDesde) query = query.gte("fecha_emision", fechaDesde);
    if (fechaHasta) query = query.lte("fecha_emision", fechaHasta);

    if (search) {
      const pattern = `"%${escapeIlike(search)}%"`;
      const orParts = [
        `numero_oc.ilike.${pattern}`,
        `tipo_pago.ilike.${pattern}`,
        `tipo_documento.ilike.${pattern}`,
        `numero_documento.ilike.${pattern}`,
        `ruc.ilike.${pattern}`,
        `razon_social.ilike.${pattern}`,
        `placa.ilike.${pattern}`,
        `descripcion.ilike.${pattern}`,
      ];
      if (YMD_RE.test(search) && isYmd(search)) {
        orParts.push(`fecha_emision.eq.${search}`);
      }
      const asMoney = Number(search.replace(",", "."));
      if (Number.isFinite(asMoney) && asMoney >= 0) {
        const rounded = Math.round(asMoney * 100) / 100;
        orParts.push(`valor_con_igv.eq.${rounded}`);
      }
      query = query.or(orParts.join(","));
    }

    const { data, error, count } = await query.range(from, to);
    if (error) {
      logServerError("list", error);
      return jsonError("No se pudieron listar los documentos.", 500);
    }

    const items = (data as DocumentoRow[] | null) ?? [];
    const total = count ?? items.length;
    const has_more = from + items.length < total;

    const counts = new Map<string, number>();
    const ids = items.map((row) => row.id);
    if (ids.length > 0) {
      const { data: adjRows, error: adjError } = await adjuntosTable()
        .select("documento_id")
        .in("documento_id", ids);
      if (adjError) {
        logServerError("list adjuntos count", adjError);
      } else {
        for (const row of (adjRows as { documento_id?: string }[] | null) ?? []) {
          const docId = row.documento_id;
          if (!docId) continue;
          counts.set(docId, (counts.get(docId) ?? 0) + 1);
        }
      }
    }

    return jsonOk({
      items: items.map((row) => ({
        ...row,
        adjuntos_count: counts.get(row.id) ?? 0,
      })),
      total,
      page,
      page_size,
      has_more,
    });
  } catch (err) {
    logServerError("list", err);
    return jsonError("Error inesperado al listar documentos.", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
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

      const conflictos = await buscarConflictos(verified.items);
      if (conflictos.error) {
        logServerError("conflictos", conflictos.error);
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

    const { data: created, error: insertError } = await documentosTable()
      .insert(headerInsert(payload, descripcion))
      .select(DOCUMENTO_SELECT)
      .single();

    if (insertError || !created) {
      logServerError("insert documento", insertError);
      return jsonError("No se pudo crear el documento.", 500);
    }

    const documento = created as DocumentoRow;

    if (payload.items.length > 0) {
      const rows = payload.items.map((item) => ({
        documento_id: documento.id,
        sigma_id: item.sigma_id,
        numero_oc: item.numero_oc,
        linea_orden: item.linea_orden,
        codigo_repuesto: item.codigo_repuesto,
        descripcion_repuesto: item.descripcion_repuesto,
        cantidad: item.cantidad,
        precio_total_con_igv_soles: item.precio_total_con_igv_soles,
      }));

      const { data: insertedItems, error: itemsError } = await itemsTable()
        .insert(rows)
        .select(ITEM_SELECT);

      if (itemsError) {
        logServerError("insert items", itemsError);
        await documentosTable().delete().eq("id", documento.id);
        if (isUniqueViolation(itemsError)) {
          return jsonError(
            "Una o más líneas ya están vinculadas a otro documento.",
            409
          );
        }
        return jsonError("No se pudieron guardar las líneas del documento.", 500);
      }

      return jsonOk({ data: { ...documento, items: insertedItems ?? [] } }, 201);
    }

    return jsonOk({ data: { ...documento, items: [] } }, 201);
  } catch (err) {
    logServerError("create", err);
    return jsonError("Error inesperado al crear el documento.", 500);
  }
}
