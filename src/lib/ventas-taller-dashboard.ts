import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  DASHBOARD_MODES,
  DATE_FIELDS,
  MIN_FECHA,
  STATUS_VIEWS,
  TIPOS_LINEA,
  TIPOS_OT_VALIDOS,
  todayYmd,
  type DashboardMode,
  type DashboardOtRow,
  type DateField,
  type MoneyByKey,
  type OtAgg,
  type OtAnomalia,
  type OpenPortfolioBucket,
  type StatusView,
  type TipoLinea,
  type TipoOtValido,
  type VentasTallerDashLine,
  type VentasTallerDashboardCards,
  type VentasTallerDashboardQuery,
  type VentasTallerDashboardResponse,
  type VentasTallerTrendMonth,
} from "@/lib/ventas-taller-dashboard-shared";

export {
  DASHBOARD_MODES,
  DATE_FIELDS,
  MIN_FECHA,
  STATUS_VIEWS,
  TIPOS_LINEA,
  TIPOS_OT_VALIDOS,
  todayYmd,
} from "@/lib/ventas-taller-dashboard-shared";
export type {
  DashboardMode,
  DashboardOtRow,
  DateField,
  MoneyByKey,
  OtAgg,
  OtAnomalia,
  OpenPortfolioBucket,
  StatusView,
  TipoLinea,
  TipoOtValido,
  VentasTallerDashLine,
  VentasTallerDashboardCards,
  VentasTallerDashboardQuery,
  VentasTallerDashboardResponse,
  VentasTallerTrendMonth,
} from "@/lib/ventas-taller-dashboard-shared";

export const DASHBOARD_PAGE_SIZE = 1000;
export const DASHBOARD_ROW_CAP = 20000;
export const MARGEN_EPSILON = 0.0001;

export const DASHBOARD_COLUMNS = [
  "ot",
  "tipo_ot",
  "estado",
  "marca",
  "placa",
  "tipo",
  "cliente",
  "fecha_ingreso",
  "fecha_facturacion",
  "precio_total_soles",
  "costo_total_soles",
  "margen_total_soles",
] as const;

/** Clientes ST abiertos cuyo costo estimado es venta / 1.05. */
export const ST_ABIERTO_CLIENTES_DIVISOR_105 = [
  "LISTO TAXI S.A.C.",
  "TRANSPORTES CARRARA S.A.C.",
] as const;

type DashboardSourceLine = VentasTallerDashLine & { cliente: string | null };

function normalizeClienteNombre(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleUpperCase("es-PE");
}

/**
 * En Excel/sync, las líneas ST de una OT ABIERTA llegan con
 * costo_total_soles = 0 porque el origen aún no factura y no calculó
 * el costo real. Eso infla el margen mientras la OT está abierta.
 *
 * Esta corrección es solo en memoria para tarjetas/gráficos del dashboard
 * (monthly y trend). No se escribe en public.ventas_taller ni afecta
 * /api/logistica/ventas-taller. FACTURADO y tipos distintos de ST
 * conservan costo y margen originales.
 */
export function correctOpenStLineMoney(line: {
  tipo: string | null;
  estado: string | null;
  cliente?: string | null;
  precio_total_soles: number;
  costo_total_soles: number;
  margen_total_soles: number;
}) {
  const tipo = (line.tipo ?? "").trim();
  const estado = (line.estado ?? "").trim().toLocaleUpperCase("es-PE");
  if (tipo !== "ST" || estado !== "ABIERTO") {
    return {
      costo: line.costo_total_soles,
      margen: line.margen_total_soles,
    };
  }

  const precio = line.precio_total_soles;
  if (precio === 0) {
    return { costo: 0, margen: 0 };
  }

  const cliente = normalizeClienteNombre(line.cliente);
  const divisor = (ST_ABIERTO_CLIENTES_DIVISOR_105 as readonly string[]).includes(
    cliente
  )
    ? 1.05
    : 1.1;
  const costo = precio / divisor;
  return { costo, margen: precio - costo };
}

