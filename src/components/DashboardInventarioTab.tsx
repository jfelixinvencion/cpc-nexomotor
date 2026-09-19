"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArcElement,
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
import { Bar, Doughnut } from "react-chartjs-2";
import { Loader2, RefreshCw } from "lucide-react";
import {
  DASHBOARD_COLORS,
  type DetalleInventario,
  type ValorPorCategoria,
  type ValorPorTipo,
} from "@/lib/dashboard-inventario";
import type { TipoSku } from "@/lib/repuestos-clasificacion";
import DashboardModal, {
  type DashboardModalRow,
} from "@/components/DashboardModal";

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  ChartDataLabels
);

const TIPO_DONUT: TipoSku[] = ["Preventivo", "Correctivo", "Consumible"];

type DashboardPayload = {
  fechaCorte: string;
  fechaActualizacionTabla: string | null;
  valorizadoTotal: number;
  skusConStock: number;
  sinClasificar: number;
  sinRotacion: { valor: number; porcentaje: number };
  porTipoSku: ValorPorTipo[];
  porCategoriaPreventivo: ValorPorCategoria[];
  porCategoriaCorrectivo: ValorPorCategoria[];
  porCategoriaSinRotacion: ValorPorCategoria[];
  porRotacion: { conRotacion: number; sinRotacion: number };
  itemsDetalle: DetalleInventario[];
  itemsSinClasificar: DetalleInventario[];
};

type ModalState = { title: string; rows: DashboardModalRow[] };

