"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Loader2, X } from "lucide-react";

export type DetalleOtPendiente = {
  ot_numero: string | number | null;
  vehiculo_modelo: string | null;
  vehiculo_placa: string | null;
  linea_codigo: string | null;
  linea_descripcion: string | null;
  linea_cantidad: number | string | null;
  linea_precio_unitario_pen: number | string | null;
  linea_fecha_entrega: string | null;
  ot_tipo_operacion: string | null;
  ot_status: string | null;
  linea_estado: string | null;
  linea_tipo: string | null;
};

type LogisticaTab = "control-ot";

const OT_STATUS_LABELS: Record<string, string> = {
  WAITING_FOR_ASSIGNMENT: "Espera asignación",
  WAITING_FOR_REPAIR: "Espera reparación",
  WAITING_FOR_VALUATION: "Espera valuación",
  IN_REPAIR: "En reparación",
  PARALYZED: "Paralizado",
  STOPPED: "Paralizado",
  QUALITY_CONTROL: "Control calidad",
  VEHICLE_READY: "Vehículo listo",
  LIQUIDATED: "Liquidado",
  SETTLED: "Liquidado",
  BILLED: "Facturado (P)",
};

function asText(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function uniqueSorted(values: (string | null | undefined)[]) {
  return Array.from(
    new Set(
      values
        .map((v) => v?.trim())
        .filter((v): v is string => Boolean(v))
    )
  ).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
}

function formatCantidad(value: number | string | null | undefined) {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return asText(value) || "—";
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

function formatPrecioPen(value: number | string | null | undefined) {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return `S/ ${n.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatFechaEntrega(value: string | null | undefined) {
  if (value == null || value.trim() === "") return "-";
  const raw = value.trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "-";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function labelOtStatus(code: string) {
  return OT_STATUS_LABELS[code] ?? code;
}

function hasFechaEntrega(value: string | null | undefined) {
  if (value == null) return false;
  const trimmed = value.trim();
  return trimmed !== "" && trimmed !== "-";
}

function rowHighlightClass(item: DetalleOtPendiente) {
  if (hasFechaEntrega(item.linea_fecha_entrega)) {
    return "bg-green-50 transition hover:bg-green-100/70";
  }
  if (item.ot_status === "VEHICLE_READY") {
    return "bg-red-50 transition hover:bg-red-100/70";
  }
  return "transition hover:bg-accent/5";
}

function matchesTextAndTipo(
  item: DetalleOtPendiente,
  textQuery: string,
  filterTipoOperacion: string
) {
  if (textQuery) {
    const estadoTraducido = item.ot_status
      ? labelOtStatus(item.ot_status)
      : "";
    const haystack = normalize(
      [
        item.vehiculo_placa ?? "",
        item.linea_codigo ?? "",
        item.linea_descripcion ?? "",
        estadoTraducido,
      ].join(" ")
    );
    if (!haystack.includes(textQuery)) return false;
  }

  if (
    filterTipoOperacion &&
    item.ot_tipo_operacion !== filterTipoOperacion
  ) {
    return false;
  }

  return true;
}

function mapDetalleRow(row: Record<string, unknown>): DetalleOtPendiente {
  return {
    ot_numero: (row.ot_numero as string | number | null) ?? null,
    vehiculo_modelo: asText(row.vehiculo_modelo) || null,
    vehiculo_placa: asText(row.vehiculo_placa) || null,
    linea_codigo: asText(row.linea_codigo) || null,
    linea_descripcion: asText(row.linea_descripcion) || null,
    linea_cantidad:
      row.linea_cantidad == null
        ? null
        : (row.linea_cantidad as number | string),
    linea_precio_unitario_pen:
      row.linea_precio_unitario_pen == null
        ? null
        : (row.linea_precio_unitario_pen as number | string),
    linea_fecha_entrega: asText(row.linea_fecha_entrega) || null,
    ot_tipo_operacion: asText(row.ot_tipo_operacion) || null,
    ot_status: asText(row.ot_status) || null,
    linea_estado: asText(row.linea_estado) || null,
    linea_tipo: asText(row.linea_tipo) || null,
  };
}

function rowKey(item: DetalleOtPendiente, index: number) {
  return [
    item.ot_numero ?? "",
    item.linea_codigo ?? "",
    item.linea_descripcion ?? "",
    item.linea_estado ?? "",
    index,
  ].join("|");
}

function sortOtNumeros(values: string[]) {
  return values.sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b, "es", { numeric: true });
  });
}

export default function LogisticaDashboard() {
  const [tab] = useState<LogisticaTab>("control-ot");
  const [items, setItems] = useState<DetalleOtPendiente[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterOtNumero, setFilterOtNumero] = useState("");
  const [filterTexto, setFilterTexto] = useState("");
  const [filterTipoOperacion, setFilterTipoOperacion] = useState("");
  const [hideGreenRows, setHideGreenRows] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const syncMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchDetalle = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/logistica/control-ot");
      const json = (await res.json()) as {
        data?: Record<string, unknown>[];
        error?: string;
      };

      if (!res.ok) {
        throw new Error(json.error || "Error al cargar datos");
      }

      const mapped = (json.data ?? []).map(mapDetalleRow);
      setItems(mapped);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error al cargar datos";
      console.error("Error al cargar Detalle_OT_Pendientes:", err);
      setError(message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDetalle();
  }, [fetchDetalle]);

  useEffect(() => {
    return () => {
      if (syncMessageTimer.current) {
        clearTimeout(syncMessageTimer.current);
      }
    };
  }, []);

  function showSyncMessage(type: "success" | "error", text: string) {
    if (syncMessageTimer.current) {
      clearTimeout(syncMessageTimer.current);
    }
    setSyncMessage({ type, text });
    syncMessageTimer.current = setTimeout(() => {
      setSyncMessage(null);
      syncMessageTimer.current = null;
    }, 4000);
  }

  async function handleSyncOt() {
    if (syncing) return;
    setSyncing(true);
    setSyncMessage(null);

    try {
      const res = await fetch("/api/logistica/trigger-sync", {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        errors?: unknown;
      };

      if (!res.ok || json.success === false) {
        const detail =
          json.error ||
          (Array.isArray(json.errors) && json.errors.length > 0
            ? String(json.errors[0])
            : null) ||
          `Error HTTP ${res.status}`;
        throw new Error(detail);
      }

      await fetchDetalle();
      showSyncMessage("success", "✅ Sincronización completada");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error al sincronizar";
      await fetchDetalle();
      showSyncMessage("error", message);
    } finally {
      setSyncing(false);
    }
  }

  const tipoOperacionOptions = useMemo(
    () => uniqueSorted(items.map((i) => i.ot_tipo_operacion)),
    [items]
  );

  const rowsForOtOptions = useMemo(() => {
    const textQuery = normalize(filterTexto);
    return items.filter((item) => {
      if (!matchesTextAndTipo(item, textQuery, filterTipoOperacion)) {
        return false;
      }
      if (hideGreenRows && hasFechaEntrega(item.linea_fecha_entrega)) {
        return false;
      }
      return true;
    });
  }, [items, filterTexto, filterTipoOperacion, hideGreenRows]);

  const otNumeroOptions = useMemo(() => {
    const unique = Array.from(
      new Set(
        rowsForOtOptions
          .map((i) => (i.ot_numero != null ? String(i.ot_numero).trim() : ""))
          .filter((v) => v !== "")
      )
    );
    return sortOtNumeros(unique);
  }, [rowsForOtOptions]);

  useEffect(() => {
    if (filterOtNumero && !otNumeroOptions.includes(filterOtNumero)) {
      setFilterOtNumero("");
    }
  }, [filterOtNumero, otNumeroOptions]);

  const filtered = useMemo(() => {
    const textQuery = normalize(filterTexto);

    return items.filter((item) => {
      if (filterOtNumero) {
        const ot = item.ot_numero != null ? String(item.ot_numero) : "";
        if (ot !== filterOtNumero) return false;
      }

      if (!matchesTextAndTipo(item, textQuery, filterTipoOperacion)) {
        return false;
      }

      if (hideGreenRows && hasFechaEntrega(item.linea_fecha_entrega)) {
        return false;
      }

      return true;
    });
  }, [
    items,
    filterOtNumero,
    filterTexto,
    filterTipoOperacion,
    hideGreenRows,
  ]);

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Secciones de logística"
        className="flex overflow-hidden rounded-xl border border-border/80 bg-slate-50/80"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "control-ot"}
          className="relative flex flex-1 items-center justify-center gap-2 bg-surface px-3 py-2.5 text-sm font-semibold text-accent sm:px-5"
        >
          <ClipboardList className="h-4 w-4" aria-hidden />
          <span className="truncate">Control OT</span>
          <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />
        </button>
      </div>

      {tab === "control-ot" ? (
        <div role="tabpanel" className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-3">
            <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  OT
                </span>
                <select
                  value={filterOtNumero}
                  onChange={(e) => setFilterOtNumero(e.target.value)}
                  className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                >
                  <option value="">Todas las OT</option>
                  {otNumeroOptions.map((ot) => (
                    <option key={ot} value={ot}>
                      {ot}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Buscar
                </span>
                <div className="relative">
                  <input
                    type="search"
                    value={filterTexto}
                    onChange={(e) => setFilterTexto(e.target.value)}
                    placeholder="Buscar por Placa, Código o Descripción..."
                    className="w-full rounded-xl border border-border bg-white py-2.5 pl-3 pr-9 text-sm text-foreground outline-none transition placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                  {filterTexto ? (
                    <button
                      type="button"
                      onClick={() => setFilterTexto("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 transition hover:text-slate-700"
                      aria-label="Limpiar búsqueda"
                      title="Limpiar"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                      <span className="sr-only">✕</span>
                    </button>
                  ) : null}
                </div>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Tipo Operación
                </span>
                <select
                  value={filterTipoOperacion}
                  onChange={(e) => setFilterTipoOperacion(e.target.value)}
                  className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                >
                  <option value="">Todos</option>
                  {tipoOperacionOptions.map((tipo) => (
                    <option key={tipo} value={tipo}>
                      {tipo}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex shrink-0 flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:justify-end lg:pb-0.5">
              <button
                type="button"
                onClick={() => setHideGreenRows((prev) => !prev)}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
              >
                {hideGreenRows
                  ? "⚪ Mostrar con fecha"
                  : "🟢 Ocultar con fecha"}
              </button>
              <button
                type="button"
                onClick={() => void handleSyncOt()}
                disabled={syncing}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {syncing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    Sincronizando...
                  </>
                ) : (
                  "🔄 Sincronizar OT"
                )}
              </button>
            </div>
          </div>

          {syncMessage ? (
            <p
              role="status"
              className={`text-right text-[11px] ${
                syncMessage.type === "success"
                  ? "text-emerald-700"
                  : "text-red-600"
              }`}
            >
              {syncMessage.text}
            </p>
          ) : null}

          {error ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </div>
          ) : null}

          <div className="overflow-hidden rounded-xl border border-border">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">OT</th>
                    <th className="px-4 py-3">Estado OT</th>
                    <th className="px-4 py-3">Modelo</th>
                    <th className="px-4 py-3">Placa</th>
                    <th className="px-4 py-3">Codigo</th>
                    <th className="px-4 py-3">Descripcion</th>
                    <th className="px-4 py-3">Cantidad</th>
                    <th className="px-4 py-3">Precio Unit</th>
                    <th className="px-4 py-3">Fecha Entrega</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-white">
                  {loading ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-4 py-12 text-center text-muted"
                      >
                        <span className="inline-flex items-center gap-2 text-sm">
                          <Loader2 className="h-4 w-4 animate-spin text-accent" />
                          Cargando Control OT…
                        </span>
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-4 py-12 text-center text-muted"
                      >
                        No se encontraron registros
                      </td>
                    </tr>
                  ) : (
                    filtered.map((item, index) => (
                      <tr
                        key={rowKey(item, index)}
                        className={rowHighlightClass(item)}
                      >
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-accent">
                          {item.ot_numero != null && item.ot_numero !== ""
                            ? String(item.ot_numero)
                            : "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                          {item.ot_status
                            ? labelOtStatus(item.ot_status)
                            : "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                          {item.vehiculo_modelo || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-foreground">
                          {item.vehiculo_placa || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-700">
                          {item.linea_codigo || "—"}
                        </td>
                        <td className="max-w-xs px-4 py-3 text-slate-700">
                          {item.linea_descripcion || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                          {formatCantidad(item.linea_cantidad)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700">
                          {formatPrecioPen(item.linea_precio_unitario_pen)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                          {formatFechaEntrega(item.linea_fecha_entrega)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {!loading ? (
              <div className="border-t border-border bg-slate-50/80 px-4 py-2.5 text-xs text-muted">
                {filtered.length} de {items.length} registro
                {items.length === 1 ? "" : "s"}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