const TIPOS_OT_SET = new Set<string>(TIPOS_OT_VALIDOS);
const DATE_FIELD_SET = new Set<string>(DATE_FIELDS);
const STATUS_VIEW_SET = new Set<string>(STATUS_VIEWS);
const MODE_SET = new Set<string>(DASHBOARD_MODES);
const TIPO_LINEA_SET = new Set<string>(TIPOS_LINEA);

const OPEN_BUCKETS = [
  { bucket: "0-7", min: 0, max: 7 },
  { bucket: "8-15", min: 8, max: 15 },
  { bucket: "16-30", min: 16, max: 30 },
  { bucket: "31-60", min: 31, max: 60 },
  { bucket: "61-90", min: 61, max: 90 },
  { bucket: "90+", min: 91, max: Infinity },
] as const;

export function toFiniteNumber(value: number | string | null | undefined) {
  if (value == null || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function roundPct(value: number) {
  return Math.round(value * 100) / 100;
}

export function round4(value: number) {
  return Math.round(value * 10000) / 10000;
}

export function isYmd(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function isYearMonth(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  const [y, m] = value.split("-").map(Number);
  return m >= 1 && m <= 12 && y >= 2000 && y <= 2100;
}

export function monthStart(ym: string) {
  return `${ym}-01`;
}

export function monthEnd(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0));
  return last.toISOString().slice(0, 10);
}

export function addMonths(ymd: string, delta: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0));
  const day = Math.min(d, last.getUTCDate());
  const out = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), day));
  return out.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((b - a) / 86_400_000);
}

