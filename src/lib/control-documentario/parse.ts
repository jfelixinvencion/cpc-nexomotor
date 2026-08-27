import {
  RAZONES_SOCIALES_DELIVERY,
  TEXTO_SIN_OC,
  TIPOS_DOCUMENTO,
  TIPOS_PAGO,
  UUID_RE,
  YMD_RE,
} from "./constants";

export type LineaParsed = {
  sigma_id: number;
  numero_oc: string;
  linea_orden: number;
  codigo_repuesto: string;
  descripcion_repuesto: string | null;
  cantidad: number | null;
  precio_total_con_igv_soles: number | null;
};

export type DocumentoParsed = {
  es_delivery: boolean;
  numero_oc: string | null;
  tipo_pago: string;
  empresa: string;
  autoriza: string;
  fecha_emision: string;
  tipo_documento: string;
  numero_documento: string | null;
  ruc: string | null;
  razon_social: string | null;
  placa: string | null;
  descripcion: string | null;
  valor_con_igv: number;
  valor_sin_igv: number;
  observaciones: string | null;
  items: LineaParsed[];
};

export type ParseResult =
  | { ok: true; data: DocumentoParsed }
  | { ok: false; error: string };

export function isUuid(value: string) {
  return UUID_RE.test(value);
}

export function isYmd(value: string) {
  if (!YMD_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return (
    date.getFullYear() === y &&
    date.getMonth() === m - 1 &&
    date.getDate() === d
  );
}

export function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function asTrimmed(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

export function nullableText(value: unknown): string | null {
  const t = asTrimmed(value);
  return t === "" ? null : t;
}

export function parseMoney(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return round2(n);
}

export function parseOptionalNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function isTipoPago(value: string): value is (typeof TIPOS_PAGO)[number] {
  return (TIPOS_PAGO as readonly string[]).includes(value);
}

function isTipoDocumento(
  value: string
): value is (typeof TIPOS_DOCUMENTO)[number] {
  return (TIPOS_DOCUMENTO as readonly string[]).includes(value);
}

function isRazonDelivery(
  value: string
): value is (typeof RAZONES_SOCIALES_DELIVERY)[number] {
  return (RAZONES_SOCIALES_DELIVERY as readonly string[]).includes(value);
}

function parseItems(
  raw: unknown,
  headerOc: string
): { ok: true; items: LineaParsed[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "Debe seleccionar al menos una línea de compra." };
  }

  const items: LineaParsed[] = [];
  const seen = new Set<string>();

  for (const row of raw) {
    if (!row || typeof row !== "object") {
      return { ok: false, error: "Hay líneas de compra con formato inválido." };
    }
    const r = row as Record<string, unknown>;
    const sigma_id = Number(r.sigma_id);
    const linea_orden = Number(r.linea_orden);
    const numero_oc = asTrimmed(r.numero_oc);
    const codigo_repuesto = asTrimmed(r.codigo_repuesto);

    if (!Number.isInteger(sigma_id) || sigma_id <= 0) {
      return { ok: false, error: "sigma_id inválido en una de las líneas." };
    }
    if (!Number.isInteger(linea_orden) || linea_orden < 1) {
      return { ok: false, error: "linea_orden inválida en una de las líneas." };
    }
    if (!numero_oc) {
      return { ok: false, error: "numero_oc es obligatorio en cada línea." };
    }
    if (numero_oc !== headerOc) {
      return {
        ok: false,
        error: "Todas las líneas deben pertenecer a la misma OC del documento.",
      };
    }
    if (!codigo_repuesto) {
      return { ok: false, error: "codigo_repuesto es obligatorio en cada línea." };
    }

    const key = `${sigma_id}:${linea_orden}`;
    if (seen.has(key)) {
      return {
        ok: false,
        error: "Hay líneas duplicadas en la solicitud (sigma_id + linea_orden).",
      };
    }
    seen.add(key);

    const cantidadRaw = parseOptionalNumber(r.cantidad);
    const precioRaw = parseOptionalNumber(r.precio_total_con_igv_soles);

    items.push({
      sigma_id,
      numero_oc,
      linea_orden,
      codigo_repuesto,
      descripcion_repuesto: nullableText(r.descripcion_repuesto),
      cantidad: cantidadRaw == null ? null : round2(cantidadRaw),
      precio_total_con_igv_soles: precioRaw == null || precioRaw < 0 ? null : round2(precioRaw),
    });
  }

  return { ok: true, items };
}

export function parseDocumentoPayload(body: unknown): ParseResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Solicitud inválida." };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.es_delivery !== "boolean") {
    return { ok: false, error: "es_delivery debe ser verdadero o falso." };
  }
  const es_delivery = b.es_delivery;

  const tipo_pago = asTrimmed(b.tipo_pago);
  if (!isTipoPago(tipo_pago)) {
    return {
      ok: false,
      error: "tipo_pago debe ser Caja Chica, Programado u Otros.",
    };
  }

  const tipo_documento = asTrimmed(b.tipo_documento);
  if (!isTipoDocumento(tipo_documento)) {
    return {
      ok: false,
      error: "tipo_documento debe ser Factura, Boleta u Otros.",
    };
  }

  const empresa = asTrimmed(b.empresa);
  const autoriza = asTrimmed(b.autoriza);
  if (!empresa) return { ok: false, error: "empresa es obligatorio." };
  if (!autoriza) return { ok: false, error: "autoriza es obligatorio." };

  const fecha_emision = asTrimmed(b.fecha_emision);
  if (!isYmd(fecha_emision)) {
    return { ok: false, error: "fecha_emision debe tener formato YYYY-MM-DD." };
  }

  const valor_con_igv = parseMoney(b.valor_con_igv);
  if (valor_con_igv == null) {
    return {
      ok: false,
      error: "valor_con_igv debe ser un número finito mayor o igual a 0.",
    };
  }
  const valor_sin_igv = round2(valor_con_igv / 1.18);

  const numero_documento = nullableText(b.numero_documento);
  const placa = nullableText(b.placa);
  const observaciones = nullableText(b.observaciones);

  if (es_delivery) {
    const numero_oc_raw = asTrimmed(b.numero_oc);
    if (!numero_oc_raw) {
      return {
        ok: false,
        error: "En modo Delivery, numero_oc es obligatorio o debe ser exactamente “Sin OC”.",
      };
    }
    const razon_social = asTrimmed(b.razon_social);
    if (!isRazonDelivery(razon_social)) {
      return {
        ok: false,
        error: "En modo Delivery, razon_social solo puede ser INDRIVE u OTRO.",
      };
    }
    const descripcion = asTrimmed(b.descripcion);
    if (!descripcion) {
      return { ok: false, error: "En modo Delivery, descripcion es obligatorio." };
    }
    if (Array.isArray(b.items) && b.items.length > 0) {
      return {
        ok: false,
        error: "El modo Delivery no admite líneas de compra asociadas.",
      };
    }

    return {
      ok: true,
      data: {
        es_delivery: true,
        numero_oc: numero_oc_raw,
        tipo_pago,
        empresa,
        autoriza,
        fecha_emision,
        tipo_documento,
        numero_documento,
        ruc: null,
        razon_social,
        placa,
        descripcion,
        valor_con_igv,
        valor_sin_igv,
        observaciones,
        items: [],
      },
    };
  }

  const numero_oc = asTrimmed(b.numero_oc);
  if (!numero_oc) {
    return { ok: false, error: "numero_oc es obligatorio." };
  }
  const ruc = asTrimmed(b.ruc);
  const razon_social = asTrimmed(b.razon_social);
  if (!ruc) return { ok: false, error: "ruc es obligatorio." };
  if (!razon_social) return { ok: false, error: "razon_social es obligatorio." };

  const itemsResult = parseItems(b.items, numero_oc);
  if (!itemsResult.ok) return itemsResult;

  return {
    ok: true,
    data: {
      es_delivery: false,
      numero_oc,
      tipo_pago,
      empresa,
      autoriza,
      fecha_emision,
      tipo_documento,
      numero_documento,
      ruc,
      razon_social,
      placa,
      descripcion: null,
      valor_con_igv,
      valor_sin_igv,
      observaciones,
      items: itemsResult.items,
    },
  };
}

export function resumenDescripcionItems(items: LineaParsed[]): string {
  return items
    .map((item) => {
      const desc = item.descripcion_repuesto?.trim() || "-";
      const cant = item.cantidad == null ? "-" : String(item.cantidad);
      return `${item.codigo_repuesto} | ${desc} | ${cant}`;
    })
    .join("; ");
}

export { TEXTO_SIN_OC };
