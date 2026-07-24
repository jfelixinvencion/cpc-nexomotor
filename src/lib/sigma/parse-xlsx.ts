import * as XLSX from "xlsx";

export interface RepuestoRow {
  codigo: string;
  local: string | null;
  repuesto: string | null;
  ubicacion: string | null;
  stock: number;
  ultimo_ingreso: string | null;
  ultimo_egreso: string | null;
  marca: string | null;
  categoria: string | null;
  aplicacion_modelos: string | null;
  costo_unitario_soles: number;
  costo_unitario_dolares: number;
  costo_total_soles: number;
  costo_total_dolares: number;
  clasificacion: string | null;
  obsolescencia: string | null;
  last_sync_at: string;
}

export interface ParseXlsxDiagnostics {
  headerRow: number;
  headersRaw: string[];
  headersNormalized: string[];
  columnMap: Record<string, string>;
  localColumns: number[];
  ubicacionColumns: number[];
  firstRowSample: Record<string, unknown> | null;
  localNonEmpty: number;
  ubicacionNonEmpty: number;
  totalRows: number;
}

const NUMERIC_FIELDS = new Set([
  "stock",
  "costo_unitario_soles",
  "costo_unitario_dolares",
  "costo_total_soles",
  "costo_total_dolares",
] as const);

type NumericField = typeof NUMERIC_FIELDS extends Set<infer T> ? T : never;

const HEADER_TO_FIELD: Record<string, keyof RepuestoRow> = {
  LOCAL: "local",
  SEDE: "local",
  ALMACEN: "local",
  CODIGO: "codigo",
  REPUESTO: "repuesto",
  UBICACION: "ubicacion",
  STOCK: "stock",
  "ULTIMO INGRESO": "ultimo_ingreso",
  "ULTIMO EGRESO": "ultimo_egreso",
  MARCA: "marca",
  CATEGORIA: "categoria",
  "APLICACION MODELOS": "aplicacion_modelos",
  "COSTO UNITARIO SOLES": "costo_unitario_soles",
  "COSTO UNITARIO DOLARES": "costo_unitario_dolares",
  "COSTO TOTAL SOLES": "costo_total_soles",
  "COSTO TOTAL DOLARES": "costo_total_dolares",
  CLASIFICACION: "clasificacion",
  OBSOLESCENCIA: "obsolescencia",
};

const HEADER_ALIASES: Record<string, keyof RepuestoRow> = {
  LOCAL: "local",
  SEDE: "local",
  ALMACEN: "local",
  "ALMACEN LOCAL": "local",
  UBICACION: "ubicacion",
  "UBI CACION": "ubicacion",
  UBICACIONACION: "ubicacion",
  LOCATION: "ubicacion",
  POSICION: "ubicacion",
  "POSICION FISICA": "ubicacion",
};

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function resolveField(header: unknown): keyof RepuestoRow | undefined {
  const normalized = normalizeHeader(header);
  if (!normalized) return undefined;

  const direct = HEADER_TO_FIELD[normalized] ?? HEADER_ALIASES[normalized];
  if (direct) return direct;

  const compact = normalized.replace(/\s+/g, "");
  if (HEADER_TO_FIELD[compact] ?? HEADER_ALIASES[compact]) {
    return HEADER_TO_FIELD[compact] ?? HEADER_ALIASES[compact];
  }

  for (const [key, field] of Object.entries(HEADER_TO_FIELD)) {
    if (key.replace(/\s+/g, "") === compact) return field;
  }
  for (const [key, field] of Object.entries(HEADER_ALIASES)) {
    if (key.replace(/\s+/g, "") === compact) return field;
  }

  // Fuzzy fallbacks for LOCAL / UBICACIÓN variants
  if (
    compact === "SEDE" ||
    compact === "ALMACEN" ||
    compact.includes("LOCAL")
  ) {
    return "local";
  }
  if (
    compact.includes("UBICACION") ||
    compact.includes("UBIC") ||
    compact === "LOCATION" ||
    compact.includes("POSICION")
  ) {
    return "ubicacion";
  }

  return undefined;
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

function safeToNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const cleaned = String(value)
    .trim()
    .replace(/^S\/\s*/i, "")
    .replace(/^\$\s*/, "")
    .replace(/,/g, "")
    .replace(/\s/g, "");

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    // Excel serial dates sometimes land in text fields; keep as stringified number
    return String(value);
  }

  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function findHeaderRow(sheet: XLSX.WorkSheet): number {
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");

  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 30); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (normalizeHeader(getCellValue(sheet, r, c)) === "CODIGO") {
        return r;
      }
    }
  }

  throw new Error("No se encontró fila de encabezados con CODIGO");
}