export function monthsInRange(from: string, to: string) {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function estadosDeVista(view: StatusView): string[] {
  if (view === "total_operativo") return ["FACTURADO", "ABIERTO"];
  if (view === "facturado") return ["FACTURADO"];
  if (view === "abierto") return ["ABIERTO"];
  return ["ANULADO"];
}

function parseCsv(raw: string | null) {
  if (raw == null || raw.trim() === "") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function defaultTrendFrom(today: string) {
  const sixAgo = addMonths(today, -6);
  return sixAgo > MIN_FECHA ? sixAgo : MIN_FECHA;
}

export function parseDashboardQuery(
  sp: URLSearchParams,
  now = new Date()
): { ok: true; query: VentasTallerDashboardQuery } | { ok: false; error: string } {
  const today = todayYmd(now);
  const modeRaw = (sp.get("mode") ?? "monthly").trim();
  if (!MODE_SET.has(modeRaw)) {
    return { ok: false, error: "mode inválido. Use monthly o trend." };
  }
  const mode = modeRaw as DashboardMode;

  const dateFieldRaw = (sp.get("date_field") ?? "fecha_ingreso").trim();
  if (!DATE_FIELD_SET.has(dateFieldRaw)) {
    return {
      ok: false,
      error: "date_field inválido. Use fecha_ingreso o fecha_facturacion.",
    };
  }
  const date_field = dateFieldRaw as DateField;

  const statusRaw = (sp.get("status_view") ?? "total_operativo").trim();
  if (!STATUS_VIEW_SET.has(statusRaw)) {
    return {
      ok: false,
      error:
        "status_view inválido. Use total_operativo, facturado, abierto o anulado.",
    };
  }
  const status_view = statusRaw as StatusView;

  const tipoOtRaw = parseCsv(sp.get("tipo_ot"));
  if (tipoOtRaw.some((value) => !TIPOS_OT_SET.has(value))) {
    return {
      ok: false,
      error:
        "tipo_ot inválido. Solo se aceptan Preventivo, Correctivo y Siniestro.",
    };
  }
  const tipo_ot = (
    tipoOtRaw.length > 0 ? tipoOtRaw : [...TIPOS_OT_VALIDOS]
  ) as TipoOtValido[];

  const tipos = parseCsv(sp.get("tipos"));
  const marca = parseCsv(sp.get("marca"));

  const fromRaw = (sp.get("from") ?? "").trim();
  const toRaw = (sp.get("to") ?? "").trim();
  if (fromRaw && !isYmd(fromRaw)) {
    return { ok: false, error: "from debe tener formato YYYY-MM-DD." };
  }
  if (toRaw && !isYmd(toRaw)) {
    return { ok: false, error: "to debe tener formato YYYY-MM-DD." };
  }

  if (mode === "monthly") {
    const month = (sp.get("month") ?? "").trim();
    if (!isYearMonth(month)) {
      return {
        ok: false,
        error: "month es obligatorio en modo monthly (YYYY-MM).",
      };
    }
    if (month < MIN_FECHA.slice(0, 7)) {
      return {
        ok: false,
        error: `El mes no puede ser anterior a ${MIN_FECHA.slice(0, 7)}.`,
      };
    }
    const start = monthStart(month);
    const end = monthEnd(month);
    const from = fromRaw || start;
    const to = toRaw || end;
    if (from.slice(0, 7) !== month || to.slice(0, 7) !== month) {
      return {
        ok: false,
        error: "from y to deben pertenecer al mismo mes indicado en month.",
      };
    }
    if (from > to) {
      return { ok: false, error: "from no puede ser mayor que to." };
    }
    if (to < MIN_FECHA) {
      return {
        ok: false,
        error: `El rango no puede terminar antes de ${MIN_FECHA}.`,
      };
    }
    return {
      ok: true,
      query: {
        mode,
        date_field,
        status_view,
        month,
        from: from < MIN_FECHA ? MIN_FECHA : from,
        to,
        tipo_ot,
        tipos,
        marca,
      },
    };
  }

  let from = fromRaw || defaultTrendFrom(today);
  const to = toRaw || today;
  if (from > to) {
    return { ok: false, error: "from no puede ser mayor que to." };
  }
  if (to < MIN_FECHA) {
    return {
      ok: false,
      error: `El rango no puede terminar antes de ${MIN_FECHA}.`,
    };
  }
  if (from < MIN_FECHA) from = MIN_FECHA;

  return {
    ok: true,
    query: {
      mode,
      date_field,
      status_view,
      month: null,
      from,
      to,
      tipo_ot,
      tipos,
      marca,
    },
  };
}

function emptyTipoMap() {
  return {
    "MO - MEC": { venta: 0, costo: 0, margen_db: 0 },
    REP: { venta: 0, costo: 0, margen_db: 0 },
    ST: { venta: 0, costo: 0, margen_db: 0 },
  } satisfies OtAgg["by_tipo"];
}

function pickHeader(values: Array<string | null>) {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = raw?.trim() ?? "";
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const unique = Array.from(counts.keys()).sort((a, b) => a.localeCompare(b, "es"));
  let best: string | null = null;
  let bestN = 0;
  for (const value of unique) {
    const n = counts.get(value) ?? 0;
    if (n > bestN) {
      best = value;
      bestN = n;
    }
  }
  return { value: best, unique };
}

function pickDate(values: Array<string | null>) {
  const unique = Array.from(
    new Set(values.map((v) => (v ?? "").trim()).filter((v) => isYmd(v)))
  ).sort();
  return { value: unique[0] ?? null, unique };
}

export function groupLinesByOt(
  lines: Array<VentasTallerDashLine & { cliente?: string | null }>
): {
  ots: OtAgg[];
  anomalias: OtAnomalia[];
} {
  const buckets = new Map<
    string,
    Array<VentasTallerDashLine & { cliente?: string | null }>
  >();
  for (const line of lines) {
    if (!line.ot) continue;
    const list = buckets.get(line.ot) ?? [];
    list.push(line);
    buckets.set(line.ot, list);
  }

  const ots: OtAgg[] = [];
  const anomalias: OtAnomalia[] = [];

  for (const [ot, group] of buckets) {
    const tipoOtH = pickHeader(group.map((r) => r.tipo_ot));
    const estadoH = pickHeader(group.map((r) => r.estado));
    const marcaH = pickHeader(group.map((r) => r.marca));
    const placaH = pickHeader(group.map((r) => r.placa));
    const clienteH = pickHeader(group.map((r) => r.cliente ?? null));
    const ingresoH = pickDate(group.map((r) => r.fecha_ingreso));
    const factH = pickDate(group.map((r) => r.fecha_facturacion));

    const campos: string[] = [];
    const valores: Record<string, string[]> = {};
    if (tipoOtH.unique.length > 1) {
      campos.push("tipo_ot");
      valores.tipo_ot = tipoOtH.unique;
    }
    if (estadoH.unique.length > 1) {
      campos.push("estado");
      valores.estado = estadoH.unique;
    }
    if (marcaH.unique.length > 1) {
      campos.push("marca");
      valores.marca = marcaH.unique;
    }
    if (ingresoH.unique.length > 1) {
      campos.push("fecha_ingreso");
      valores.fecha_ingreso = ingresoH.unique;
    }
    if (factH.unique.length > 1) {
      campos.push("fecha_facturacion");
      valores.fecha_facturacion = factH.unique;
    }
    if (campos.length > 0) anomalias.push({ ot, campos, valores });

    const tipoOt =
      tipoOtH.value && TIPOS_OT_SET.has(tipoOtH.value)
        ? (tipoOtH.value as TipoOtValido)
        : null;

    const agg: OtAgg = {
      ot,
      tipo_ot: tipoOt,
      estado: estadoH.value,
      marca: marcaH.value,
      placa: placaH.value,
      fecha_ingreso: ingresoH.value,
      fecha_facturacion: factH.value,
      fecha: null,
      lineas: group.length,
      venta: 0,
      costo: 0,
      margen_db: 0,
      margen_calc: 0,
      by_tipo: emptyTipoMap(),
    };

    for (const line of group) {
      const corrected = correctOpenStLineMoney({
        tipo: line.tipo,
        estado: estadoH.value,
        cliente: line.cliente ?? clienteH.value,
        precio_total_soles: line.precio_total_soles,
        costo_total_soles: line.costo_total_soles,
        margen_total_soles: line.margen_total_soles,
      });
      agg.venta += line.precio_total_soles;
      agg.costo += corrected.costo;
      agg.margen_db += corrected.margen;
      if (line.tipo && TIPO_LINEA_SET.has(line.tipo)) {
        const tipo = line.tipo as TipoLinea;
        agg.by_tipo[tipo].venta += line.precio_total_soles;
        agg.by_tipo[tipo].costo += corrected.costo;
        agg.by_tipo[tipo].margen_db += corrected.margen;
      }
    }
    agg.margen_calc = agg.venta - agg.costo;
    ots.push(agg);
  }

  return { ots, anomalias };
}

function moneyRow(key: string, ots: OtAgg[]): MoneyByKey {
  let venta = 0;
  let costo = 0;
  let margen = 0;
  for (const ot of ots) {
    venta += ot.venta;
    costo += ot.costo;
    margen += ot.margen_db;
  }
  return {
    key,
    ots: ots.length,
    venta,
    costo,
    margen,
    margen_porcentaje: venta > 0 ? (margen / venta) * 100 : 0,
  };
}

function assignFecha(ot: OtAgg, dateField: DateField) {
  ot.fecha = dateField === "fecha_facturacion" ? ot.fecha_facturacion : ot.fecha_ingreso;
  return ot.fecha;
}

function inRange(fecha: string | null, from: string, to: string) {
  return fecha != null && fecha >= from && fecha <= to;
}

export function buildCards(ots: OtAgg[]): VentasTallerDashboardCards {
  let venta = 0;
  let costo = 0;
  let margen = 0;
  let facturadas = 0;
  let abiertas = 0;
  let anuladas = 0;
  for (const ot of ots) {
    venta += ot.venta;
    costo += ot.costo;
    margen += ot.margen_db;
    if (ot.estado === "FACTURADO") facturadas += 1;
    else if (ot.estado === "ABIERTO") abiertas += 1;
    else if (ot.estado === "ANULADO") anuladas += 1;
  }
  return {
    venta_total_soles: venta,
    costo_total_soles: costo,
    margen_total_soles: margen,
    margen_porcentaje: venta > 0 ? (margen / venta) * 100 : 0,
    ots_totales: ots.length,
    ots_facturadas: facturadas,
    ots_abiertas: abiertas,
    ots_anuladas: anuladas,
  };
}

function groupBy(ots: OtAgg[], keyFn: (ot: OtAgg) => string) {
  const map = new Map<string, OtAgg[]>();
  for (const ot of ots) {
    const key = keyFn(ot);
    const list = map.get(key) ?? [];
    list.push(ot);
    map.set(key, list);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0], "es"))
    .map(([key, group]) => moneyRow(key, group));
}

