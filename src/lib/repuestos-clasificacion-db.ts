import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  asNullableText,
  calcularRotacion,
  calcularStockOutDias,
  isObsolescencia,
  isTipoSku,
  type Obsolescencia,
  type RepuestoClasificacionRow,
  type TipoSku,
} from "@/lib/repuestos-clasificacion";

const PAGE_SIZE = 1000;

type RepuestoMin = {
  codigo: string;
  repuesto: string | null;
  stock: number | string | null;
  ultimo_egreso: string | null;
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
      .select("codigo,repuesto,stock,ultimo_egreso,costo_unitario_soles")
      .order("codigo", { ascending: true })
      .range(from, to);
    return { data: (data as Record<string, unknown>[] | null) ?? null, error };
  });

  const items: RepuestoMin[] = [];
  for (const row of rows) {
    const codigo = asNullableText(row.codigo);
    if (!codigo) continue;
    items.push({
      codigo,
      repuesto: asNullableText(row.repuesto),
      stock: (row.stock as number | string | null) ?? null,
      ultimo_egreso: asNullableText(row.ultimo_egreso),
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
    return {
      codigo: row.codigo,
      descripcion: row.repuesto,
      stock: row.stock,
      ultimo_egreso: row.ultimo_egreso,
      costo_unitario_soles: row.costo_unitario_soles,
      tipo_sku: clasif?.tipo_sku ?? null,
      categoria: clasif?.categoria ?? null,
      sub_categoria: clasif?.sub_categoria ?? null,
      rotacion: calcularRotacion(row.ultimo_egreso, now),
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

export const INSERT_BATCH_SIZE = 500;