type ColumnMapState = {
  /** Primary column per field (first match wins for most fields). */
  primary: Partial<Record<keyof RepuestoRow, number>>;
  /** All columns that can feed local / ubicacion (for per-row fallbacks). */
  localCols: number[];
  ubicacionCols: number[];
  /** col index → field for non-fallback fields */
  simple: Record<number, keyof RepuestoRow>;
};

function buildColumnMap(
  sheet: XLSX.WorkSheet,
  headerRow: number
): ColumnMapState {
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  const state: ColumnMapState = {
    primary: {},
    localCols: [],
    ubicacionCols: [],
    simple: {},
  };

  for (let c = range.s.c; c <= range.e.c; c++) {
    const raw = getCellValue(sheet, headerRow, c);
    const field = resolveField(raw);
    if (!field) continue;

    if (field === "local") {
      state.localCols.push(c);
      if (state.primary.local === undefined) state.primary.local = c;
      continue;
    }

    if (field === "ubicacion") {
      state.ubicacionCols.push(c);
      if (state.primary.ubicacion === undefined) state.primary.ubicacion = c;
      continue;
    }

    // Prefer exact LOCAL/UBICACION names over fuzzy for primary map display;
    // for other fields, first match wins.
    if (state.primary[field] === undefined) {
      state.primary[field] = c;
      state.simple[c] = field;
    }
  }

  if (state.primary.codigo === undefined) {
    throw new Error("No se encontró columna CODIGO en la fila de encabezados");
  }

  return state;
}

function createEmptyRow(lastSyncAt: string): RepuestoRow {
  return {
    codigo: "",
    local: null,
    repuesto: null,
    ubicacion: null,
    stock: 0,
    ultimo_ingreso: null,
    ultimo_egreso: null,
    marca: null,
    categoria: null,
    aplicacion_modelos: null,
    costo_unitario_soles: 0,
    costo_unitario_dolares: 0,
    costo_total_soles: 0,
    costo_total_dolares: 0,
    clasificacion: null,
    obsolescencia: null,
    last_sync_at: lastSyncAt,
  };
}

function firstNonEmpty(
  sheet: XLSX.WorkSheet,
  row: number,
  cols: number[]
): string | null {
  for (const col of cols) {
    const cleaned = cleanString(getCellValue(sheet, row, col));
    if (cleaned) return cleaned;
  }
  return null;
}

function parseRow(
  sheet: XLSX.WorkSheet,
  row: number,
  columnMap: ColumnMapState,
  lastSyncAt: string
): RepuestoRow | null {
  const record = createEmptyRow(lastSyncAt);

  for (const [col, field] of Object.entries(columnMap.simple)) {
    const value = getCellValue(sheet, row, Number(col));

    if (field === "codigo") {
      record.codigo = cleanString(value) ?? "";
      continue;
    }

    if (NUMERIC_FIELDS.has(field as NumericField)) {
      record[field as NumericField] = safeToNumber(value);
      continue;
    }

    record[field as Exclude<keyof RepuestoRow, NumericField | "codigo" | "last_sync_at">] =
      cleanString(value);
  }

  record.local = firstNonEmpty(sheet, row, columnMap.localCols);
  record.ubicacion = firstNonEmpty(sheet, row, columnMap.ubicacionCols);

  if (!record.codigo) return null;

  return record;
}

