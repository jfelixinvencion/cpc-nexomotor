import * as XLSX from "xlsx";
import { parseRepuestoDate } from "@/lib/repuestos-clasificacion";

export type VentaTallerParsedRow = {
  empresa: string | null;
  local: string | null;
  seccion: string | null;
  ot: string;
  seguro: string | null;
  asesor: string | null;
  tecnicos: string | null;
  fecha_ingreso: string | null;
  fecha_anulacion: string | null;
  fecha_entrega: string | null;
  fecha_facturacion: string | null;
  tipo_ot: string | null;
  estado: string | null;
  centro_costos: string | null;
  estado_vehiculo: string | null;
  tc_ot: number | null;
  kilometraje: number | null;
  placa: string | null;
  vin: string | null;
  motor: string | null;
  marca: string | null;
  modelo_tecnico: string | null;
  color: string | null;
  anio_fabricacion: string | null;
  anio_modelo: string | null;
  tipo_doc: string | null;
  documento: string | null;
  cliente: string | null;
  celular: string | null;
  correo: string | null;
  direccion: string | null;
  ubigeo: string | null;
  tc_comprobante: number | null;
  moneda: string | null;
  fecha_comprobante: string | null;
  comprobante: string | null;
  tipo: string | null;
  marca_repuesto: string | null;
  codigo: string | null;
  descripcion: string | null;
  cant_solicitada: number | null;
  precio_soles: number | null;
  dscto_marca_soles: number | null;
  dscto_dealer_soles: number | null;
  dscto_total_soles: number | null;
  precio_total_soles: number | null;
  costo_unitario_soles: number | null;
  costo_total_soles: number | null;
  margen_total_soles: number | null;
  precio_dolares: number | null;
  dscto_marca_dolares: number | null;
  dscto_dealer_dolares: number | null;
  dscto_total_dolares: number | null;
  precio_total_dolares: number | null;
  costo_unitario_dolares: number | null;
  costo_total_dolares: number | null;
  margen_total_dolares: number | null;
  observaciones: string | null;
};

const SOLES_OFFSET = 41;
const DOLARES_OFFSET = 49;

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function getCellValue(
  sheet: XLSX.WorkSheet,
  row: number,
  col: number
): unknown {
  const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
  if (!cell) return undefined;
  if (cell.v !== undefined && cell.v !== null && cell.v !== "") return cell.v;
  if (cell.w !== undefined && cell.w !== null && String(cell.w).trim() !== "") {
    return cell.w;
  }
  return cell.v;
}

function cleanString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return String(value);
  }
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function parseNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const cleaned = String(value)
    .trim()
    .replace(/^S\/\s*/i, "")
    .replace(/^\$\s*/, "")
    .replace(/%\s*$/, "")
    .replace(/,/g, "")
    .replace(/\s/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateOnly(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toDateOnly(value);
  }
  const parsed = parseRepuestoDate(
    value as string | number | null | undefined
  );
  if (!parsed) return null;
  return toDateOnly(parsed);
}

function findHeaderOrigin(sheet: XLSX.WorkSheet): {
  headerRow: number;
  startCol: number;
} {
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 30); r++) {
    for (let c = range.s.c; c <= Math.min(range.e.c, range.s.c + 15); c++) {
      const a = normalizeHeader(getCellValue(sheet, r, c));
      const b = normalizeHeader(getCellValue(sheet, r, c + 1));
      const d = normalizeHeader(getCellValue(sheet, r, c + 3));
      if (a === "EMPRESA" && b === "LOCAL" && d === "OT") {
        return { headerRow: r, startCol: c };
      }
    }
  }
  throw new Error(
    "No se encontró la fila de encabezados de Ventas de Taller (EMPRESA / LOCAL / OT)"
  );
}

function parseRow(
  sheet: XLSX.WorkSheet,
  row: number,
  startCol: number
): VentaTallerParsedRow | null {
  const cell = (offset: number) => getCellValue(sheet, row, startCol + offset);
  const ot = cleanString(cell(3));
  if (!ot) return null;

  const soles = (i: number) => parseNumber(cell(SOLES_OFFSET + i));
  const dolares = (i: number) => parseNumber(cell(DOLARES_OFFSET + i));

  return {
    empresa: cleanString(cell(0)),
    local: cleanString(cell(1)),
    seccion: cleanString(cell(2)),
    ot,
    seguro: cleanString(cell(4)),
    asesor: cleanString(cell(5)),
    tecnicos: cleanString(cell(6)),
    fecha_ingreso: parseDateOnly(cell(7)),
    fecha_anulacion: parseDateOnly(cell(8)),
    fecha_entrega: parseDateOnly(cell(9)),
    fecha_facturacion: parseDateOnly(cell(10)),
    tipo_ot: cleanString(cell(11)),
    estado: cleanString(cell(12)),
    centro_costos: cleanString(cell(13)),
    estado_vehiculo: cleanString(cell(14)),
    tc_ot: parseNumber(cell(15)),
    kilometraje: parseNumber(cell(16)),
    placa: cleanString(cell(17)),
    vin: cleanString(cell(18)),
    motor: cleanString(cell(19)),
    marca: cleanString(cell(20)),
    modelo_tecnico: cleanString(cell(21)),
    color: cleanString(cell(22)),
    anio_fabricacion: cleanString(cell(23)),
    anio_modelo: cleanString(cell(24)),
    tipo_doc: cleanString(cell(25)),
    documento: cleanString(cell(26)),
    cliente: cleanString(cell(27)),
    celular: cleanString(cell(28)),
    correo: cleanString(cell(29)),
    direccion: cleanString(cell(30)),
    ubigeo: cleanString(cell(31)),
    tc_comprobante: parseNumber(cell(32)),
    moneda: cleanString(cell(33)),
    fecha_comprobante: parseDateOnly(cell(34)),
    comprobante: cleanString(cell(35)),
    tipo: cleanString(cell(36)),
    marca_repuesto: cleanString(cell(37)),
    codigo: cleanString(cell(38)),
    descripcion: cleanString(cell(39)),
    cant_solicitada: parseNumber(cell(40)),
    precio_soles: soles(0),
    dscto_marca_soles: soles(1),
    dscto_dealer_soles: soles(2),
    dscto_total_soles: soles(3),
    precio_total_soles: soles(4),
    costo_unitario_soles: soles(5),
    costo_total_soles: soles(6),
    margen_total_soles: soles(7),
    precio_dolares: dolares(0),
    dscto_marca_dolares: dolares(1),
    dscto_dealer_dolares: dolares(2),
    dscto_total_dolares: dolares(3),
    precio_total_dolares: dolares(4),
    costo_unitario_dolares: dolares(5),
    costo_total_dolares: dolares(6),
    margen_total_dolares: dolares(7),
    observaciones: cleanString(cell(57)),
  };
}

export function parseVentasTallerSheet(sheet: XLSX.WorkSheet): {
  rows: VentaTallerParsedRow[];
} {
  const { headerRow, startCol } = findHeaderOrigin(sheet);
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  const rows: VentaTallerParsedRow[] = [];

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const row = parseRow(sheet, r, startCol);
    if (row) rows.push(row);
  }

  return { rows };
}

export async function parseVentasTallerXlsxFromUrl(fileUrl: string): Promise<{
  rows: VentaTallerParsedRow[];
}> {
  const res = await fetch(fileUrl);
  if (!res.ok) {
    throw new Error(`Failed to download xlsx: ${res.status}`);
  }

  const buffer = await res.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error("Empty workbook");
  }

  return parseVentasTallerSheet(sheet);
}