function buildByTipo(ots: OtAgg[]): MoneyByKey[] {
  return TIPOS_LINEA.map((tipo) => {
    const withTipo = ots.filter((ot) => ot.by_tipo[tipo].venta !== 0 || ot.by_tipo[tipo].costo !== 0 || ot.by_tipo[tipo].margen_db !== 0);
    let venta = 0;
    let costo = 0;
    let margen = 0;
    for (const ot of ots) {
      venta += ot.by_tipo[tipo].venta;
      costo += ot.by_tipo[tipo].costo;
      margen += ot.by_tipo[tipo].margen_db;
    }
    return {
      key: tipo,
      ots: withTipo.length,
      venta,
      costo,
      margen,
      margen_porcentaje: venta > 0 ? (margen / venta) * 100 : 0,
    };
  });
}

function buildValidation(ots: OtAgg[], lineas: number) {
  let margenDb = 0;
  let margenCalc = 0;
  const discrepancias: VentasTallerDashboardResponse["validation"]["discrepancias"] = [];
  for (const ot of ots) {
    margenDb += ot.margen_db;
    margenCalc += ot.margen_calc;
    const diff = ot.margen_db - ot.margen_calc;
    if (Math.abs(diff) > MARGEN_EPSILON) {
      discrepancias.push({
        ot: ot.ot,
        margen_base_datos: ot.margen_db,
        margen_calculado: ot.margen_calc,
        diferencia: diff,
      });
    }
  }
  discrepancias.sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));
  return {
    margen_base_datos: margenDb,
    margen_calculado: margenCalc,
    diferencia_margen: margenDb - margenCalc,
    cantidad_de_lineas: lineas,
    cantidad_de_ots: ots.length,
    ots_con_diferencia: discrepancias.length,
    discrepancias: discrepancias.slice(0, 20),
  };
}

