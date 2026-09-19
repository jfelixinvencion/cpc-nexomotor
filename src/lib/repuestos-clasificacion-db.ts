import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  asNullableText,
  calcularStockOutDias,
  diasSinRotacion,
  isSkuExcluido,
  rotacionDesdeDias,
  isObsolescencia,
  isTipoSku,
  type ImportFilaRaw,
  type ImportFilaError,
  type ImportPatch,
  type Obsolescencia,
  type RepuestoClasificacionRow,
  type TipoSku,
  buildImportPatch,
  importPatchHasUpdates,
  isBlankImportFila,
} from "@/lib/repuestos-clasificacion";

const PAGE_SIZE = 1000;

type RepuestoMin = {
  codigo: string;
  repuesto: string | null;
  stock: number | string | null;
  ultimo_egreso: string | null;
  ultimo_ingreso: string | null;
  last_sync_at: string | null;
  costo_unitario_soles: number | string | null;
};

type ClasificacionMin = {
  codigo: string;
  tipo_sku: TipoSku | null;
  categoria: string | null;
  sub_categoria: string | null;
  obsolescencia: Obsolescencia | null;
  consumo_prom_dia: number | string | null;
};

async function fetchAllPages(
  query: (from: number, to: number) => Promise<{
    data: Record<string, unknown>[] | null;
    error: { message: string } | null;
  }>
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    items.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return items;
}

export async function fetchAllRepuestosMinimos(): Promise<RepuestoMin[]> {
  const rows = await fetchAllPages(async (from, to) => {
    const { data, error } = await supabaseAdmin
      .from("repuestos")
      .select(
        "codigo,repuesto,stock,ultimo_egreso,ultimo_ingreso,last_sync_at,costo_unitario_soles"
      )
      .order("codigo", { ascending: true })
      .range(from, to);
    return { data: (data as Record<string, unknown>[] | null) ?? null, error };
  });

  const items: RepuestoMin[] = [];
  for (const row of rows) {
    const codigo = asNullableText(row.codigo);
    if (!codigo || isSkuExcluido(codigo)) continue;
    items.push({
      codigo,
      repuesto: asNullableText(row.repuesto),
      stock: (row.stock as number | string | null) ?? null,
      ultimo_egreso: asNullableText(row.ultimo_egreso),
      ultimo_ingreso: asNullableText(row.ultimo_ingreso),
      last_sync_at: asNullableText(row.last_sync_at),
      costo_unitario_soles:
        (row.costo_unitario_soles as number | string | null) ?? null,
    });
  }
  return items;
}

export async function fetchAllClasificacion(): Promise<ClasificacionMin[]> {
  const rows = await fetchAllPages(async (from, to) => {
    const { data, error } = await supabaseAdmin
      .from("repuestos_clasificacion")
      .select(
        "codigo,tipo_sku,categoria,sub_categoria,obsolescencia,consumo_prom_dia"
      )
      .order("codigo", { ascending: true })
      .range(from, to);
    return { data: (data as Record<string, unknown>[] | null) ?? null, error };
  });

  return rows.map((row) => ({
    codigo: String(row.codigo ?? ""),
    tipo_sku: isTipoSku(row.tipo_sku) ? row.tipo_sku : null,
    categoria: asNullableText(row.categoria),
    sub_categoria: asNullableText(row.sub_categoria),
    obsolescencia: isObsolescencia(row.obsolescencia)
      ? row.obsolescencia
      : null,
    consumo_prom_dia:
      (row.consumo_prom_dia as number | string | null) ?? null,
  }));
}

export async function fetchLatestProveedorByCodigo(): Promise<
  Map<string, string>
