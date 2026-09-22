"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ActiveElement,
  type ChartEvent,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import { Eye, Loader2, RotateCcw, X } from "lucide-react";
import {
  MIN_FECHA,
  TIPOS_LINEA,
  TIPOS_OT_VALIDOS,
  daysBetweenYmd,
  defaultTrendRange,
  todayYmd,
  type DashboardOtRow,
  type DateField,
  type MoneyByKey,
  type OpenPortfolioBucket,
  type StatusView,
  type TipoOtValido,
  type VentasTallerDashboardResponse,
} from "@/lib/ventas-taller-dashboard-shared";
import VentaTallerDetalleModal, {
  type VentaTallerRow,
} from "@/components/VentaTallerDetalleModal";

ChartJS.register(
  BarElement,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  Legend
);

const COLORS = {
  venta: "#4F46E5",
  costo: "#D97706",
  margen: "#0F766E",
  facturado: "#0F766E",
  abierto: "#2563EB",
  correctivo: "#D85A30",
  siniestro: "#7C3AED",
};

type DrawerKind = "tipo_ot" | "marca" | "estado";
type DrawerState = {
  kind: DrawerKind;
  title: string;
  rows: DashboardOtRow[];
};

function formatSoles(value: number) {
  return `S/ ${value.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatFecha(value: string | null | undefined) {
  if (!value) return "—";
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return value;
}

function monthBounds(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start: `${ym}-01`, end: last };
}

function defaultMonth() {
  const today = todayYmd();
  const ym = today.slice(0, 7);
  return ym < MIN_FECHA.slice(0, 7) ? MIN_FECHA.slice(0, 7) : ym;
}

function moneyOf(rows: DashboardOtRow[]) {
  let venta = 0;
  let costo = 0;
  let margen = 0;
  for (const row of rows) {
    venta += row.venta;
    costo += row.costo;
    margen += row.margen;
  }
  return {
    ots: rows.length,
    venta,
    costo,
    margen,
    margen_porcentaje: venta > 0 ? (margen / venta) * 100 : 0,
  };
}

function statusOf(rows: MoneyByKey[], key: string) {
  return rows.find((row) => row.key === key) ?? null;
}

export default function DashboardVentasTallerTab() {
  const [subtab, setSubtab] = useState<"monthly" | "trend">("monthly");

  return (
    <div className="space-y-3">
      <div
        role="tablist"
        aria-label="Vistas de Ventas_Taller"
        className="inline-flex overflow-hidden rounded-xl border border-border bg-slate-50"
      >
        <button
          type="button"
          role="tab"
          aria-selected={subtab === "monthly"}
          onClick={() => setSubtab("monthly")}
          className={`px-3 py-1.5 text-xs font-semibold sm:px-4 ${
            subtab === "monthly"
              ? "bg-white text-teal-700 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          Resumen mensual
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subtab === "trend"}
          onClick={() => setSubtab("trend")}
          className={`px-3 py-1.5 text-xs font-semibold sm:px-4 ${
            subtab === "trend"
              ? "bg-white text-teal-700 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          Tendencia operativa
        </button>
      </div>
      {subtab === "monthly" ? <ResumenMensualView /> : <TendenciaOperativaView />}
    </div>
  );
}

function ResumenMensualView() {
  const [dateField, setDateField] = useState<DateField>("fecha_ingreso");
  const [month, setMonth] = useState(defaultMonth);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [statusView, setStatusView] = useState<StatusView>("total_operativo");
  const [tiposOt, setTiposOt] = useState<string[]>([...TIPOS_OT_VALIDOS]);
  const [tipos, setTipos] = useState<string[]>([...TIPOS_LINEA]);
  const [marcasSel, setMarcasSel] = useState<string[]>([]);
  const [marcaOptions, setMarcaOptions] = useState<string[]>([]);
  const [data, setData] = useState<VentasTallerDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marcasExpanded, setMarcasExpanded] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [detalle, setDetalle] = useState<VentaTallerRow | null>(null);
  const [detalleLoading, setDetalleLoading] = useState(false);

  const bounds = useMemo(() => monthBounds(month), [month]);

  const resetFilters = useCallback(() => {
    const ym = defaultMonth();
    setDateField("fecha_ingreso");
    setMonth(ym);
    setFrom("");
    setTo("");
    setStatusView("total_operativo");
    setTiposOt([...TIPOS_OT_VALIDOS]);
    setTipos([...TIPOS_LINEA]);
    setMarcasSel([]);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("mode", "monthly");
      params.set("month", month);
      params.set("date_field", dateField);
      params.set("status_view", statusView);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (tiposOt.length > 0 && tiposOt.length < TIPOS_OT_VALIDOS.length) {
        params.set("tipo_ot", tiposOt.join(","));
      }
      if (tipos.length > 0 && tipos.length < TIPOS_LINEA.length) {
        params.set("tipos", tipos.join(","));
      }
      if (marcasSel.length > 0) params.set("marca", marcasSel.join(","));

      const res = await fetch(
        `/api/logistica/ventas-taller/dashboard?${params.toString()}`,
        { credentials: "include", headers: { Accept: "application/json" } }
      );
      const json = (await res.json().catch(() => ({}))) as
        | VentasTallerDashboardResponse
        | { success?: boolean; error?: string };
      if (!res.ok || json.success === false) {
        throw new Error(
          "error" in json && json.error
            ? json.error
            : `Error HTTP ${res.status}`
        );
      }
      const payload = json as VentasTallerDashboardResponse;
      setData(payload);
      setMarcaOptions((prev) => {
        const next = new Set([...prev, ...payload.marcas, ...marcasSel]);
        return Array.from(next).sort((a, b) => a.localeCompare(b, "es"));
      });
    } catch (err) {
      setData(null);
      setError(
        err instanceof Error ? err.message : "No se pudo cargar el dashboard"
      );
    } finally {
      setLoading(false);
    }
  }, [dateField, from, marcasSel, month, statusView, tipos, tiposOt, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setFrom("");
    setTo("");
    setMarcasExpanded(false);
  }, [month]);

  async function openDetalle(ot: string) {
    setDetalleLoading(true);
    try {
      const res = await fetch(
        `/api/logistica/ventas-taller?ot=${encodeURIComponent(ot)}&page=1&page_size=1`,
        { credentials: "include", headers: { Accept: "application/json" } }
      );
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        items?: VentaTallerRow[];
        error?: string;
      };
      if (res.ok && json.success !== false && json.items?.[0]) {
        setDetalle(json.items[0]);
        return;
      }
      const fallback = drawer?.rows.find((row) => row.ot === ot);
      if (!fallback) {
        throw new Error(json.error || "No se encontró el detalle de la OT");
      }
      setDetalle({
        id: 0,
        seccion: null,
        ot: fallback.ot,
        fecha_ingreso: fallback.fecha,
        tipo_ot: fallback.tipo_ot,
        estado: fallback.estado,
        estado_vehiculo: null,
        placa: fallback.placa,
        vin: null,
        motor: null,
        marca: fallback.marca,
        modelo_tecnico: null,
        anio_modelo: null,
        tipo: null,
        codigo: null,
        descripcion: null,
        cant_solicitada: null,
        precio_total_soles: fallback.venta,
        costo_unitario_soles: null,
        costo_total_soles: fallback.costo,
        margen_total_soles: fallback.margen,
        observaciones: null,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo abrir el detalle"
      );
    } finally {
      setDetalleLoading(false);
    }
  }

  const facturado = data ? statusOf(data.by_status, "FACTURADO") : null;
  const abierto = data ? statusOf(data.by_status, "ABIERTO") : null;
  const marcasRows = useMemo(() => {
    const rows = [...(data?.preventivo_by_marca ?? [])].sort(
      (a, b) => b.margen - a.margen
    );
    return marcasExpanded ? rows : rows.slice(0, 10);
  }, [data, marcasExpanded]);

  const empty = Boolean(data && data.cards.ots_totales === 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-slate-50/70 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <Segmented
            label="Fecha"
            value={dateField}
            options={[
              { value: "fecha_ingreso", label: "Fecha de Ingreso" },
              { value: "fecha_facturacion", label: "Fecha de Facturación" },
            ]}
            onChange={(value) => setDateField(value as DateField)}
          />
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Mes
            </span>
            <input
              type="month"
              min={MIN_FECHA.slice(0, 7)}
              value={month}
              onChange={(e) => setMonth(e.target.value || defaultMonth())}
              className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Desde
            </span>
            <input
              type="date"
              min={bounds.start}
              max={to || bounds.end}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Hasta
            </span>
            <input
              type="date"
              min={from || bounds.start}
              max={bounds.end}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm"
            />
          </label>
          <label className="block min-w-[220px] flex-1">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Estado
            </span>
            <select
              value={statusView}
              onChange={(e) => setStatusView(e.target.value as StatusView)}
              className="w-full rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm"
            >
              <option value="total_operativo">
                Total operativo (Facturado + Abierto)
              </option>
              <option value="facturado">Solo Facturado</option>
              <option value="abierto">Solo Abierto</option>
              <option value="anulado">Solo Anulado</option>
            </select>
          </label>
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Limpiar
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <MultiFilter
            label="Tipo OT"
            options={[...TIPOS_OT_VALIDOS]}
            selected={tiposOt}
            onChange={setTiposOt}
          />
          <MultiFilter
            label="Tipo"
            options={[...TIPOS_LINEA]}
            selected={tipos}
            onChange={setTipos}
          />
          <MultiFilter
            label="Marca"
            options={marcaOptions}
            selected={marcasSel}
            onChange={setMarcasSel}
          />
        </div>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted">
          <Loader2 className="mr-2 h-4 w-4 animate-spin text-teal-600" />
          Cargando resumen mensual…
        </div>
      ) : null}

      {error && !data ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 text-xs font-semibold underline"
          >
            Reintentar
          </button>
        </div>
      ) : null}

      {data && empty ? (
        <div className="rounded-xl border border-dashed border-border bg-slate-50 px-4 py-12 text-center text-sm text-muted">
          No hay OTs para los filtros seleccionados.
        </div>
      ) : null}

      {data && !empty ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard
              title="Venta Total (S/)"
              value={formatSoles(data.cards.venta_total_soles)}
              detail={`Facturado: ${formatSoles(facturado?.venta ?? 0)} · Abierto: ${formatSoles(abierto?.venta ?? 0)}`}
            />
            <KpiCard
              title="Costo Total (S/)"
              value={formatSoles(data.cards.costo_total_soles)}
              detail={`Facturado: ${formatSoles(facturado?.costo ?? 0)} · Abierto: ${formatSoles(abierto?.costo ?? 0)}`}
            />
            <KpiCard
              title="Margen Total (S/)"
              value={formatSoles(data.cards.margen_total_soles)}
              featured
            />
            <KpiCard
              title="Margen (%)"
              value={`${data.cards.margen_porcentaje.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}
              featured
            />
            <KpiCard
              title="OTs Totales"
              value={String(data.cards.ots_totales)}
              detail={`Facturadas: ${data.cards.ots_facturadas} · Abiertas: ${data.cards.ots_abiertas} · Anuladas: ${data.cards.ots_anuladas}`}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ChartCard title="Sección A · Venta vs Costo por Tipo OT">
              <Bar
                data={{
                  labels: [...TIPOS_OT_VALIDOS],
                  datasets: [
                    {
                      label: "Venta",
                      data: TIPOS_OT_VALIDOS.map(
                        (tipo) =>
                          data.by_tipo_ot.find((row) => row.key === tipo)?.venta ?? 0
                      ),
                      backgroundColor: COLORS.venta,
                    },
                    {
                      label: "Costo",
                      data: TIPOS_OT_VALIDOS.map(
                        (tipo) =>
                          data.by_tipo_ot.find((row) => row.key === tipo)?.costo ?? 0
                      ),
                      backgroundColor: COLORS.costo,
                    },
                    {
                      label: "Margen",
                      data: TIPOS_OT_VALIDOS.map(
                        (tipo) =>
                          data.by_tipo_ot.find((row) => row.key === tipo)?.margen ?? 0
                      ),
                      backgroundColor: COLORS.margen,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { position: "bottom" } },
                  onClick: (_: ChartEvent, elements: ActiveElement[]) => {
                    const idx = elements[0]?.index;
                    if (idx == null) return;
                    const tipo = TIPOS_OT_VALIDOS[idx] as TipoOtValido;
                    setDrawer({
                      kind: "tipo_ot",
                      title: tipo,
                      rows: data.ots.filter((ot) => ot.tipo_ot === tipo),
                    });
                  },
                }}
              />
            </ChartCard>

            <ChartCard title="Sección B · Estado de OTs">
              <Bar
                data={{
                  labels: ["Facturado", "Abierto"],
                  datasets: [
                    {
                      label: "OTs",
                      data: [facturado?.ots ?? 0, abierto?.ots ?? 0],
                      backgroundColor: COLORS.facturado,
                    },
                    {
                      label: "Venta (S/)",
                      data: [facturado?.venta ?? 0, abierto?.venta ?? 0],
                      backgroundColor: COLORS.venta,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { position: "bottom" } },
                  onClick: (_: ChartEvent, elements: ActiveElement[]) => {
                    const idx = elements[0]?.index;
                    const estado = idx === 1 ? "ABIERTO" : "FACTURADO";
                    setDrawer({
                      kind: "estado",
                      title: estado === "ABIERTO" ? "Abierto" : "Facturado",
                      rows: data.ots.filter((ot) => ot.estado === estado),
                    });
                  },
                }}
              />
            </ChartCard>
          </div>

          <div className="rounded-xl border border-border bg-white p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                Sección C · Preventivo por marca
              </h3>
              {data.preventivo_by_marca.length > 10 ? (
                <button
                  type="button"
                  onClick={() => setMarcasExpanded((v) => !v)}
                  className="text-xs font-medium text-teal-700 hover:underline"
                >
                  {marcasExpanded ? "Ver top 10" : "Ver todas las marcas"}
                </button>
              ) : null}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5">Marca</th>
                    <th className="px-2 py-1.5 text-right">OTs</th>
                    <th className="px-2 py-1.5 text-right">Venta</th>
                    <th className="px-2 py-1.5 text-right">Costo</th>
                    <th className="px-2 py-1.5 text-right">Margen</th>
                    <th className="px-2 py-1.5 text-right">Margen / OT</th>
                    <th className="px-2 py-1.5 text-right">Margen %</th>
                  </tr>
                </thead>
                <tbody>
                  {marcasRows.map((row) => (
                    <tr
                      key={row.key}
                      className="cursor-pointer border-t border-border hover:bg-teal-50/60"
                      onClick={() =>
                        setDrawer({
                          kind: "marca",
                          title: `Preventivo - ${row.key}`,
                          rows: data.ots.filter(
                            (ot) =>
                              ot.tipo_ot === "Preventivo" &&
                              (ot.marca ?? "Sin marca") === row.key
                          ),
                        })
                      }
                    >
                      <td className="px-2 py-1.5 font-medium">{row.key}</td>
                      <td className="px-2 py-1.5 text-right">{row.ots}</td>
                      <td className="px-2 py-1.5 text-right">{formatSoles(row.venta)}</td>
                      <td className="px-2 py-1.5 text-right">{formatSoles(row.costo)}</td>
                      <td className="px-2 py-1.5 text-right">{formatSoles(row.margen)}</td>
                      <td className="px-2 py-1.5 text-right">
                        {formatSoles(row.ots > 0 ? row.margen / row.ots : 0)}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {row.margen_porcentaje.toLocaleString("es-PE", {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        })}
                        %
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ChartCard title="Sección D · Correctivo y Siniestro en el tiempo">
              <Line
                data={buildTimeline(data.correctivo_siniestro_by_date)}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { position: "bottom" } },
                }}
              />
            </ChartCard>
            <ChartCard title="Sección E · Venta y costo por tipo de línea">
              <Bar
                data={{
                  labels: [...TIPOS_LINEA],
                  datasets: [
                    {
                      label: "Venta",
                      data: TIPOS_LINEA.map(
                        (tipo) =>
                          data.by_tipo.find((row) => row.key === tipo)?.venta ?? 0
                      ),
                      backgroundColor: COLORS.venta,
                    },
                    {
                      label: "Costo",
                      data: TIPOS_LINEA.map(
                        (tipo) =>
                          data.by_tipo.find((row) => row.key === tipo)?.costo ?? 0
                      ),
                      backgroundColor: COLORS.costo,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { position: "bottom" } },
                }}
              />
            </ChartCard>
          </div>
        </>
      ) : null}

      {loading && data ? (
        <p className="text-center text-[11px] text-slate-400">
          <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
          Actualizando…
        </p>
      ) : null}

      {drawer ? (
        <Drawer
          title={drawer.title}
          rows={drawer.rows}
          loadingDetalle={detalleLoading}
          onClose={() => setDrawer(null)}
          onOpenOt={(ot) => void openDetalle(ot)}
        />
      ) : null}

      {detalle ? (
        <VentaTallerDetalleModal
          row={detalle}
          onClose={() => setDetalle(null)}
        />
      ) : null}
    </div>
  );
}

const AGING_GROUPS = [
  { keys: ["0-7"], label: "0-7 días" },
  { keys: ["8-15"], label: "8-15 días" },
  { keys: ["16-30"], label: "16-30 días" },
  { keys: ["31-60"], label: "31-60 días" },
  { keys: ["61-90", "90+"], label: ">60 días" },
] as const;

function ageApiBucket(age: number) {
  if (age <= 7) return "0-7";
  if (age <= 15) return "8-15";
  if (age <= 30) return "16-30";
  if (age <= 60) return "31-60";
  if (age <= 90) return "61-90";
  return "90+";
}

function sumAging(rows: OpenPortfolioBucket[], keys: readonly string[]) {
  return rows
    .filter((row) => keys.includes(row.bucket))
    .reduce(
      (acc, row) => ({
        ots: acc.ots + row.ots,
        venta: acc.venta + row.venta,
      }),
      { ots: 0, venta: 0 }
    );
}

function TendenciaOperativaView() {
  const defaults = defaultTrendRange();
  const today = todayYmd();
  const [dateField, setDateField] = useState<DateField>("fecha_ingreso");
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [statusView, setStatusView] = useState<StatusView>("total_operativo");
  const [tiposOt, setTiposOt] = useState<string[]>([...TIPOS_OT_VALIDOS]);
  const [tipos, setTipos] = useState<string[]>([...TIPOS_LINEA]);
  const [marcasSel, setMarcasSel] = useState<string[]>([]);
  const [marcaOptions, setMarcaOptions] = useState<string[]>([]);
  const [data, setData] = useState<VentasTallerDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [detalle, setDetalle] = useState<VentaTallerRow | null>(null);
  const [detalleLoading, setDetalleLoading] = useState(false);
  const rangeInvalid = from > to;

  const resetFilters = useCallback(() => {
    const next = defaultTrendRange();
    setDateField("fecha_ingreso");
    setFrom(next.from);
    setTo(next.to);
    setStatusView("total_operativo");
    setTiposOt([...TIPOS_OT_VALIDOS]);
    setTipos([...TIPOS_LINEA]);
    setMarcasSel([]);
  }, []);

  const load = useCallback(async () => {
    if (from > to) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("mode", "trend");
      params.set("date_field", dateField);
      params.set("status_view", statusView);
      params.set("from", from < MIN_FECHA ? MIN_FECHA : from);
      params.set("to", to > todayYmd() ? todayYmd() : to);
      if (tiposOt.length > 0 && tiposOt.length < TIPOS_OT_VALIDOS.length) {
        params.set("tipo_ot", tiposOt.join(","));
      }
      if (tipos.length > 0 && tipos.length < TIPOS_LINEA.length) {
        params.set("tipos", tipos.join(","));
      }
      if (marcasSel.length > 0) params.set("marca", marcasSel.join(","));

      const res = await fetch(
        `/api/logistica/ventas-taller/dashboard?${params.toString()}`,
        { credentials: "include", headers: { Accept: "application/json" } }
      );
      const json = (await res.json().catch(() => ({}))) as
        | VentasTallerDashboardResponse
        | { success?: boolean; error?: string };
      if (!res.ok || json.success === false) {
        throw new Error(
          "error" in json && json.error
            ? json.error
            : `Error HTTP ${res.status}`
        );
      }
      const payload = json as VentasTallerDashboardResponse;
      setData(payload);
      setMarcaOptions((prev) => {
        const next = new Set([...prev, ...payload.marcas, ...marcasSel]);
        return Array.from(next).sort((a, b) => a.localeCompare(b, "es"));
      });
    } catch (err) {
      setData(null);
      setError(
        err instanceof Error ? err.message : "No se pudo cargar la tendencia"
      );
    } finally {
      setLoading(false);
    }
  }, [dateField, from, marcasSel, statusView, tipos, tiposOt, to]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDetalle(ot: string) {
    setDetalleLoading(true);
    try {
      const res = await fetch(
        `/api/logistica/ventas-taller?ot=${encodeURIComponent(ot)}&page=1&page_size=1`,
        { credentials: "include", headers: { Accept: "application/json" } }
      );
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        items?: VentaTallerRow[];
        error?: string;
      };
      if (res.ok && json.success !== false && json.items?.[0]) {
        setDetalle(json.items[0]);
        return;
      }
      const fallback = drawer?.rows.find((row) => row.ot === ot);
      if (!fallback) {
        throw new Error(json.error || "No se encontró el detalle de la OT");
      }
      setDetalle({
        id: 0,
        seccion: null,
        ot: fallback.ot,
        fecha_ingreso: fallback.fecha,
        tipo_ot: fallback.tipo_ot,
        estado: fallback.estado,
        estado_vehiculo: null,
        placa: fallback.placa,
        vin: null,
        motor: null,
        marca: fallback.marca,
        modelo_tecnico: null,
        anio_modelo: null,
        tipo: null,
        codigo: null,
        descripcion: null,
        cant_solicitada: null,
        precio_total_soles: fallback.venta,
        costo_unitario_soles: null,
        costo_total_soles: fallback.costo,
        margen_total_soles: fallback.margen,
        observaciones: null,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo abrir el detalle"
      );
    } finally {
      setDetalleLoading(false);
    }
  }

  function openMonth(index: number) {
    const mes = data?.trend[index]?.mes;
    if (!mes || !data) return;
    setDrawer({
      kind: "estado",
      title: `Mes ${mes}`,
      rows: data.ots.filter((ot) => (ot.fecha ?? "").startsWith(mes)),
    });
  }

  function openAging(index: number) {
    const group = AGING_GROUPS[index];
    if (!group || !data) return;
    const todayKey = todayYmd();
    setDrawer({
      kind: "estado",
      title: `Cartera abierta · ${group.label}`,
      rows: (data.open_ots ?? []).filter((ot) => {
        if (!ot.fecha) return false;
        return (group.keys as readonly string[]).includes(
          ageApiBucket(daysBetweenYmd(ot.fecha, todayKey))
        );
      }),
    });
  }

  const facturado = data ? statusOf(data.by_status, "FACTURADO") : null;
  const abierto = data ? statusOf(data.by_status, "ABIERTO") : null;
  const aging = useMemo(
    () =>
      AGING_GROUPS.map((group) => ({
        ...group,
        ...sumAging(data?.open_portfolio ?? [], group.keys),
      })),
    [data]
  );
  const empty = Boolean(
    data &&
      data.cards.ots_totales === 0 &&
      aging.every((row) => row.ots === 0)
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-slate-50/70 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <Segmented
            label="Fecha"
            value={dateField}
            options={[
              { value: "fecha_ingreso", label: "Fecha de Ingreso" },
              { value: "fecha_facturacion", label: "Fecha de Facturación" },
            ]}
            onChange={(value) => setDateField(value as DateField)}
          />
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Desde
            </span>
            <input
              type="date"
              min={MIN_FECHA}
              max={to < today ? to : today}
              value={from}
              onChange={(e) => setFrom(e.target.value || MIN_FECHA)}
              className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Hasta
            </span>
            <input
              type="date"
              min={from > MIN_FECHA ? from : MIN_FECHA}
              max={today}
              value={to}
              onChange={(e) => setTo(e.target.value || today)}
              className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm"
            />
          </label>
          <label className="block min-w-[220px] flex-1">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Estado
            </span>
            <select
              value={statusView}
              onChange={(e) => setStatusView(e.target.value as StatusView)}
              className="w-full rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm"
            >
              <option value="total_operativo">
                Total operativo (Facturado + Abierto)
              </option>
              <option value="facturado">Solo Facturado</option>
              <option value="abierto">Solo Abierto</option>
              <option value="anulado">Solo Anulado</option>
            </select>
          </label>
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restablecer filtros
          </button>
        </div>
        {rangeInvalid ? (
          <p className="text-[11px] text-red-600">
            Desde no puede ser mayor que Hasta.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <MultiFilter
            label="Tipo OT"
            options={[...TIPOS_OT_VALIDOS]}
            selected={tiposOt}
            onChange={setTiposOt}
          />
          <MultiFilter
            label="Tipo"
            options={[...TIPOS_LINEA]}
            selected={tipos}
            onChange={setTipos}
          />
          <MultiFilter
            label="Marca"
            options={marcaOptions}
            selected={marcasSel}
            onChange={setMarcasSel}
          />
        </div>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted">
          <Loader2 className="mr-2 h-4 w-4 animate-spin text-teal-600" />
          Cargando tendencia operativa…
        </div>
      ) : null}

      {error && !data ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 text-xs font-semibold underline"
          >
            Reintentar
          </button>
        </div>
      ) : null}

      {data && empty ? (
        <div className="rounded-xl border border-dashed border-border bg-slate-50 px-4 py-12 text-center text-sm text-muted">
          No hay OTs para el rango y filtros seleccionados.
        </div>
      ) : null}

      {data && !empty ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard
              title="Venta Total (S/)"
              value={formatSoles(data.cards.venta_total_soles)}
              detail={`Facturado: ${formatSoles(facturado?.venta ?? 0)} · Abierto: ${formatSoles(abierto?.venta ?? 0)}`}
            />
            <KpiCard
              title="Costo Total (S/)"
              value={formatSoles(data.cards.costo_total_soles)}
            />
            <KpiCard
              title="Margen Total (S/)"
              value={formatSoles(data.cards.margen_total_soles)}
              featured
            />
            <KpiCard
              title="Margen (%)"
              value={`${data.cards.margen_porcentaje.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}
              featured
            />
            <KpiCard
              title="OTs Totales"
              value={String(data.cards.ots_totales)}
              detail={`Facturadas: ${data.cards.ots_facturadas} · Abiertas: ${data.cards.ots_abiertas} · Anuladas: ${data.cards.ots_anuladas}`}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ChartCard title="Evolución financiera mensual">
              <Line
                data={{
                  labels: data.trend.map((row) => row.mes),
                  datasets: [
                    {
                      label: "Venta Total (S/)",
                      data: data.trend.map((row) => row.venta),
                      borderColor: COLORS.venta,
                      backgroundColor: COLORS.venta,
                      tension: 0.25,
                    },
                    {
                      label: "Costo Total (S/)",
                      data: data.trend.map((row) => row.costo),
                      borderColor: COLORS.costo,
                      backgroundColor: COLORS.costo,
                      tension: 0.25,
                    },
                    {
                      label: "Margen Total (S/)",
                      data: data.trend.map((row) => row.margen),
                      borderColor: COLORS.margen,
                      backgroundColor: COLORS.margen,
                      tension: 0.25,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { position: "bottom" } },
                  onClick: (_: ChartEvent, elements: ActiveElement[]) => {
                    const idx = elements[0]?.index;
                    if (idx != null) openMonth(idx);
                  },
                }}
              />
            </ChartCard>
            <ChartCard title="Evolución del volumen de OTs">
              <Bar
                data={{
                  labels: data.trend.map((row) => row.mes),
                  datasets: [
                    {
                      label: "OTs Facturadas",
                      data: data.trend.map((row) => row.ots_facturadas),
                      backgroundColor: COLORS.facturado,
                    },
                    {
                      label: "OTs Abiertas",
                      data: data.trend.map((row) => row.ots_abiertas),
                      backgroundColor: COLORS.abierto,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { position: "bottom" } },
                  onClick: (_: ChartEvent, elements: ActiveElement[]) => {
                    const idx = elements[0]?.index;
                    if (idx != null) openMonth(idx);
                  },
                }}
              />
            </ChartCard>
            <ChartCard title="Composición de venta por tipo de OT">
              <Bar
                data={{
                  labels: data.trend.map((row) => row.mes),
                  datasets: TIPOS_OT_VALIDOS.map((tipo, i) => ({
                    label: tipo,
                    data: data.trend.map(
                      (row) =>
                        row.by_tipo_ot.find((item) => item.key === tipo)?.venta ??
                        0
                    ),
                    backgroundColor: [COLORS.margen, COLORS.correctivo, COLORS.siniestro][i],
                    stack: "venta",
                  })),
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { position: "bottom" } },
                  scales: {
                    x: { stacked: true },
                    y: { stacked: true },
                  },
                  onClick: (_: ChartEvent, elements: ActiveElement[]) => {
                    const idx = elements[0]?.index;
                    if (idx != null) openMonth(idx);
                  },
                }}
              />
            </ChartCard>
            <ChartCard title="Cartera abierta actual (aging)">
              <Bar
                data={{
                  labels: aging.map((row) => row.label),
                  datasets: [
                    {
                      label: "OTs abiertas",
                      data: aging.map((row) => row.ots),
                      backgroundColor: COLORS.abierto,
                    },
                    {
                      label: "Venta potencial (S/)",
                      data: aging.map((row) => row.venta),
                      backgroundColor: COLORS.venta,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { position: "bottom" } },
                  onClick: (_: ChartEvent, elements: ActiveElement[]) => {
                    const idx = elements[0]?.index;
                    if (idx != null) openAging(idx);
                  },
                }}
              />
            </ChartCard>
          </div>
        </>
      ) : null}

      {loading && data ? (
        <p className="text-center text-[11px] text-slate-400">
          <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
          Actualizando…
        </p>
      ) : null}

      {drawer ? (
        <Drawer
          title={drawer.title}
          rows={drawer.rows}
          loadingDetalle={detalleLoading}
          onClose={() => setDrawer(null)}
          onOpenOt={(ot) => void openDetalle(ot)}
        />
      ) : null}

      {detalle ? (
        <VentaTallerDetalleModal
          row={detalle}
          onClose={() => setDetalle(null)}
        />
      ) : null}
    </div>
  );
}

function buildTimeline(
  rows: Array<MoneyByKey & { fecha: string; tipo_ot: string }>
) {
  const dates = Array.from(new Set(rows.map((row) => row.fecha).filter(Boolean))).sort();
  const pick = (tipo: string, field: "venta" | "costo") =>
    dates.map(
      (fecha) =>
        rows.find((row) => row.fecha === fecha && row.tipo_ot === tipo)?.[field] ?? 0
    );
  return {
    labels: dates.map(formatFecha),
    datasets: [
      {
        label: "Correctivo · Venta",
        data: pick("Correctivo", "venta"),
        borderColor: COLORS.correctivo,
        backgroundColor: COLORS.correctivo,
        tension: 0.25,
      },
      {
        label: "Correctivo · Costo",
        data: pick("Correctivo", "costo"),
        borderColor: COLORS.costo,
        backgroundColor: COLORS.costo,
        borderDash: [4, 3],
        tension: 0.25,
      },
      {
        label: "Siniestro · Venta",
        data: pick("Siniestro", "venta"),
        borderColor: COLORS.siniestro,
        backgroundColor: COLORS.siniestro,
        tension: 0.25,
      },
      {
        label: "Siniestro · Costo",
        data: pick("Siniestro", "costo"),
        borderColor: "#94A3B8",
        backgroundColor: "#94A3B8",
        borderDash: [4, 3],
        tension: 0.25,
      },
    ],
  };
}

function KpiCard({
  title,
  value,
  detail,
  featured,
}: {
  title: string;
  value: string;
  detail?: string;
  featured?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        featured
          ? "border-teal-200 bg-teal-50/70"
          : "border-border bg-white"
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <p className="mt-1 text-xl font-bold text-foreground">{value}</p>
      {detail ? <p className="mt-1 text-[11px] text-slate-500">{detail}</p> : null}
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-white p-3">
      <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      <div className="h-[260px]">{children}</div>
    </div>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <div className="inline-flex overflow-hidden rounded-lg border border-border bg-white">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-2.5 py-1.5 text-xs font-medium ${
              value === opt.value
                ? "bg-teal-600 text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MultiFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={rootRef} className="relative w-full sm:w-[160px]">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs ${
          selected.length > 0
            ? "border-teal-200 bg-teal-50 text-teal-800"
            : "border-border bg-white text-slate-600"
        }`}
      >
        {selected.length > 0 ? `${label} (${selected.length})` : label}
        <span aria-hidden>▾</span>
      </button>
      {open ? (
        <div className="absolute left-0 z-20 mt-1 min-w-full rounded-lg border border-border bg-white py-1 shadow-lg">
          <div className="flex justify-end px-2 pb-1">
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[11px] text-slate-500 hover:underline"
            >
              Limpiar
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {options.map((option) => (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-2 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={selectedSet.has(option)}
                  onChange={() =>
                    onChange(
                      selectedSet.has(option)
                        ? selected.filter((item) => item !== option)
                        : [...selected, option]
                    )
                  }
                />
                {option}
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Drawer({
  title,
  rows,
  loadingDetalle,
  onClose,
  onOpenOt,
}: {
  title: string;
  rows: DashboardOtRow[];
  loadingDetalle: boolean;
  onClose: () => void;
  onOpenOt: (ot: string) => void;
}) {
  const summary = moneyOf(rows);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40">
      <button type="button" aria-label="Cerrar" className="flex-1" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="ventas-taller-drawer-title"
        className="flex h-full w-full max-w-xl flex-col border-l border-border bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-border px-4 py-3">
          <div>
            <h3 id="ventas-taller-drawer-title" className="text-sm font-bold">
              {title}
            </h3>
            <p className="mt-1 text-[11px] text-slate-500">
              {summary.ots} OTs · {formatSoles(summary.venta)} venta ·{" "}
              {formatSoles(summary.costo)} costo · {formatSoles(summary.margen)}{" "}
              margen · {summary.margen_porcentaje.toFixed(1)}%
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-2 py-1.5">OT</th>
                <th className="px-2 py-1.5">Placa</th>
                <th className="px-2 py-1.5">Marca</th>
                <th className="px-2 py-1.5">Tipo OT</th>
                <th className="px-2 py-1.5">Estado</th>
                <th className="px-2 py-1.5">Fecha</th>
                <th className="px-2 py-1.5 text-right">Venta</th>
                <th className="px-2 py-1.5 text-right">Margen</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.ot} className="border-t border-border">
                  <td className="px-2 py-1.5 font-mono font-semibold text-teal-700">
                    {row.ot}
                  </td>
                  <td className="px-2 py-1.5">{row.placa ?? "—"}</td>
                  <td className="px-2 py-1.5">{row.marca ?? "—"}</td>
                  <td className="px-2 py-1.5">{row.tipo_ot ?? "—"}</td>
                  <td className="px-2 py-1.5">{row.estado ?? "—"}</td>
                  <td className="px-2 py-1.5">{formatFecha(row.fecha)}</td>
                  <td className="px-2 py-1.5 text-right">{formatSoles(row.venta)}</td>
                  <td className="px-2 py-1.5 text-right">{formatSoles(row.margen)}</td>
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      title="Ver detalle"
                      aria-label="Ver detalle"
                      disabled={loadingDetalle}
                      onClick={() => onOpenOt(row.ot)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 text-slate-600 hover:bg-slate-50"
                    >
                      <Eye className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </aside>
    </div>
  );
}