function buildOpenPortfolio(ots: OtAgg[], today: string): OpenPortfolioBucket[] {
  const buckets = OPEN_BUCKETS.map((item) => ({
    bucket: item.bucket,
    ots: 0,
    venta: 0,
    costo: 0,
    margen: 0,
  }));
  for (const ot of ots) {
    if (ot.estado !== "ABIERTO" || !ot.fecha_ingreso) continue;
    const age = daysBetween(ot.fecha_ingreso, today);
    const slot = OPEN_BUCKETS.find((item) => age >= item.min && age <= item.max);
    if (!slot) continue;
    const row = buckets.find((item) => item.bucket === slot.bucket);
    if (!row) continue;
    row.ots += 1;
    row.venta += ot.venta;
    row.costo += ot.costo;
    row.margen += ot.margen_db;
  }
  return buckets;
}

function buildTrend(ots: OtAgg[], from: string, to: string): VentasTallerTrendMonth[] {
  const byMonth = new Map<string, OtAgg[]>();
  for (const mes of monthsInRange(from, to)) byMonth.set(mes, []);
  for (const ot of ots) {
    if (!ot.fecha) continue;
    const mes = ot.fecha.slice(0, 7);
    const list = byMonth.get(mes);
    if (list) list.push(ot);
  }
  return Array.from(byMonth.entries()).map(([mes, group]) => {
    const cards = buildCards(group);
    return {
      mes,
      venta: cards.venta_total_soles,
      costo: cards.costo_total_soles,
      margen: cards.margen_total_soles,
      ots: cards.ots_totales,
      ots_facturadas: cards.ots_facturadas,
      ots_abiertas: cards.ots_abiertas,
      ots_anuladas: cards.ots_anuladas,
      venta_facturado: group
        .filter((ot) => ot.estado === "FACTURADO")
        .reduce((sum, ot) => sum + ot.venta, 0),
      venta_abierto: group
        .filter((ot) => ot.estado === "ABIERTO")
        .reduce((sum, ot) => sum + ot.venta, 0),
      by_tipo_ot: TIPOS_OT_VALIDOS.map((tipo) =>
        moneyRow(
          tipo,
          group.filter((ot) => ot.tipo_ot === tipo)
        )
      ),
    };
  });
}

