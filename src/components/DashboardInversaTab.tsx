"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
  type ActiveElement,
  type ChartEvent,
} from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { Bar } from "react-chartjs-2";
import { Loader2, RefreshCw } from "lucide-react";
import DashboardInversaDetalleModal from "@/components/DashboardInversaDetalleModal";
import {
  ANTIGUEDAD_LABEL,
  CUBO_LABEL,
  ESTADO_LABEL,
  etiquetaEstado,
  SIN_VALORIZAR,
  VALOR_SIN_IGV_LABEL,
  type AntiguedadBucket,
  type CuboInversa,
  type EstadoNorm,
  type InversaDetalleFiltros,
  type InversaDetalleRow,
  type InversaResumen,
} from "@/lib/dashboard-inversa";

ChartJS.register(
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  ChartDataLabels
);

const COLORS = {
  devuelto: "#1D9E75",
  pendiente: "#D85A30",
  noRetornable: "#94A3B8",
  otro: "#BA7517",
  averiado: "#1D9E75",
  pendienteEstado: "#D85A30",
  consumible: "#378ADD",
  sinDevolucion: "#64748B",
};

const ESTADO_COLORS: Record<EstadoNorm, string> = {
  AVERIADO: COLORS.averiado,
  PENDIENTE: COLORS.pendienteEstado,
  "NO RETORNABLE": COLORS.consumible,
  "NO DEVUELTO": COLORS.sinDevolucion,
  OTRO: COLORS.otro,
};

const HIDE_DATALABELS = { datalabels: { display: false as const } };

type ModalState = {
  title: string;
  filtros: InversaDetalleFiltros;
};