> {
  const latest = new Map<string, { proveedor: string; fecha: string }>();
  const rows = await fetchAllPages(async (from, to) => {
    const { data, error } = await supabaseAdmin
      .schema("vista")
      .from("oc_detalles")
      .select("codigo_repuesto,proveedor,fecha_creacion,sigma_id,linea_orden")
      .order("fecha_creacion", { ascending: false })
      .order("sigma_id", { ascending: false })
      .order("linea_orden", { ascending: false })
      .range(from, to);
    return { data: (data as Record<string, unknown>[] | null) ?? null, error };
  });

  for (const row of rows) {
    const codigo = asNullableText(row.codigo_repuesto);
    const proveedor = asNullableText(row.proveedor);
    if (!codigo || !proveedor) continue;
    const fecha = asNullableText(row.fecha_creacion) ?? "";
    const prev = latest.get(codigo);
    if (!prev || fecha > prev.fecha) {
      latest.set(codigo, { proveedor, fecha });
    }
  }

  const out = new Map<string, string>();
  for (const [codigo, value] of latest) {
    out.set(codigo, value.proveedor);
  }
  return out;
}

export function buildClasificacionItems(
  repuestos: RepuestoMin[],
  clasificacion: ClasificacionMin[],
  proveedores: Map<string, string>,
  now = new Date()
): RepuestoClasificacionRow[] {
  const clasifByCodigo = new Map(
    clasificacion.filter((row) => row.codigo).map((row) => [row.codigo, row])
  );

  return repuestos.map((row) => {
    const clasif = clasifByCodigo.get(row.codigo);
    const consumo = clasif?.consumo_prom_dia ?? null;
    const dias = diasSinRotacion(row, now);
    return {
      codigo: row.codigo,
      descripcion: row.repuesto,
      stock: row.stock,
      ultimo_egreso: row.ultimo_egreso,
      costo_unitario_soles: row.costo_unitario_soles,
      tipo_sku: clasif?.tipo_sku ?? null,
      categoria: clasif?.categoria ?? null,
      sub_categoria: clasif?.sub_categoria ?? null,
      dias_sin_rotacion: dias,
      rotacion: rotacionDesdeDias(dias),
      obsolescencia: clasif?.obsolescencia ?? null,
      consumo_prom_dia: consumo,
      proveedor: proveedores.get(row.codigo) ?? null,
      stock_out_dias: calcularStockOutDias(row.stock, consumo),
    };
  });
}

export async function listRepuestosClasificacion(): Promise<
  RepuestoClasificacionRow[]
> {
  const [repuestos, clasificacion, proveedores] = await Promise.all([
    fetchAllRepuestosMinimos(),
    fetchAllClasificacion(),
    fetchLatestProveedorByCodigo(),
  ]);
  return buildClasificacionItems(repuestos, clasificacion, proveedores);
}

export type RepuestoJoinRow = RepuestoClasificacionRow & {
  ultimo_ingreso: string | null;
  last_sync_at: string | null;
};

export async function listRepuestosJoinBase(): Promise<{
  items: RepuestoJoinRow[];
  fechaActualizacionTabla: string | null;
}> {
  const [repuestos, clasificacion] = await Promise.all([
    fetchAllRepuestosMinimos(),
    fetchAllClasificacion(),
  ]);
  const base = buildClasificacionItems(repuestos, clasificacion, new Map());
  const extra = new Map(repuestos.map((row) => [row.codigo, row]));
  let fechaActualizacionTabla: string | null = null;
  const items: RepuestoJoinRow[] = base.map((row) => {
    const src = extra.get(row.codigo);
    const lastSync = src?.last_sync_at ?? null;
    if (
      lastSync &&
      (!fechaActualizacionTabla || lastSync > fechaActualizacionTabla)
    ) {
      fechaActualizacionTabla = lastSync;
    }
    return {
      ...row,
      ultimo_ingreso: src?.ultimo_ingreso ?? null,
      last_sync_at: lastSync,
    };
  });
  return { items, fechaActualizacionTabla };
}

export const INSERT_BATCH_SIZE = 500;
const IMPORT_APPLY_CHUNK = 20;

export type ImportClasificacionResult = {
  total_filas: number;
  actualizados: number;
  errores: ImportFilaError[];
};

function clasifExistsMap(rows: ClasificacionMin[]): Set<string> {
  return new Set(rows.map((row) => row.codigo).filter(Boolean));
}

function repuestoCodigoIndex(rows: RepuestoMin[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const row of rows) {
    if (!row.codigo) continue;
    index.set(row.codigo, row.codigo);
    const lower = row.codigo.toLowerCase();
    if (!index.has(lower)) index.set(lower, row.codigo);
  }
  return index;
}