function roundMoneyRow(row: MoneyByKey): MoneyByKey {
  return {
    ...row,
    venta: roundMoney(row.venta),
    costo: roundMoney(row.costo),
    margen: roundMoney(row.margen),
    margen_porcentaje: roundPct(row.margen_porcentaje),
  };
}

function roundResponse(
  payload: VentasTallerDashboardResponse
): VentasTallerDashboardResponse {
  return {
    ...payload,
    cards: {
      ...payload.cards,
      venta_total_soles: roundMoney(payload.cards.venta_total_soles),
      costo_total_soles: roundMoney(payload.cards.costo_total_soles),
      margen_total_soles: roundMoney(payload.cards.margen_total_soles),
      margen_porcentaje: roundPct(payload.cards.margen_porcentaje),
    },
    by_status: payload.by_status.map(roundMoneyRow),
    by_tipo_ot: payload.by_tipo_ot.map(roundMoneyRow),
    preventivo_by_marca: payload.preventivo_by_marca.map(roundMoneyRow),
    correctivo_siniestro_by_date: payload.correctivo_siniestro_by_date.map((row) => ({
      ...roundMoneyRow(row),
      fecha: row.fecha,
      tipo_ot: row.tipo_ot,
    })),
    by_tipo: payload.by_tipo.map(roundMoneyRow),
    trend: payload.trend.map((row) => ({
      ...row,
      venta: roundMoney(row.venta),
      costo: roundMoney(row.costo),
      margen: roundMoney(row.margen),
      venta_facturado: roundMoney(row.venta_facturado),
      venta_abierto: roundMoney(row.venta_abierto),
      by_tipo_ot: row.by_tipo_ot.map(roundMoneyRow),
    })),
    open_portfolio: payload.open_portfolio.map((row) => ({
      ...row,
      venta: roundMoney(row.venta),
      costo: roundMoney(row.costo),
      margen: roundMoney(row.margen),
    })),
    ots: payload.ots.map((row) => ({
      ...row,
      venta: roundMoney(row.venta),
      costo: roundMoney(row.costo),
      margen: roundMoney(row.margen),
    })),
    open_ots: (payload.open_ots ?? []).map((row) => ({
      ...row,
      venta: roundMoney(row.venta),
      costo: roundMoney(row.costo),
      margen: roundMoney(row.margen),
    })),
    validation: {
      ...payload.validation,
      margen_base_datos: roundMoney(payload.validation.margen_base_datos),
      margen_calculado: roundMoney(payload.validation.margen_calculado),
      diferencia_margen: roundMoney(payload.validation.diferencia_margen),
      discrepancias: payload.validation.discrepancias.map((row) => ({
        ...row,
        margen_base_datos: round4(row.margen_base_datos),
        margen_calculado: round4(row.margen_calculado),
        diferencia: round4(row.diferencia),
      })),
    },
  };
}