function formatSoles(value: number) {
  return `S/ ${value.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatFechaHora(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-PE", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function toModalRows(items: DetalleInventario[]): DashboardModalRow[] {
  return [...items]
    .sort((a, b) => b.valor - a.valor)
    .map((item) => ({
      codigo: item.codigo,
      descripcion: item.descripcion,
      tipo_sku: item.tipo_sku,
      categoria: item.categoria,
      sub_categoria: item.sub_categoria,
      valor: item.valor,
      stock: item.stock,
    }));
}

function pctOf(value: number, total: number) {
  if (total <= 0) return 0;
  return (value / total) * 100;
}

export default function DashboardInventarioTab() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/inventario", {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      } & Partial<DashboardPayload>;
      if (!res.ok || json.success === false) {
        throw new Error(json.error || `Error HTTP ${res.status}`);
      }
      setData(json as DashboardPayload);
    } catch (err) {
      setData(null);
      setError(
        err instanceof Error ? err.message : "No se pudo cargar el dashboard"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tipoRows = useMemo(
    () =>
      TIPO_DONUT.map((tipo) => data?.porTipoSku.find((row) => row.tipo_sku === tipo))
        .filter((row): row is ValorPorTipo => Boolean(row && row.valor > 0)),
    [data]
  );

  function openFiltered(
    title: string,
    predicate: (item: DetalleInventario) => boolean
  ) {
    if (!data) return;
    setModal({
      title,
      rows: toModalRows(data.itemsDetalle.filter(predicate)),
    });
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-teal-600" />
        Cargando inventario…
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

  const datosAl = formatFechaHora(
    data.fechaActualizacionTabla ?? data.fechaCorte
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-[11px] text-slate-500">
          Datos al:{" "}
          <span className="font-medium text-slate-700">{datosAl}</span>
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setModal({
                title: "Sin clasificar",
                rows: toModalRows(data.itemsSinClasificar),
              })
            }
            className="text-[11px] font-medium text-amber-800 hover:underline"
          >
            Sin Clasificar: {data.sinClasificar} ⚠
          </button>
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
      </div>

      <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(160px,0.72fr)_1.14fr_1.14fr]">
        <div className="grid grid-rows-3 gap-2">
          <KpiCard
            featured
            label="Valorizado Total"
            value={formatSoles(data.valorizadoTotal)}
            onClick={() =>
              setModal({
                title: "Valorizado total",
                rows: toModalRows(data.itemsDetalle),
              })
            }
          />
          <KpiCard
            label="SKUs"
            value={data.skusConStock.toLocaleString("es-PE")}
            onClick={() =>
              setModal({
                title: "SKUs",
                rows: toModalRows(data.itemsDetalle),
              })
            }
          />
          <KpiCard
            label="Sin Rotación"
            value={`${formatSoles(data.sinRotacion.valor)} · ${data.sinRotacion.porcentaje.toFixed(1)}%`}
            onClick={() =>
              openFiltered(
                "Sin rotación",
                (item) => item.rotacion === "Sin Rotación"
              )
            }
          />
        </div>

        <DonutCard
          title="Por Tipo de SKU"
          labels={tipoRows.map((row) => row.tipo_sku)}
          values={tipoRows.map((row) => row.valor)}
          colors={tipoRows.map((row) => DASHBOARD_COLORS[row.tipo_sku])}
          onOpenAll={() =>
            openFiltered("Por tipo de SKU", (item) =>
              TIPO_DONUT.includes(item.tipo_sku as TipoSku)
            )
          }
          onSlice={(index) => {
            const tipo = tipoRows[index]?.tipo_sku;
            if (tipo) {
              openFiltered(`Tipo SKU: ${tipo}`, (item) => item.tipo_sku === tipo);
            }
          }}
        />

        <DonutCard
          title="Rotación"
          labels={["Con Rotación", "Sin Rotación"]}
          values={[data.porRotacion.conRotacion, data.porRotacion.sinRotacion]}
          colors={["#1D9E75", "#94A3B8"]}
          onOpenAll={() =>
            setModal({
              title: "Rotación",
              rows: toModalRows(data.itemsDetalle),
            })
          }
          onSlice={(index) => {
            if (index === 0) {
              openFiltered(
                "Con rotación",
                (item) => item.rotacion === "Con Rotación"
              );
            } else if (index === 1) {
              openFiltered(
                "Sin rotación",
                (item) => item.rotacion === "Sin Rotación"
              );
            }
          }}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <CategoriaBars
          title="Preventivo por Categoría"
          color={DASHBOARD_COLORS.Preventivo}
          rows={data.porCategoriaPreventivo}
          onOpenAll={() =>
            openFiltered(
              "Preventivo por categoría",
              (item) => item.tipo_sku === "Preventivo"
            )
          }
          onSelect={(categoria) =>
            openFiltered(
              `Preventivo · ${categoria}`,
              (item) =>
                item.tipo_sku === "Preventivo" && item.categoria === categoria
            )
          }
        />
        <CategoriaBars
          title="Correctivo por Categoría"
          color={DASHBOARD_COLORS.Correctivo}
          rows={data.porCategoriaCorrectivo}
          onOpenAll={() =>
            openFiltered(
              "Correctivo por categoría",
              (item) => item.tipo_sku === "Correctivo"
            )
          }
          onSelect={(categoria) =>
            openFiltered(
              `Correctivo · ${categoria}`,
              (item) =>
                item.tipo_sku === "Correctivo" && item.categoria === categoria
            )
          }
        />
        <CategoriaBars
          title="Sin Rotación por Categoría"
          color="#64748B"
          rows={data.porCategoriaSinRotacion}
          onOpenAll={() =>
            openFiltered(
              "Sin rotación por categoría",
              (item) => item.rotacion === "Sin Rotación"
            )
          }
          onSelect={(categoria) =>
            openFiltered(
              `Sin rotación · ${categoria}`,
              (item) =>
                item.rotacion === "Sin Rotación" && item.categoria === categoria
            )
          }
        />
      </div>

      {modal ? (
        <DashboardModal
          title={modal.title}
          rows={modal.rows}
          onClose={() => setModal(null)}
        />
      ) : null}
    </div>
  );
}

function KpiCard({
  label,
  value,
  onClick,
  featured = false,
}: {
  label: string;
  value: string;
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
    </button>
  );
}

function DonutCard({
  title,
  labels,
  values,
  colors,
  onOpenAll,
  onSlice,
}: {
  title: string;
  labels: string[];
  values: number[];
  colors: string[];
  onOpenAll: () => void;
  onSlice: (index: number) => void;
}) {
  const total = values.reduce((sum, value) => sum + value, 0);
  const legendItems = (
    <ul className="w-fit shrink-0 space-y-1">
      {labels.map((label, index) => (
        <li key={label}>
          <button
            type="button"
            onClick={() => onSlice(index)}
            className="flex items-center gap-1.5 text-left text-[11px] leading-tight hover:opacity-80"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: colors[index] }}
            />
            <span className="font-medium text-slate-600">{label}</span>
            <span className="font-semibold text-slate-900">
              {formatSoles(values[index] ?? 0)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="rounded-xl border border-border bg-white p-3 shadow-sm">
      <button
        type="button"
        onClick={onOpenAll}
        className="mb-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
      >
        {title}
      </button>
      {total <= 0 ? (
        <p className="py-8 text-center text-sm text-muted">Sin datos</p>
      ) : (
        <div className="flex w-full items-center justify-center gap-2.5">
          <div className="h-28 w-28 shrink-0 sm:h-32 sm:w-32">
            <Doughnut
              data={{
                labels,
                datasets: [
                  {
                    data: values,
                    backgroundColor: colors,
                    borderWidth: 0,
                  },
                ],
              }}
              options={{
                cutout: "58%",
                plugins: {
                  legend: { display: false },
                  datalabels: {
                    color: "#fff",
                    font: { weight: 700, size: 9 },
                    formatter: (value: number) => {
                      const pct = pctOf(value, total);
                      return pct < 1 ? "" : `${pct.toFixed(0)}%`;
                    },
                  },
                  tooltip: {
                    callbacks: {
                      label: (ctx) => {
                        const value = Number(ctx.raw ?? 0);
                        return ` ${formatSoles(value)} · ${pctOf(value, total).toFixed(1)}%`;
                      },
                    },
                  },
                },
                onClick: (event: ChartEvent, elements: ActiveElement[]) => {
                  event.native?.stopPropagation();
                  const index = elements[0]?.index;
                  if (index != null) onSlice(index);
                  else onOpenAll();
                },
              }}
            />
          </div>
          {legendItems}
        </div>
      )}
    </div>
  );
}

function CategoriaBars({
  title,
  color,
  rows,
  onOpenAll,
  onSelect,
}: {
  title: string;
  color: string;
  rows: ValorPorCategoria[];
  onOpenAll: () => void;
  onSelect: (categoria: string) => void;
}) {
  const total = rows.reduce((sum, row) => sum + row.valor, 0);
  const height = Math.max(168, rows.length * 22 + 8);

  return (
    <div className="rounded-xl border border-border bg-white p-2.5 shadow-sm">
      <button
        type="button"
        onClick={onOpenAll}
        className="mb-1 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
      >
        {title}
      </button>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Sin datos</p>
      ) : (
        <div style={{ height }}>
          <Bar
            data={{
              labels: rows.map((row) => row.categoria),
              datasets: [
                {
                  data: rows.map((row) => row.valor),
                  backgroundColor: color,
                  borderRadius: 4,
                  barThickness: 11,
                  categoryPercentage: 0.72,
                },
              ],
            }}
            options={{
              indexAxis: "y",
              maintainAspectRatio: false,
              layout: { padding: { right: 84, top: 0, bottom: 0 } },
              plugins: {
                legend: { display: false },
                datalabels: {
                  anchor: "end",
                  align: "right",
                  color: "#0f172a",
                  font: { size: 9, weight: 600 },
                  formatter: (value: number) => formatSoles(value),
                },
                tooltip: {
                  callbacks: {
                    label: (ctx) => {
                      const value = Number(ctx.raw ?? 0);
                      return ` ${formatSoles(value)} · ${pctOf(value, total).toFixed(1)}%`;
                    },
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
              onClick: (event: ChartEvent, elements: ActiveElement[]) => {
                event.native?.stopPropagation();
                const index = elements[0]?.index;
                if (index == null) {
                  onOpenAll();
                  return;
                }
                const categoria = rows[index]?.categoria;
                if (categoria) onSelect(categoria);
              },
            }}
          />
        </div>
      )}
    </div>
  );
}
