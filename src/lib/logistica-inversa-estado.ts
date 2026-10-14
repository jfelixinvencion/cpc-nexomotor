/**
 * Estados de public.logistica_inversa.estado_repuesto.
 * Canónico de almacenamiento: MAYÚSCULAS, sin tildes (convención actual).
 * Lectura: acepta alias antiguos y nuevos. Escritura y pantalla: nombres nuevos.
 */

export const ESTADO_REPUESTO_CANONICOS = [
  "AVERIADO",
  "NO RETORNABLE",
  "NO DEVUELTO",
] as const;

export type EstadoRepuestoCanonico =
  (typeof ESTADO_REPUESTO_CANONICOS)[number];

/** Alias normalizado (trim + mayúsculas + sin tildes) → valor canónico a persistir. */
const ESTADO_REPUESTO_ALIAS: Record<string, EstadoRepuestoCanonico> = {
  AVERIADO: "AVERIADO",
  CONSUMIBLE: "NO RETORNABLE",
  "NO RETORNABLE": "NO RETORNABLE",
  "SIN DEVOLUCION": "NO DEVUELTO",
  "NO DEVUELTO": "NO DEVUELTO",
};

export const ESTADO_REPUESTO_DISPLAY: Record<EstadoRepuestoCanonico, string> =
  {
    AVERIADO: "Averiado",
    "NO RETORNABLE": "No retornable",
    "NO DEVUELTO": "No devuelto",
  };

export const ESTADO_REPUESTO_FORM_OPTIONS = ESTADO_REPUESTO_CANONICOS.map(
  (value) => ESTADO_REPUESTO_DISPLAY[value]
);

export function normalizeEstadoKey(value: unknown): string {
  if (value == null) return "";
  const text = String(value).trim();
  if (text === "") return "";
  return text
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function canonicalizeEstadoRepuesto(
  value: unknown
): EstadoRepuestoCanonico | null {
  const key = normalizeEstadoKey(value);
  if (!key) return null;
  return ESTADO_REPUESTO_ALIAS[key] ?? null;
}

/** Valor a guardar en estado_repuesto. Vacío → null. Alias → canónico. Otro texto → trim. */
export function estadoRepuestoParaGuardar(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (trimmed === "") return null;
  return canonicalizeEstadoRepuesto(trimmed) ?? trimmed;
}

export function displayEstadoRepuesto(value: unknown): string {
  if (value == null) return "";
  const trimmed = String(value).trim();
  if (trimmed === "") return "";
  const canon = canonicalizeEstadoRepuesto(trimmed);
  return canon ? ESTADO_REPUESTO_DISPLAY[canon] : trimmed;
}

export function estadoRepuestoFilterKey(value: unknown): string {
  const canon = canonicalizeEstadoRepuesto(value);
  if (canon) return canon;
  return normalizeEstadoKey(value);
}

export function uniqueEstadoRepuestoFilterOptions(
  values: (string | null | undefined)[]
): Array<{ value: string; label: string }> {
  const seen = new Set<string>();
  const out: Array<{ value: string; label: string }> = [];
  for (const raw of values) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    const value = estadoRepuestoFilterKey(trimmed);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push({
      value,
      label: displayEstadoRepuesto(trimmed) || trimmed,
    });
  }
  return out.sort((a, b) =>
    a.label.localeCompare(b.label, "es", { sensitivity: "base" })
  );
}

export function estadoRepuestoDatalistOptions(
  values: (string | null | undefined)[]
): string[] {
  const extras: string[] = [];
  const seenExtra = new Set<string>();
  for (const raw of values) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    if (canonicalizeEstadoRepuesto(trimmed)) continue;
    const key = trimmed.toLowerCase();
    if (seenExtra.has(key)) continue;
    seenExtra.add(key);
    extras.push(trimmed);
  }
  extras.sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
  return [...ESTADO_REPUESTO_FORM_OPTIONS, ...extras];
}