function mapLine(row: Record<string, unknown>): DashboardSourceLine | null {
  const ot = String(row.ot ?? "").trim();
  if (!ot) return null;
  return {
    ot,
    tipo_ot: String(row.tipo_ot ?? "").trim() || null,
    estado: String(row.estado ?? "").trim() || null,
    marca: String(row.marca ?? "").trim() || null,
    placa: String(row.placa ?? "").trim() || null,
    tipo: String(row.tipo ?? "").trim() || null,
    cliente: String(row.cliente ?? "").trim() || null,
    fecha_ingreso: isYmd(String(row.fecha_ingreso ?? "").slice(0, 10))
      ? String(row.fecha_ingreso).slice(0, 10)
      : null,
    fecha_facturacion: isYmd(String(row.fecha_facturacion ?? "").slice(0, 10))
      ? String(row.fecha_facturacion).slice(0, 10)
      : null,
    precio_total_soles: toFiniteNumber(row.precio_total_soles as number | string | null),
    costo_total_soles: toFiniteNumber(row.costo_total_soles as number | string | null),
    margen_total_soles: toFiniteNumber(row.margen_total_soles as number | string | null),
  };
}

async function fetchFilteredLines(query: VentasTallerDashboardQuery, extra?: {
  estados?: string[];
  dateField?: DateField;
  from?: string;
  to?: string;
  requireDate?: boolean;
}) {
  const estados = extra?.estados ?? estadosDeVista(query.status_view);
  const dateField = extra?.dateField ?? query.date_field;
  const from = extra?.from ?? query.from;
  const to = extra?.to ?? query.to;
  const requireDate = extra?.requireDate ?? true;

  const lines: DashboardSourceLine[] = [];
  let consultas = 0;
  let fromIdx = 0;

  for (;;) {
    let q = supabaseAdmin
      .from("ventas_taller")
      .select(DASHBOARD_COLUMNS.join(","))
      .in("tipo_ot", query.tipo_ot)
      .in("estado", estados)
      .order("ot", { ascending: true })
      .order("id", { ascending: true });

    if (requireDate) {
      q = q.not(dateField, "is", null).gte(dateField, from).lte(dateField, to);
    } else {
      q = q.gte("fecha_ingreso", MIN_FECHA);
    }
    if (query.tipos.length > 0) q = q.in("tipo", query.tipos);
    if (query.marca.length > 0) q = q.in("marca", query.marca);

    const { data, error } = await q.range(fromIdx, fromIdx + DASHBOARD_PAGE_SIZE - 1);
    consultas += 1;
    if (error) throw new Error(error.message);
    const rows = (data as unknown as Record<string, unknown>[] | null) ?? [];
    for (const row of rows) {
      const line = mapLine(row);
      if (line) lines.push(line);
    }
    if (rows.length < DASHBOARD_PAGE_SIZE) break;
    fromIdx += DASHBOARD_PAGE_SIZE;
    if (fromIdx >= DASHBOARD_ROW_CAP) break;
  }

  return { lines, consultas };
}