function logParseDiagnostics(
  sheet: XLSX.WorkSheet,
  headerRow: number,
  columnMap: ColumnMapState,
  rows: RepuestoRow[]
): ParseXlsxDiagnostics {
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  const headersRaw: string[] = [];
  const headersNormalized: string[] = [];

  for (let c = range.s.c; c <= Math.min(range.e.c, range.s.c + 19); c++) {
    const raw = getCellValue(sheet, headerRow, c);
    headersRaw.push(raw == null ? "" : String(raw));
    headersNormalized.push(normalizeHeader(raw));
  }

  // Also collect any remaining headers beyond 20 for the map, but log only 20
  const allHeadersRaw: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const raw = getCellValue(sheet, headerRow, c);
    allHeadersRaw.push(raw == null ? "" : String(raw));
  }

  const columnMapLogged: Record<string, string> = {};
  for (const [field, col] of Object.entries(columnMap.primary)) {
    if (col !== undefined) {
      columnMapLogged[field] = `${XLSX.utils.encode_col(col)} (${allHeadersRaw[col] ?? ""})`;
    }
  }

  const firstDataRowIndex = headerRow + 1;
  let firstRowSample: Record<string, unknown> | null = null;
  if (firstDataRowIndex <= range.e.r) {
    firstRowSample = {};
    for (let c = range.s.c; c <= Math.min(range.e.c, range.s.c + 19); c++) {
      const header = allHeadersRaw[c] || `COL_${c}`;
      firstRowSample[header] = getCellValue(sheet, firstDataRowIndex, c) ?? null;
    }
  }

  const localNonEmpty = rows.filter((r) => r.local).length;
  const ubicacionNonEmpty = rows.filter((r) => r.ubicacion).length;

  const diagnostics: ParseXlsxDiagnostics = {
    headerRow,
    headersRaw,
    headersNormalized,
    columnMap: columnMapLogged,
    localColumns: columnMap.localCols,
    ubicacionColumns: columnMap.ubicacionCols,
    firstRowSample,
    localNonEmpty,
    ubicacionNonEmpty,
    totalRows: rows.length,
  };

  console.log("[parse-xlsx] primeros 20 encabezados raw:", diagnostics.headersRaw);
  console.log(
    "[parse-xlsx] primeros 20 encabezados normalizados:",
    diagnostics.headersNormalized
  );
  console.log("[parse-xlsx] columnMap:", diagnostics.columnMap);
  console.log("[parse-xlsx] localCols:", diagnostics.localColumns);
  console.log("[parse-xlsx] ubicacionCols:", diagnostics.ubicacionColumns);
  console.log("[parse-xlsx] primera fila de datos:", diagnostics.firstRowSample);
  console.log(
    `[parse-xlsx] filas con local=${diagnostics.localNonEmpty}/${diagnostics.totalRows}, ubicacion=${diagnostics.ubicacionNonEmpty}/${diagnostics.totalRows}`
  );

  return diagnostics;
}

export function hasLocalAndUbicacionData(rows: RepuestoRow[]): boolean {
  const hasLocal = rows.some((r) => Boolean(r.local));
  const hasUbicacion = rows.some((r) => Boolean(r.ubicacion));
  return hasLocal && hasUbicacion;
}

function parseSheet(sheet: XLSX.WorkSheet): {
  rows: RepuestoRow[];
  diagnostics: ParseXlsxDiagnostics;
} {
  const lastSyncAt = new Date().toISOString();
  const headerRow = findHeaderRow(sheet);
  const columnMap = buildColumnMap(sheet, headerRow);
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  const rows: RepuestoRow[] = [];

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const row = parseRow(sheet, r, columnMap, lastSyncAt);
    if (row) rows.push(row);
  }

  const diagnostics = logParseDiagnostics(sheet, headerRow, columnMap, rows);
  return { rows, diagnostics };
}

export async function parseXlsxFromUrl(fileUrl: string): Promise<{
  rows: RepuestoRow[];
  diagnostics: ParseXlsxDiagnostics;
}> {
  const res = await fetch(fileUrl);
  if (!res.ok) {
    throw new Error(`Failed to download xlsx: ${res.status}`);
  }

  const buffer = await res.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error("Empty workbook");
  }

  return parseSheet(sheet);
}
