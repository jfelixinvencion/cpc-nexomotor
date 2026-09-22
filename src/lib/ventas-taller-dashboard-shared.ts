export const MIN_FECHA = "2026-07-01";

export const TIPOS_OT_VALIDOS = [
  "Preventivo",
  "Correctivo",
  "Siniestro",
] as const;
export const TIPOS_LINEA = ["MO - MEC", "REP", "ST"] as const;
export const DATE_FIELDS = ["fecha_ingreso", "fecha_facturacion"] as const;
export const STATUS_VIEWS = [
  "total_operativo",
  "facturado",
  "abierto",
  "anulado",
] as const;
export const DASHBOARD_MODES = ["monthly", "trend"] as const;

export type TipoOtValido = (typeof TIPOS_OT_VALIDOS)[number];
export type TipoLinea = (typeof TIPOS_LINEA)[number];
export type DateField = (typeof DATE_FIELDS)[number];
export type StatusView = (typeof STATUS_VIEWS)[number];
export type DashboardMode = (typeof DASHBOARD_MODES)[number];

export type VentasTallerDashLine = {
  ot: string;
  tipo_ot: string | null;
  estado: string | null;
  marca: string | null;
  placa: string | null;
  tipo: string | null;
  fecha_ingreso: string | null;
  fecha_facturacion: string | null;
  precio_total_soles: number;
  costo_total_soles: number;
  margen_total_soles: number;
};

export type OtAgg = {
  ot: string;
  tipo_ot: TipoOtValido | null;
  estado: string | null;
  marca: string | null;
  placa: string | null;
  fecha_ingreso: string | null;
  fecha_facturacion: string | null;
  fecha: string | null;
  lineas: number;
  venta: number;
  costo: number;
  margen_db: number;
  margen_calc: number;
  by_tipo: Record<TipoLinea, { venta: number; costo: number; margen_db: number }>;
};

export type OtAnomalia = {
  ot: string;
  campos: string[];
  valores: Record<string, string[]>;
};

export type MoneyByKey = {
  key: string;
  ots: number;
  venta: number;
  costo: number;
  margen: number;
  margen_porcentaje: number;
};

export type VentasTallerDashboardQuery = {
  mode: DashboardMode;
  date_field: DateField;
  status_view: StatusView;
  month: string | null;
  from: string;
  to: string;
  tipo_ot: TipoOtValido[];
  tipos: string[];
  marca: string[];
};

export type VentasTallerDashboardCards = {
  venta_total_soles: number;
  costo_total_soles: number;
  margen_total_soles: number;
  margen_porcentaje: number;
  ots_totales: number;
  ots_facturadas: number;
  ots_abiertas: number;
  ots_anuladas: number;
};

export type VentasTallerTrendMonth = {
  mes: string;
  venta: number;
  costo: number;
  margen: number;
  ots: number;
  ots_facturadas: number;
  ots_abiertas: number;
  ots_anuladas: number;
  venta_facturado: number;
  venta_abierto: number;
  by_tipo_ot: MoneyByKey[];
};

export type OpenPortfolioBucket = {
  bucket: string;
  ots: number;
  venta: number;
  costo: number;
  margen: number;
};

export type DashboardOtRow = {
  ot: string;
  placa: string | null;
  marca: string | null;
  tipo_ot: string | null;
  estado: string | null;
  fecha: string | null;
  venta: number;
  costo: number;
  margen: number;
};

export type VentasTallerDashboardResponse = {
  success: true;
  mode: DashboardMode;
  filters: {
    date_field: DateField;
    status_view: StatusView;
    month: string | null;
    from: string;
    to: string;
    tipo_ot: TipoOtValido[];
    tipos: string[];
    marca: string[];
  };
  cards: VentasTallerDashboardCards;
  by_status: MoneyByKey[];
  by_tipo_ot: MoneyByKey[];
  preventivo_by_marca: MoneyByKey[];
  correctivo_siniestro_by_date: Array<
    MoneyByKey & { fecha: string; tipo_ot: string }
  >;
  by_tipo: MoneyByKey[];
  trend: VentasTallerTrendMonth[];
  open_portfolio: OpenPortfolioBucket[];
  ots: DashboardOtRow[];
  open_ots: DashboardOtRow[];
  marcas: string[];
  validation: {
    margen_base_datos: number;
    margen_calculado: number;
    diferencia_margen: number;
    cantidad_de_lineas: number;
    cantidad_de_ots: number;
    ots_con_diferencia: number;
    discrepancias: Array<{
      ot: string;
      margen_base_datos: number;
      margen_calculado: number;
      diferencia: number;
    }>;
  };
  anomalias: OtAnomalia[];
  meta: {
    filas_leidas: number;
    columnas: string[];
    consultas: number;
    limitacion: string;
  };
};

export function todayYmd(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addMonthsYmd(ymd: string, delta: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  const last = new Date(
    Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)
  );
  const day = Math.min(d, last.getUTCDate());
  return new Date(
    Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), day)
  ).toISOString().slice(0, 10);
}

export function defaultTrendRange(now = new Date()) {
  const to = todayYmd(now);
  const sixAgo = addMonthsYmd(to, -6);
  return { from: sixAgo > MIN_FECHA ? sixAgo : MIN_FECHA, to };
}

export function daysBetweenYmd(from: string, to: string) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((b - a) / 86_400_000);
}