function resolveRepuestoCodigo(
  codigo: string,
  index: Map<string, string>
): string | null {
  return index.get(codigo) ?? index.get(codigo.toLowerCase()) ?? null;
}

async function applyImportPatch(
  patch: ImportPatch,
  existsClasif: boolean,
  now: string
) {
  const fields: Record<string, unknown> = { updated_at: now };
  if (patch.tipo_sku !== undefined) fields.tipo_sku = patch.tipo_sku;
  if (patch.categoria !== undefined) fields.categoria = patch.categoria;
  if (patch.sub_categoria !== undefined) {
    fields.sub_categoria = patch.sub_categoria;
  }
  if (patch.obsolescencia !== undefined) {
    fields.obsolescencia = patch.obsolescencia;
  }

  if (existsClasif) {
    const { error } = await supabaseAdmin
      .from("repuestos_clasificacion")
      .update(fields)
      .eq("codigo", patch.codigo);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabaseAdmin.from("repuestos_clasificacion").insert({
    codigo: patch.codigo,
    tipo_sku: patch.tipo_sku ?? null,
    categoria: patch.categoria ?? null,
    sub_categoria: patch.sub_categoria ?? null,
    obsolescencia: patch.obsolescencia ?? null,
    consumo_prom_dia: null,
    created_at: now,
    updated_at: now,
  });
  if (!error) return;
  if (error.code === "23505") {
    const { error: retryError } = await supabaseAdmin
      .from("repuestos_clasificacion")
      .update(fields)
      .eq("codigo", patch.codigo);
    if (retryError) throw new Error(retryError.message);
    return;
  }
  throw new Error(error.message);
}

export async function importarClasificacion(
  filas: ImportFilaRaw[],
  apply: boolean
): Promise<ImportClasificacionResult> {
  const [repuestos, clasificacion] = await Promise.all([
    fetchAllRepuestosMinimos(),
    fetchAllClasificacion(),
  ]);
  const codigoIndex = repuestoCodigoIndex(repuestos);
  const existingClasif = clasifExistsMap(clasificacion);

  const errores: ImportFilaError[] = [];
  const validByCodigo = new Map<string, ImportPatch>();
  let totalFilas = 0;

  for (const row of filas) {
    if (isBlankImportFila(row)) continue;
    totalFilas += 1;
    const built = buildImportPatch(row);
    if (!built.ok) {
      errores.push(built.error);
      continue;
    }
    if (isSkuExcluido(built.patch.codigo)) continue;
    const canonical = resolveRepuestoCodigo(built.patch.codigo, codigoIndex);
    if (!canonical) {
      errores.push({
        codigo: built.patch.codigo,
        motivo: "Código no encontrado en repuestos",
      });
      continue;
    }
    const next = { ...built.patch, codigo: canonical };
    const prev = validByCodigo.get(canonical);
    validByCodigo.set(canonical, prev ? { ...prev, ...next } : next);
  }

  const toApply = Array.from(validByCodigo.values()).filter(importPatchHasUpdates);
  if (!apply) {
    return {
      total_filas: totalFilas,
      actualizados: toApply.length,
      errores,
    };
  }

  const now = new Date().toISOString();
  let actualizados = 0;
  for (let i = 0; i < toApply.length; i += IMPORT_APPLY_CHUNK) {
    const chunk = toApply.slice(i, i + IMPORT_APPLY_CHUNK);
    const results = await Promise.allSettled(
      chunk.map((patch) =>
        applyImportPatch(patch, existingClasif.has(patch.codigo), now)
      )
    );
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        actualizados += 1;
        existingClasif.add(chunk[index].codigo);
        return;
      }
      const message =
        result.reason instanceof Error
          ? result.reason.message
          : "No se pudo guardar";
      errores.push({
        codigo: chunk[index].codigo,
        motivo: `No se pudo guardar: ${message}`,
      });
    });
  }

  return {
    total_filas: totalFilas,
    actualizados,
    errores,
  };
}
