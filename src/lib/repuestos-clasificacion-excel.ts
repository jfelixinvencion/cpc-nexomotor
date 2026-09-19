import * as XLSX from "xlsx";
import type { ImportFilaRaw } from "@/lib/repuestos-clasificacion";

function normalizeHeaderKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function headerField(
  key: string
): keyof ImportFilaRaw | null {
  if (key === "codigo") return "codigo";
  if (key === "tipo sku" || key === "tiposku") return "tipo_sku";
  if (key === "categoria") return "categoria";
  if (key === "sub categoria" || key === "subcategoria") return "sub_categoria";
  if (key === "obsolescencia") return "obsolescencia";
  return null;
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return String(value).trim();
}

export function parseClasificacionExcel(
  buffer: ArrayBuffer
): { filas: ImportFilaRaw[] } | { error: string } {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { error: "El Excel no tiene hojas." };
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  if (matrix.length < 2) {
    return { error: "El Excel no tiene filas de datos." };
  }

  const headerRow = Array.isArray(matrix[0]) ? matrix[0] : [];
  const index: Partial<Record<keyof ImportFilaRaw, number>> = {};
  headerRow.forEach((cell, col) => {
    const field = headerField(normalizeHeaderKey(cell));
    if (field && index[field] == null) index[field] = col;
  });

  if (index.codigo == null) {
    return { error: "No se encontró la columna CODIGO." };
  }

  const filas: ImportFilaRaw[] = [];
  for (let r = 1; r < matrix.length; r += 1) {
    const line = Array.isArray(matrix[r]) ? matrix[r] : [];
    filas.push({
      codigo: cellText(line[index.codigo]),
      tipo_sku:
        index.tipo_sku == null ? "" : cellText(line[index.tipo_sku]),
      categoria:
        index.categoria == null ? "" : cellText(line[index.categoria]),
      sub_categoria:
        index.sub_categoria == null ? "" : cellText(line[index.sub_categoria]),
      obsolescencia:
        index.obsolescencia == null
          ? ""
          : cellText(line[index.obsolescencia]),
    });
  }

  return { filas };
}