export async function buildVentasTallerDashboard(
  query: VentasTallerDashboardQuery,
  now = new Date()
): Promise<VentasTallerDashboardResponse> {
  const today = todayYmd(now);
  const main = await fetchFilteredLines(query);
  const { ots, anomalias } = groupLinesByOt(main.lines);

  const placed: OtAgg[] = [];
  for (const ot of ots) {
    const fecha = assignFecha(ot, query.date_field);
    if (!inRange(fecha, query.from, query.to)) continue;
    if (!ot.tipo_ot) continue;
    placed.push(ot);
  }

  const cards = buildCards(placed);
  const by_status = groupBy(placed, (ot) => ot.estado ?? "SIN_ESTADO");
  const by_tipo_ot = TIPOS_OT_VALIDOS.map((tipo) =>
    moneyRow(
      tipo,
      placed.filter((ot) => ot.tipo_ot === tipo)
    )
  );
  const preventivo_by_marca = groupBy(
    placed.filter((ot) => ot.tipo_ot === "Preventivo"),
    (ot) => ot.marca ?? "Sin marca"
  );
  const correctivo_siniestro_by_date = groupBy(
    placed.filter(
      (ot) => ot.tipo_ot === "Correctivo" || ot.tipo_ot === "Siniestro"
    ),
    (ot) => `${ot.fecha ?? ""}|${ot.tipo_ot ?? ""}`
  ).map((row) => {
    const [fecha, tipo_ot] = row.key.split("|");
    return { ...row, fecha, tipo_ot };
  });
  const by_tipo = buildByTipo(placed);

  let trend: VentasTallerTrendMonth[] = [];
  let open_portfolio: OpenPortfolioBucket[] = [];
  let open_ots: DashboardOtRow[] = [];
  let consultas = main.consultas;
  let filas_leidas = main.lines.length;

  if (query.mode === "trend") {
    trend = buildTrend(placed, query.from, query.to);
    const openFetch = await fetchFilteredLines(query, {
      estados: ["ABIERTO"],
      dateField: "fecha_ingreso",
      from: MIN_FECHA,
      to: today,
      requireDate: true,
    });
    consultas += openFetch.consultas;
    filas_leidas += openFetch.lines.length;
    const openGrouped = groupLinesByOt(openFetch.lines);
    open_portfolio = buildOpenPortfolio(openGrouped.ots, today);
    open_ots = openGrouped.ots
      .filter((ot) => ot.estado === "ABIERTO" && ot.fecha_ingreso)
      .map((ot) => ({
        ot: ot.ot,
        placa: ot.placa,
        marca: ot.marca,
        tipo_ot: ot.tipo_ot,
        estado: ot.estado,
        fecha: ot.fecha_ingreso,
        venta: ot.venta,
        costo: ot.costo,
        margen: ot.margen_db,
      }))
      .sort(
        (a, b) =>
          (a.fecha ?? "").localeCompare(b.fecha ?? "") || a.ot.localeCompare(b.ot)
      );
    for (const item of openGrouped.anomalias) {
      if (!anomalias.some((a) => a.ot === item.ot)) anomalias.push(item);
    }
  }

  return roundResponse({
    success: true,
    mode: query.mode,
    filters: {
      date_field: query.date_field,
      status_view: query.status_view,
      month: query.month,
      from: query.from,
      to: query.to,
      tipo_ot: query.tipo_ot,
      tipos: query.tipos,
      marca: query.marca,
    },
    cards,
    by_status,
    by_tipo_ot,
    preventivo_by_marca,
    correctivo_siniestro_by_date,
    by_tipo,
    trend,
    open_portfolio,
    open_ots,
    ots: placed
      .map((ot) => ({
        ot: ot.ot,
        placa: ot.placa,
        marca: ot.marca,
        tipo_ot: ot.tipo_ot,
        estado: ot.estado,
        fecha: ot.fecha,
        venta: ot.venta,
        costo: ot.costo,
        margen: ot.margen_db,
      }))
      .sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "") || a.ot.localeCompare(b.ot)),
    marcas: Array.from(
      new Set(
        placed
          .map((ot) => ot.marca)
          .filter((value): value is string => Boolean(value))
      )
    ).sort((a, b) => a.localeCompare(b, "es")),
    validation: buildValidation(
      placed,
      placed.reduce((sum, ot) => sum + ot.lineas, 0)
    ),
    anomalias: anomalias.slice(0, 50),
    meta: {
      filas_leidas,
      columnas: [...DASHBOARD_COLUMNS],
      consultas,
      limitacion:
        "PostgREST no agrupa por OT con sumas, cabecera y validación de margen. La API lee solo las columnas financieras y de cabecera necesarias y agrega en el servidor. No se consultan dólares ni se pide una fila por OT.",
    },
  });
}
