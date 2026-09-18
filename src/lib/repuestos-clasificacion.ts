export const TIPO_SKU_VALUES = [
  "Preventivo",
  "Correctivo",
  "Consumible",
  "Herramienta",
] as const;

export const OBSOLESCENCIA_VALUES = ["Si", "No"] as const;

export type TipoSku = (typeof TIPO_SKU_VALUES)[number];
export type Obsolescencia = (typeof OBSOLESCENCIA_VALUES)[number];
export type Rotacion = "Sin Rotación" | "Con Rotación";

export type RepuestoClasificacionRow = {
  codigo: string;
  descripcion: string | null;
  stock: number | string | null;
  ultimo_egreso: string | null;
  costo_unitario_soles: number | string | null;
  tipo_sku: TipoSku | null;
  categoria: string | null;
  sub_categoria: string | null;
  rotacion: Rotacion;
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

export function calcularRotacion(
  ultimoEgreso: string | number | null | undefined,
  now: Date = new Date()
): Rotacion {
  const parsed = parseRepuestoDate(ultimoEgreso);
  if (!parsed) return "Sin Rotación";
  const days = (now.getTime() - parsed.getTime()) / MS_PER_DAY;
  return days > 45 ? "Sin Rotación" : "Con Rotación";
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
