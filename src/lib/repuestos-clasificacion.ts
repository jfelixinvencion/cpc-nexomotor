export const TIPO_SKU_VALUES = [
  "Preventivo",
  "Correctivo",
  "Consumible",
  "Herramienta",
] as const;

export const OBSOLESCENCIA_VALUES = ["Si", "No"] as const;

/** SKUs fantasma que no deben listarse ni sincronizarse (siguen en public.repuestos). */
export const SKUS_EXCLUIDOS = ["INSUMOS-MATERIALES"] as const;

/** Días sin movimiento a partir de los cuales un SKU se considera sin rotación. */
export const DIAS_UMBRAL_SIN_ROTACION = 60;

export type TipoSku = (typeof TIPO_SKU_VALUES)[number];
export type Obsolescencia = (typeof OBSOLESCENCIA_VALUES)[number];
export type Rotacion = "Sin Rotación" | "Con Rotación";
export type RotacionEstado = Rotacion | "Sin dato";

export type RepuestoClasificacionRow = {
  codigo: string;
  descripcion: string | null;
  stock: number | string | null;
  ultimo_egreso: string | null;
  costo_unitario_soles: number | string | null;
  tipo_sku: TipoSku | null;
  categoria: string | null;
  sub_categoria: string | null;
  dias_sin_rotacion: number | null;
  rotacion: RotacionEstado;
  obsolescencia: Obsolescencia | null;
  consumo_prom_dia: number | string | null;
  proveedor: string | null;
  stock_out_dias: number | null;
};

const MS_PER_DAY = 86_400_000;
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

export function parseRepuestoDate(
  value: string | number | null | undefined
): Date | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return excelSerialToLocalDate(value);
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
      return excelSerialToLocalDate(serial);
    }
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function excelSerialToLocalDate(serial: number): Date | null {
  if (!Number.isFinite(serial)) return null;
  const utc = new Date(EXCEL_EPOCH_UTC + Math.floor(serial) * MS_PER_DAY);
  if (Number.isNaN(utc.getTime())) return null;
  return new Date(
    utc.getUTCFullYear(),
    utc.getUTCMonth(),
    utc.getUTCDate(),
    12,
    0,
    0
  );
}

export function isTipoSku(value: unknown): value is TipoSku {
  return (
    typeof value === "string" &&
    (TIPO_SKU_VALUES as readonly string[]).includes(value)
  );
}

export function isObsolescencia(value: unknown): value is Obsolescencia {
  return (
    typeof value === "string" &&
    (OBSOLESCENCIA_VALUES as readonly string[]).includes(value)
  );
}

export function diasSinRotacion(
  item: {
    ultimo_egreso?: string | number | null;
    ultimo_ingreso?: string | number | null;
  },
  now: Date = new Date()
): number | null {
  const parsed =
    parseRepuestoDate(item.ultimo_egreso) ??
    parseRepuestoDate(item.ultimo_ingreso);
  if (!parsed) return null;
  const days = Math.floor((now.getTime() - parsed.getTime()) / MS_PER_DAY);
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

export function rotacionDesdeDias(days: number | null): RotacionEstado {
  if (days == null) return "Sin dato";
  return days > DIAS_UMBRAL_SIN_ROTACION ? "Sin Rotación" : "Con Rotación";
}

export function calcularRotacion(
  ultimoEgreso: string | number | null | undefined,
  now: Date = new Date()
): Rotacion {
  const estado = rotacionDesdeDias(
    diasSinRotacion({ ultimo_egreso: ultimoEgreso ?? null }, now)
  );
  return estado === "Sin dato" ? "Sin Rotación" : estado;
}

export function calcularStockOutDias(
  stock: number | string | null | undefined,
  consumoPromDia: number | string | null | undefined
): number | null {
  if (
    stock == null ||
    stock === "" ||
    consumoPromDia == null ||
    consumoPromDia === ""
  ) {
    return null;
  }
  const s = typeof stock === "number" ? stock : Number(stock);
  const c =
    typeof consumoPromDia === "number"
      ? consumoPromDia
      : Number(consumoPromDia);
  if (!Number.isFinite(s) || !Number.isFinite(c) || c === 0) return null;
  return s / c;
}

export function asNullableText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

export function isSkuExcluido(codigo: string | null | undefined): boolean {
  const key = asNullableText(codigo);
  if (!key) return false;
  const normalized = key.toLowerCase();
  return SKUS_EXCLUIDOS.some((sku) => sku.toLowerCase() === normalized);
}

export type ImportFilaRaw = {
  codigo?: unknown;
  tipo_sku?: unknown;
  categoria?: unknown;
  sub_categoria?: unknown;
  obsolescencia?: unknown;
};

export type ImportPatch = {
  codigo: string;
  tipo_sku?: TipoSku;
  categoria?: string;
  sub_categoria?: string;
  obsolescencia?: Obsolescencia;
};

export type ImportFilaError = {
  codigo: string;
  motivo: string;
};

function isNormError(value: unknown): value is { error: string } {
  return (
    typeof value === "object" &&
    value != null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
  );
}

export function normalizeTipoSkuInput(
  value: unknown
): TipoSku | null | { error: string } {
  const text = asNullableText(value);
  if (text == null) return null;
  const found = TIPO_SKU_VALUES.find(
    (item) => item.toLowerCase() === text.toLowerCase()
  );
  if (found) return found;
  return { error: `tipo_sku inválido: "${text}"` };
}

export function normalizeObsolescenciaInput(
  value: unknown
): Obsolescencia | null | { error: string } {
  const text = asNullableText(value);
  if (text == null) return null;
  const folded = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (folded === "si") return "Si";
  if (folded === "no") return "No";
  return { error: `obsolescencia inválida: "${text}"` };
}

export function buildImportPatch(
  row: ImportFilaRaw
): { ok: true; patch: ImportPatch } | { ok: false; error: ImportFilaError } {
  const codigo = asNullableText(row.codigo);
  if (!codigo) {
    return {
      ok: false,
      error: { codigo: "", motivo: "Código vacío" },
    };
  }

  const tipo = normalizeTipoSkuInput(row.tipo_sku);
  if (isNormError(tipo)) {
    return { ok: false, error: { codigo, motivo: tipo.error } };
  }
  const obs = normalizeObsolescenciaInput(row.obsolescencia);
  if (isNormError(obs)) {
    return { ok: false, error: { codigo, motivo: obs.error } };
  }

  const patch: ImportPatch = { codigo };
  if (tipo) patch.tipo_sku = tipo;
  const categoria = asNullableText(row.categoria);
  if (categoria) patch.categoria = categoria;
  const subCategoria = asNullableText(row.sub_categoria);
  if (subCategoria) patch.sub_categoria = subCategoria;
  if (obs) patch.obsolescencia = obs;
  return { ok: true, patch };
}

export function importPatchHasUpdates(patch: ImportPatch): boolean {
  return (
    patch.tipo_sku != null ||
    patch.categoria != null ||
    patch.sub_categoria != null ||
    patch.obsolescencia != null
  );
}

export function isBlankImportFila(row: ImportFilaRaw): boolean {
  return (
    asNullableText(row.codigo) == null &&
    asNullableText(row.tipo_sku) == null &&
    asNullableText(row.categoria) == null &&
    asNullableText(row.sub_categoria) == null &&
    asNullableText(row.obsolescencia) == null
  );
}