function formatSoles(value: number) {
  return `S/ ${value.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPct(value: number | null) {
  if (value == null) return "—";
  return `${value.toLocaleString("es-PE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function formatCantidad(value: number) {
  return value.toLocaleString("es-PE", { maximumFractionDigits: 2 });
}

function formatValorKpi(
  valor: number | null,
  sinValorizar: number,
  lineas: number
) {
  if (lineas === 0) return "—";
  if (valor == null) {
    return sinValorizar > 0 ? `${SIN_VALORIZAR} (${sinValorizar})` : "—";
  }
  const base = formatSoles(valor);
  if (sinValorizar > 0) return `${base} · ${sinValorizar} ${SIN_VALORIZAR}`;
  return base;
}

function formatMes(mes: string) {
  if (mes === "Sin fecha") return mes;
  const [y, m] = mes.split("-");
  const months = [
    "Ene",
    "Feb",
    "Mar",
    "Abr",
    "May",
    "Jun",
    "Jul",
    "Ago",
    "Sep",
    "Oct",
    "Nov",
    "Dic",
  ];
  const idx = Number(m) - 1;
  if (!y || !Number.isFinite(idx) || idx < 0 || idx > 11) return mes;
  return `${months[idx]} ${y}`;
}

function buildDetalleQuery(filtros: InversaDetalleFiltros) {
  const params = new URLSearchParams({ detalle: "1" });
  if (filtros.mes) params.set("mes", filtros.mes);
  if (filtros.cubo) params.set("cubo", filtros.cubo);
  if (filtros.estado) params.set("estado", filtros.estado);
  if (filtros.categoria) params.set("categoria", filtros.categoria);
  if (filtros.antiguedad) params.set("antiguedad", filtros.antiguedad);
  if (filtros.codigo) params.set("codigo", filtros.codigo);
  if (filtros.calidad) params.set("calidad", filtros.calidad);
  if (filtros.grupo) params.set("grupo", filtros.grupo);
  return params.toString();
}

export default function DashboardInversaTab() {
  const [data, setData] = useState<InversaResumen | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [detalle, setDetalle] = useState<InversaDetalleRow[] | null>(null);
  const [detalleLoading, setDetalleLoading] = useState(false);
  const [detalleError, setDetalleError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/inversa", {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      } & Partial<InversaResumen>;
      if (!res.ok || json.success === false) {
        throw new Error(json.error || `Error HTTP ${res.status}`);
      }
      setData(json as InversaResumen);
    } catch (err) {
      setData(null);
      setError(
        err instanceof Error ? err.message : "No se pudo cargar Log. Inversa"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetalle = useCallback(async (title: string, filtros: InversaDetalleFiltros) => {
    setModal({ title, filtros });
    setDetalle(null);
    setDetalleError(null);
    setDetalleLoading(true);
    try {
      const res = await fetch(`/api/dashboard/inversa?${buildDetalleQuery(filtros)}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        items?: InversaDetalleRow[];
      };
      if (!res.ok || json.success === false) {
        throw new Error(json.error || `Error HTTP ${res.status}`);
      }
      setDetalle(Array.isArray(json.items) ? json.items : []);
    } catch (err) {
      setDetalle([]);
      setDetalleError(
        err instanceof Error ? err.message : "No se pudo cargar el detalle"
      );
    } finally {
      setDetalleLoading(false);
    }
  }, []);

  const monthLabels = useMemo(
    () => (data?.mensual ?? []).map((row) => formatMes(row.mes)),
    [data]
  );

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-teal-600" />
        Cargando logística inversa…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (!data) return null;

  const { kpis, calidad } = data;
  const remaining = Object.values(kpis.cubos).reduce((sum, c) => sum + c.lineas, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-[11px] text-slate-500">
          {data.excluidasVendido.lineas > 0 ? (
            <span>{data.excluidasVendido.nota}.</span>
          ) : (
            <span>Sin líneas vendidas a chatarra para excluir.</span>
          )}{" "}
          <span className="text-slate-400">{VALOR_SIN_IGV_LABEL}.</span>
        </p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:text-slate-600 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Actualizar
        </button>
      </div>

      {calidad.sinValorizar + calidad.sinCategoria + calidad.otroEstado > 0 ? (
        <div className="flex flex-wrap gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          <span className="font-semibold">Aviso de calidad</span>
          {calidad.sinValorizar > 0 ? (
            <button
              type="button"
              className="underline decoration-amber-400 underline-offset-2 hover:text-amber-950"
              onClick={() =>
                void openDetalle(`${SIN_VALORIZAR}: ${calidad.sinValorizar}`, {
                  calidad: "sin_valorizar",
                })
              }
            >
              {calidad.sinValorizar} {SIN_VALORIZAR.toLowerCase()}
            </button>
          ) : null}
          {calidad.sinCategoria > 0 ? (
            <button
              type="button"
              className="underline decoration-amber-400 underline-offset-2 hover:text-amber-950"
              onClick={() =>
                void openDetalle(`Sin categoría: ${calidad.sinCategoria}`, {
                  calidad: "sin_categoria",
                })
              }
            >
              {calidad.sinCategoria} sin categoría
            </button>
          ) : null}
          {calidad.otroEstado > 0 ? (
            <button
              type="button"
              className="underline decoration-amber-400 underline-offset-2 hover:text-amber-950"
              onClick={() =>
                void openDetalle(`${ESTADO_LABEL.OTRO}: ${calidad.otroEstado}`, {
                  calidad: "otro_estado",
                })
              }
            >
              {calidad.otroEstado} {ESTADO_LABEL.OTRO.toLowerCase()}
            </button>
          ) : null}
        </div>
      ) : null}

      {remaining === 0 ? (
        <p className="rounded-xl border border-border bg-white px-4 py-10 text-center text-sm text-muted">
          No hay líneas de logística inversa para mostrar (todas fueron
          excluidas o la tabla está vacía).
        </p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              featured
              label="% Avance (líneas)"
              value={formatPct(kpis.avanceLineas)}
              hint="Devuelto / (Devuelto + Pendiente)"
              onClick={() =>
                void openDetalle("% de avance (devuelto y pendiente)", {
                  grupo: "avance",
                })
              }
            />
            <KpiCard
              featured
              label="% Avance (cantidad)"
              value={formatPct(kpis.avanceCantidad)}
              hint="Mismo denominador, en piezas"
              onClick={() =>
                void openDetalle("% de avance (devuelto y pendiente)", {
                  grupo: "avance",
                })
              }
            />
            <KpiCard
              label={`Pendiente · ${VALOR_SIN_IGV_LABEL}`}
              value={formatValorKpi(
                kpis.valorizadoPendiente,
                kpis.cubos.pendiente.sinValorizar,
                kpis.cubos.pendiente.lineas
              )}
              hint={`${kpis.lineasPendientes} líneas · ${kpis.otsPendientes} OT`}
              onClick={() =>
                void openDetalle(ESTADO_LABEL.PENDIENTE, { cubo: "pendiente" })
              }
            />
            <KpiCard
              label={`Devuelto · ${VALOR_SIN_IGV_LABEL}`}
              value={formatValorKpi(
                kpis.valorizadoDevuelto,
                kpis.cubos.devuelto.sinValorizar,
                kpis.cubos.devuelto.lineas
              )}
              hint={`${kpis.cubos.devuelto.lineas} líneas`}
              onClick={() =>
                void openDetalle(CUBO_LABEL.devuelto, { cubo: "devuelto" })
              }
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label={`${CUBO_LABEL.no_retornable} · ${VALOR_SIN_IGV_LABEL}`}
              value={formatValorKpi(
                kpis.valorizadoNoRetornable,
                kpis.cubos.no_retornable.sinValorizar,
                kpis.cubos.no_retornable.lineas
              )}
              hint={`${kpis.cubos.no_retornable.lineas} líneas · ${formatCantidad(kpis.cubos.no_retornable.cantidad)} pzas`}
              onClick={() =>
                void openDetalle(CUBO_LABEL.no_retornable, {
                  cubo: "no_retornable",
                })
              }
            />
            <KpiCard
              label="Líneas pendientes"
              value={kpis.lineasPendientes.toLocaleString("es-PE")}
              hint={`${formatCantidad(kpis.cubos.pendiente.cantidad)} pzas`}
              onClick={() =>
                void openDetalle("Líneas pendientes", { cubo: "pendiente" })
              }
            />
            <KpiCard
              label="OT pendientes"
              value={kpis.otsPendientes.toLocaleString("es-PE")}
              onClick={() =>
                void openDetalle("OT pendientes", { cubo: "pendiente" })
              }
            />
            <KpiCard
              label="Antigüedad promedio pendiente"
              value={
                kpis.antiguedadPromedioPendiente == null
                  ? "—"
                  : `${kpis.antiguedadPromedioPendiente.toLocaleString("es-PE", {
                      maximumFractionDigits: 1,
                    })} días`
              }
              onClick={() =>
                void openDetalle("Pendiente por antigüedad", {
                  cubo: "pendiente",
                })
              }
            />
          </div>

          <div className="rounded-xl border border-border bg-white p-3 shadow-sm">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {CUBO_LABEL.no_retornable}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() =>
                  void openDetalle(ESTADO_LABEL["NO RETORNABLE"], {
                    estado: "NO RETORNABLE",
                  })
                }
                className="rounded-lg border border-border px-3 py-2 text-left hover:bg-slate-50"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {ESTADO_LABEL["NO RETORNABLE"]}
                </p>
                <p className="text-sm font-bold text-foreground">
                  {kpis.noRetornableDetalle.consumible.lineas} líneas ·{" "}
                  {formatCantidad(kpis.noRetornableDetalle.consumible.cantidad)}{" "}
                  pzas
                </p>
                <p className="text-[11px] text-slate-500">
                  {formatValorKpi(
                    kpis.noRetornableDetalle.consumible.valorizado,
                    kpis.noRetornableDetalle.consumible.sinValorizar,
                    kpis.noRetornableDetalle.consumible.lineas
                  )}
                </p>
              </button>
              <button
                type="button"
                onClick={() =>
                  void openDetalle(ESTADO_LABEL["NO DEVUELTO"], {
                    estado: "NO DEVUELTO",
                  })
                }
                className="rounded-lg border border-border px-3 py-2 text-left hover:bg-slate-50"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {ESTADO_LABEL["NO DEVUELTO"]}
                </p>
                <p className="text-sm font-bold text-foreground">
                  {kpis.noRetornableDetalle.sinDevolucion.lineas} líneas ·{" "}
                  {formatCantidad(
                    kpis.noRetornableDetalle.sinDevolucion.cantidad
                  )}{" "}
                  pzas
                </p>
                <p className="text-[11px] text-slate-500">
                  {formatValorKpi(
                    kpis.noRetornableDetalle.sinDevolucion.valorizado,
                    kpis.noRetornableDetalle.sinDevolucion.sinValorizar,
                    kpis.noRetornableDetalle.sinDevolucion.lineas
                  )}
                </p>
              </button>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ChartCard title="Devuelto vs pendiente por mes">
              {data.mensual.length === 0 ? (
                <EmptyChart />
              ) : (
                <div className="h-64">
                  <Bar
                    data={{
                      labels: monthLabels,
                      datasets: [
                        {
                          label: CUBO_LABEL.devuelto,
                          data: data.mensual.map((row) => row.devueltoLineas),
                          backgroundColor: COLORS.devuelto,
                          borderRadius: 4,
                        },
                        {
                          label: CUBO_LABEL.pendiente,
                          data: data.mensual.map((row) => row.pendienteLineas),
                          backgroundColor: COLORS.pendiente,
                          borderRadius: 4,
                        },
                        {
                          label: CUBO_LABEL.no_retornable,
                          data: data.mensual.map((row) => row.noRetornableLineas),
                          backgroundColor: COLORS.noRetornable,
                          borderRadius: 4,
                        },
                      ],
                    }}
                    options={{
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 } } },
                        ...HIDE_DATALABELS,
                        tooltip: {
                          callbacks: {
                            afterBody: (items) => {
                              const idx = items[0]?.dataIndex;
                              if (idx == null) return [];
                              const row = data.mensual[idx];
                              if (!row) return [];
                              return [
                                `% avance líneas: ${formatPct(row.avanceLineas)}`,
                                `% avance cantidad: ${formatPct(row.avanceCantidad)}`,
                              ];
                            },
                          },
                        },
                      },
                      scales: {
                        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                        y: {
                          beginAtZero: true,
                          ticks: { precision: 0, font: { size: 10 } },
                        },
                      },
                      onClick: (_event: ChartEvent, elements: ActiveElement[]) => {
                        const el = elements[0];
                        if (!el) return;
                        const row = data.mensual[el.index];
                        if (!row) return;
                        const cubos: CuboInversa[] = [
                          "devuelto",
                          "pendiente",
                          "no_retornable",
                        ];
                        const cubo = cubos[el.datasetIndex];
                        if (!cubo) return;
                        void openDetalle(
                          `${CUBO_LABEL[cubo]} · ${formatMes(row.mes)}`,
                          { mes: row.mes, cubo }
                        );
                      },
                    }}
                  />
                </div>
              )}
              {data.mensual.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                  {data.mensual.map((row) => (
                    <li key={row.mes}>
                      <button
                        type="button"
                        className="hover:underline"
                        onClick={() =>
                          void openDetalle(
                            `Avance · ${formatMes(row.mes)}`,
                            { mes: row.mes, grupo: "avance" }
                          )
                        }
                      >
                        {formatMes(row.mes)}: {formatPct(row.avanceLineas)}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </ChartCard>

            <ChartCard title="Estado del repuesto por mes">
              {data.estadoPorMes.length === 0 ? (
                <EmptyChart />
              ) : (
                <div className="h-64">
                  <Bar
                    data={{
                      labels: data.estadoPorMes.map((row) => formatMes(row.mes)),
                      datasets: (
                        [
                          "AVERIADO",
                          "PENDIENTE",
                          "NO RETORNABLE",
                          "NO DEVUELTO",
                          "OTRO",
                        ] as EstadoNorm[]
                      ).map((estado) => ({
                        label: etiquetaEstado(estado),
                        data: data.estadoPorMes.map(
                          (row) =>
                            row.estados.find((e) => e.estadoNorm === estado)
                              ?.lineas ?? 0
                        ),
                        backgroundColor: ESTADO_COLORS[estado],
                        stack: "estado",
                        borderRadius: 2,
                      })),
                    }}
                    options={{
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 } } },
                        ...HIDE_DATALABELS,
                      },
                      scales: {
                        x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 } } },
                        y: {
                          stacked: true,
                          beginAtZero: true,
                          ticks: { precision: 0, font: { size: 10 } },
                        },
                      },
                      onClick: (_event: ChartEvent, elements: ActiveElement[]) => {
                        const el = elements[0];
                        if (!el) return;
                        const row = data.estadoPorMes[el.index];
                        const estados: EstadoNorm[] = [
                          "AVERIADO",
                          "PENDIENTE",
                          "NO RETORNABLE",
                          "NO DEVUELTO",
                          "OTRO",
                        ];
                        const estado = estados[el.datasetIndex];
                        if (!row || !estado) return;
                        void openDetalle(
                          `${etiquetaEstado(estado)} · ${formatMes(row.mes)}`,
                          { mes: row.mes, estado }
                        );
                      },
                    }}
                  />
                </div>
              )}
            </ChartCard>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ChartCard title="Pendiente por categoría">
              {data.pendientePorCategoria.length === 0 ? (
                <EmptyChart />
              ) : (
                <div
                  style={{
                    height: Math.max(
                      180,
                      data.pendientePorCategoria.length * 24 + 16
                    ),
                  }}
                >
                  <Bar
                    data={{
                      labels: data.pendientePorCategoria.map(
                        (row) => row.categoria
                      ),
                      datasets: [
                        {
                          data: data.pendientePorCategoria.map((row) =>
                            row.valorizado == null ? 0 : row.valorizado
                          ),
                          backgroundColor: COLORS.pendiente,
                          borderRadius: 4,
                          barThickness: 12,
                        },
                      ],
                    }}
                    options={{
                      indexAxis: "y",
                      maintainAspectRatio: false,
                      layout: { padding: { right: 96 } },
                      plugins: {
                        legend: { display: false },
                        datalabels: {
                          anchor: "end",
                          align: "right",
                          color: "#0f172a",
                          font: { size: 9, weight: 600 },
                          formatter: (_value, ctx) => {
                            const row = data.pendientePorCategoria[ctx.dataIndex];
                            if (!row) return "";
                            const qty = `${formatCantidad(row.cantidad)} pzas`;
                            if (row.valorizado == null) {
                              return `${SIN_VALORIZAR} · ${qty}`;
                            }
                            const extra =
                              row.sinValorizar > 0
                                ? ` · ${row.sinValorizar} ${SIN_VALORIZAR}`
                                : "";
                            return `${formatSoles(row.valorizado)} · ${qty}${extra}`;
                          },
                        },
                      },
                      scales: {
                        x: { display: false, grid: { display: false } },
                        y: {
                          grid: { display: false },
                          ticks: { color: "#475569", font: { size: 10 } },
                        },
                      },
                      onClick: (_event: ChartEvent, elements: ActiveElement[]) => {
                        const index = elements[0]?.index;
                        if (index == null) {
                          void openDetalle("Pendiente por categoría", {
                            cubo: "pendiente",
                          });
                          return;
                        }
                        const row = data.pendientePorCategoria[index];
                        if (!row) return;
                        void openDetalle(`Pendiente · ${row.categoria}`, {
                          cubo: "pendiente",
                          categoria: row.categoria,
                        });
                      },
                    }}
                  />
                </div>
              )}
            </ChartCard>

            <ChartCard title="Antigüedad del pendiente">
              <div className="grid grid-cols-2 gap-2">
                {data.antiguedadPendiente.map((row) => (
                  <button
                    key={row.bucket}
                    type="button"
                    onClick={() =>
                      void openDetalle(ANTIGUEDAD_LABEL[row.bucket as AntiguedadBucket], {
                        cubo: "pendiente",
                        antiguedad: row.bucket,
                      })
                    }
                    className="rounded-lg border border-border px-3 py-2.5 text-left hover:bg-slate-50"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {row.label}
                    </p>
                    <p className="text-base font-bold text-foreground">
                      {row.lineas.toLocaleString("es-PE")}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {formatCantidad(row.cantidad)} pzas ·{" "}
                      {formatValorKpi(row.valorizado, row.sinValorizar, row.lineas)}
                    </p>
                  </button>
                ))}
              </div>
            </ChartCard>
          </div>

          <ChartCard title="Top 10 pendientes por valorizado">
            {data.top10Pendiente.length === 0 ? (
              <EmptyChart />
            ) : (
              <div className="overflow-auto">
                <table className="min-w-[560px] w-full text-left text-xs">
                  <thead className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-2 py-1.5">Código</th>
                      <th className="px-2 py-1.5">Descripción</th>
                      <th className="px-2 py-1.5">Categoría</th>
                      <th className="px-2 py-1.5 text-right">Líneas</th>
                      <th className="px-2 py-1.5 text-right">Cantidad</th>
                      <th className="px-2 py-1.5 text-right">{VALOR_SIN_IGV_LABEL}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.top10Pendiente.map((row) => (
                      <tr key={row.codigo} className="hover:bg-slate-50">
                        <td className="px-2 py-1.5">
                          <button
                            type="button"
                            className="font-semibold text-accent hover:underline"
                            onClick={() =>
                              void openDetalle(`Pendiente · ${row.codigo}`, {
                                cubo: "pendiente",
                                codigo: row.codigo,
                              })
                            }
                          >
                            {row.codigo}
                          </button>
                        </td>
                        <td className="px-2 py-1.5">{row.descripcion || "—"}</td>
                        <td className="px-2 py-1.5">
                          {row.categoria ?? "Sin categoría"}
                        </td>
                        <td className="px-2 py-1.5 text-right">{row.lineas}</td>
                        <td className="px-2 py-1.5 text-right">
                          {formatCantidad(row.cantidad)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-medium">
                          {formatSoles(row.valorizado)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ChartCard>
        </>
      )}

      {kpis.cubos.otro.lineas > 0 ? (
        <button
          type="button"
          onClick={() => void openDetalle(CUBO_LABEL.otro, { cubo: "otro" })}
          className="w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs text-amber-900 hover:bg-amber-100"
        >
          {kpis.cubos.otro.lineas} líneas en otro estado ·{" "}
          {formatCantidad(kpis.cubos.otro.cantidad)} pzas ·{" "}
          {formatValorKpi(
            kpis.cubos.otro.valorizado,
            kpis.cubos.otro.sinValorizar,
            kpis.cubos.otro.lineas
          )}
        </button>
      ) : null}

      {modal ? (
        <DashboardInversaDetalleModal
          title={modal.title}
          rows={detalle ?? []}
          loading={detalleLoading}
          error={detalleError}
          onClose={() => {
            setModal(null);
            setDetalle(null);
            setDetalleError(null);
          }}
        />
      ) : null}
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  onClick,
  featured = false,
}: {
  label: string;
  value: string;
  hint?: string;
  onClick: () => void;
  featured?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        featured
          ? "rounded-xl border border-teal-700/20 bg-gradient-to-br from-teal-600 to-teal-800 px-3 py-2.5 text-left text-white shadow-sm shadow-teal-700/20 hover:from-teal-600 hover:to-teal-700"
          : "rounded-xl border border-border bg-white px-3 py-2.5 text-left shadow-sm hover:bg-slate-50"
      }
    >
      <p
        className={
          featured
            ? "text-[10px] font-semibold uppercase tracking-wide text-teal-100"
            : "text-[10px] font-semibold uppercase tracking-wide text-slate-500"
        }
      >
        {label}
      </p>
      <p
        className={
          featured
            ? "mt-0.5 text-lg font-bold leading-tight text-white sm:text-xl"
            : "mt-0.5 text-base font-bold leading-tight text-foreground sm:text-lg"
        }
      >
        {value}
      </p>
      {hint ? (
        <p
          className={
            featured ? "mt-0.5 text-[10px] text-teal-100/90" : "mt-0.5 text-[10px] text-slate-500"
          }
        >
          {hint}
        </p>
      ) : null}
    </button>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-white p-3 shadow-sm">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </p>
      {children}
    </div>
  );
}

function EmptyChart() {
  return <p className="py-8 text-center text-sm text-muted">Sin datos</p>;
}
