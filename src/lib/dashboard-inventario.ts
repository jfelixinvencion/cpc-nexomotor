import {
  TIPO_SKU_VALUES,
  asNullableText,
  diasSinRotacion,
  isSkuExcluido,
  rotacionDesdeDias,
  type RotacionEstado,
  type TipoSku,
} from "@/lib/repuestos-clasificacion";
import type { RepuestoJoinRow } from "@/lib/repuestos-clasificacion-db";

export { diasSinRotacion } from "@/lib/repuestos-clasificacion";

export const DASHBOARD_COLORS = {
  Preventivo: "#1D9E75",
  Correctivo: "#D85A30",
  Consumible: "#378ADD",
  Herramienta: "#BA7517",
} as const;

export type InventarioItem = {
  codigo: string;
  descripcion: string | null;
  tipo_sku: TipoSku | null;
  categoria: string | null;
  sub_categoria: string | null;
  valor: number;
  dias_sin_rotacion: number | null;
  rotacion: RotacionEstado;
  clasificado: boolean;
  stock: number;
};

export type ValorPorTipo = { tipo_sku: TipoSku; valor: number };
export type ValorPorCategoria = { categoria: string; valor: number };
export type DetalleInventario = {
  codigo: string;
  descripcion: string | null;
  tipo_sku: TipoSku | null;
  categoria: string | null;
  sub_categoria: string | null;
  valor: number;
  stock: number;
  dias_sin_rotacion: number | null;
  rotacion: RotacionEstado;
  clasificado: boolean;
};

export function toFiniteNumber(value: number | string | null | undefined) {
  if (value == null || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function isClasificado(item: {
  tipo_sku: string | null;
  categoria: string | null;
  sub_categoria: string | null;
  obsolescencia: string | null;
}) {
  return (
    asNullableText(item.tipo_sku) != null &&
    asNullableText(item.categoria) != null &&
    asNullableText(item.sub_categoria) != null &&
    asNullableText(item.obsolescencia) != null
  );
}

export function toInventarioItems(
  rows: RepuestoJoinRow[],
  now: Date = new Date()
): InventarioItem[] {
  const items: InventarioItem[] = [];
  for (const row of rows) {
    if (isSkuExcluido(row.codigo)) continue;
    const stock = toFiniteNumber(row.stock);
    if (stock <= 0) continue;
    const costo = toFiniteNumber(row.costo_unitario_soles);
    const dias = diasSinRotacion(row, now);
    items.push({
      codigo: row.codigo,
      descripcion: row.descripcion,
      tipo_sku: row.tipo_sku,
      categoria: row.categoria,
      sub_categoria: row.sub_categoria,
      valor: Math.round(stock * costo * 100) / 100,
      dias_sin_rotacion: dias,
      rotacion: rotacionDesdeDias(dias),
      clasificado: isClasificado(row),
      stock,
    });
  }
  return items;
}

function clasificados(items: InventarioItem[]) {
  return items.filter((item) => item.clasificado);
}

function sortByValorDesc<T extends { valor: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.valor - a.valor);
}

export function valorizadoTotal(items: InventarioItem[]) {
  return clasificados(items).reduce((sum, item) => sum + item.valor, 0);
}

export function conteoSkusConStock(items: InventarioItem[]) {
  return clasificados(items).length;
}

export function conteoSinClasificar(items: InventarioItem[]) {
  return items.filter((item) => !item.clasificado).length;
}

export function sinRotacion(items: InventarioItem[]) {
  const total = valorizadoTotal(items);
  const valor = clasificados(items)
    .filter((item) => item.rotacion === "Sin Rotación")
    .reduce((sum, item) => sum + item.valor, 0);
  return {
    valor,
    porcentaje: total > 0 ? (valor / total) * 100 : 0,
  };
}

export function porTipoSku(items: InventarioItem[]): ValorPorTipo[] {
  const map = new Map<TipoSku, number>();
  for (const tipo of TIPO_SKU_VALUES) map.set(tipo, 0);
  for (const item of clasificados(items)) {
    if (!item.tipo_sku) continue;
    map.set(item.tipo_sku, (map.get(item.tipo_sku) ?? 0) + item.valor);
  }
  return sortByValorDesc(
    TIPO_SKU_VALUES.map((tipo_sku) => ({
      tipo_sku,
      valor: map.get(tipo_sku) ?? 0,
    })).filter((row) => row.valor > 0)
  );
}

export function porCategoria(
  items: InventarioItem[],
  tipo_sku: TipoSku
): ValorPorCategoria[] {
  const map = new Map<string, number>();
  for (const item of clasificados(items)) {
    if (item.tipo_sku !== tipo_sku) continue;
    const categoria = asNullableText(item.categoria) ?? "Sin categoría";
    map.set(categoria, (map.get(categoria) ?? 0) + item.valor);
  }
  return sortByValorDesc(
    Array.from(map.entries()).map(([categoria, valor]) => ({
      categoria,
      valor,
    }))
  );
}

export function porCategoriaSinRotacion(
  items: InventarioItem[]
): ValorPorCategoria[] {
  const map = new Map<string, number>();
  for (const item of clasificados(items)) {
    if (item.rotacion !== "Sin Rotación") continue;
    const categoria = asNullableText(item.categoria) ?? "Sin categoría";
    map.set(categoria, (map.get(categoria) ?? 0) + item.valor);
  }
  return sortByValorDesc(
    Array.from(map.entries()).map(([categoria, valor]) => ({
      categoria,
      valor,
    }))
  );
}

export function porRotacion(items: InventarioItem[]) {
  let conRotacion = 0;
  let sinRotacionValor = 0;
  for (const item of clasificados(items)) {
    if (item.rotacion === "Con Rotación") conRotacion += item.valor;
    else if (item.rotacion === "Sin Rotación") sinRotacionValor += item.valor;
  }
  return { conRotacion, sinRotacion: sinRotacionValor };
}

export function itemsDetalle(items: InventarioItem[]): DetalleInventario[] {
  return sortByValorDesc(items).map((item) => ({
    codigo: item.codigo,
    descripcion: item.descripcion,
    tipo_sku: item.tipo_sku,
    categoria: item.categoria,
    sub_categoria: item.sub_categoria,
    valor: item.valor,
    stock: item.stock,
    dias_sin_rotacion: item.dias_sin_rotacion,
    rotacion: item.rotacion,
    clasificado: item.clasificado,
  }));
}

export function totalPorTipo(items: InventarioItem[], tipo: TipoSku) {
  return clasificados(items)
    .filter((item) => item.tipo_sku === tipo)
    .reduce((sum, item) => sum + item.valor, 0);
}
