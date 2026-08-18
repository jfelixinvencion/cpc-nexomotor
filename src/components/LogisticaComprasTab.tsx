"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FileSpreadsheet, Loader2, X } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase/client";

const COMPRAS_PAGE_SIZE = 100;
const COMPRAS_EXPORT_PAGE_SIZE = 500;
const COMPRAS_ROW_HEIGHT = 48;
const COMPRAS_COL_SPAN = 7;
const COMPRAS_SELECT =
  "numero_oc,fecha_creacion,proveedor,codigo_repuesto,descripcion_repuesto,cantidad,precio_total_con_igv_soles";

type OcDetalleRow = {
  rowIndex: number;
  numero_oc: string | null;
  fecha_creacion: string | null;
  proveedor: string | null;
  codigo_repuesto: string | null;
  descripcion_repuesto: string | null;
  cantidad: number | string | null;
  precio_total_con_igv_soles: number | string | null;
};

function asText(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function todayYmdLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addOneCalendarDay(ymd: string): string | null {
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatFechaCreacion(value: string | null | undefined) {
  if (value == null || value.trim() === "") return "-";
  const raw = value.trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "-";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function excelFecha(value: string | null | undefined) {
  const formatted = formatFechaCreacion(value);
  return formatted === "-" ? "" : formatted;
}

function formatCantidad(value: number | string | null | undefined) {
  if (value == null || value === "") return "-";
  return String(value);
}

function parsePositiveNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = parseFloat(String(value).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function calcPUnitSinIgv(
  precioTotalConIgv: unknown,
  cantidad: unknown
): number | null {
  const total = parsePositiveNumber(precioTotalConIgv);
  const qty = parsePositiveNumber(cantidad);
  if (total == null || qty == null) return null;
  const value = total / qty / 1.18;
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function formatPUnitSinIgv(
  precioTotalConIgv: unknown,
  cantidad: unknown
): string {
  const n = calcPUnitSinIgv(precioTotalConIgv, cantidad);
  if (n == null) return "-";
  return `S/ ${n.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function excelPUnitSinIgv(
  precioTotalConIgv: unknown,
  cantidad: unknown
): number | "" {
  const n = calcPUnitSinIgv(precioTotalConIgv, cantidad);
  if (n == null) return "";
  return n;
}

function excelCantidad(value: number | string | null | undefined): number | string {
  if (value == null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : String(value);
}

function ocDetallesTable() {
  return supabase.schema("vista").from("oc_detalles");
}

function escapePostgrestIlike(raw: string) {
  return raw
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/"/g, '\\"');
}

function isYmd(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function isFechaRangeInvalid(desde: string, hasta: string) {
  return Boolean(desde && hasta && isYmd(desde) && isYmd(hasta) && desde > hasta);
}

function applyOcDetallesFilters<
  T extends {
    or: (filters: string) => T;
    gte: (column: string, value: string) => T;
    lt: (column: string, value: string) => T;
  },
>(query: T, text: string, fechaDesde: string, fechaHasta: string): T {
  const trimmed = text.trim();
  if (trimmed) {
    const pattern = `"%${escapePostgrestIlike(trimmed)}%"`;
    query = query.or(
      [
        `numero_oc.ilike.${pattern}`,
        `proveedor.ilike.${pattern}`,
        `codigo_repuesto.ilike.${pattern}`,
        `descripcion_repuesto.ilike.${pattern}`,
      ].join(",")
    );
  }

  if (isFechaRangeInvalid(fechaDesde, fechaHasta)) {
    return query;
  }

  if (fechaDesde && isYmd(fechaDesde)) {
    query = query.gte("fecha_creacion", fechaDesde);
  }

  if (fechaHasta && isYmd(fechaHasta)) {
    const next = addOneCalendarDay(fechaHasta);
    if (next) {
      query = query.lt("fecha_creacion", next);
    }
  }

  return query;
}

function mapOcDetalleRow(
  row: Record<string, unknown>,
  rowIndex: number
): OcDetalleRow {
  return {
    rowIndex,
    numero_oc: row.numero_oc == null || row.numero_oc === "" ? null : String(row.numero_oc),
    fecha_creacion: asText(row.fecha_creacion) || null,
    proveedor: asText(row.proveedor) || null,
    codigo_repuesto:
      row.codigo_repuesto == null || row.codigo_repuesto === ""
        ? null
        : String(row.codigo_repuesto),
    descripcion_repuesto: asText(row.descripcion_repuesto) || null,
    cantidad:
      row.cantidad == null || row.cantidad === ""
        ? null
        : (row.cantidad as number | string),
    precio_total_con_igv_soles:
      row.precio_total_con_igv_soles == null ||
      row.precio_total_con_igv_soles === ""
        ? null
        : (row.precio_total_con_igv_soles as number | string),
  };
}

function TruncCell({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  return (
    <span className={`block truncate ${className}`} title={value}>
      {value}
    </span>
  );
}

function applyPrecioColumnFormat(worksheet: XLSX.WorkSheet) {
  const ref = worksheet["!ref"];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  for (let r = range.s.r + 1; r <= range.e.r; r += 1) {
    const addr = XLSX.utils.encode_cell({ r, c: 6 });
    const cell = worksheet[addr] as XLSX.CellObject | undefined;
    if (cell && typeof cell.v === "number") {
      cell.t = "n";
      cell.z = "#,##0.00";
    }
  }
}

export default function LogisticaComprasTab() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [items, setItems] = useState<OcDetalleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadedCountRef = useRef(0);
  const fetchingMoreRef = useRef(false);
  const fetchGenRef = useRef(0);
  const exportMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fechaRangeInvalid = isFechaRangeInvalid(fechaDesde, fechaHasta);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const fetchPage = useCallback(
    async (
      from: number,
      append: boolean,
      text: string,
      desdeFiltro: string,
      hastaFiltro: string
    ) => {
      const gen = fetchGenRef.current;
      const to = from + COMPRAS_PAGE_SIZE - 1;

      let query = ocDetallesTable().select(COMPRAS_SELECT);
      query = applyOcDetallesFilters(query, text, desdeFiltro, hastaFiltro);

      const { data, error: queryError } = await query
        .order("fecha_creacion", { ascending: false })
        .range(from, to);

      if (gen !== fetchGenRef.current) return 0;

      if (queryError) {
        throw new Error(queryError.message);
      }

      const rawRows = (data as Record<string, unknown>[] | null) ?? [];
      const mapped = rawRows.map((row, index) =>
        mapOcDetalleRow(row, from + index)
      );

      setItems((prev) => (append ? [...prev, ...mapped] : mapped));
      loadedCountRef.current = append
        ? loadedCountRef.current + mapped.length
        : mapped.length;
      setHasMore(mapped.length >= COMPRAS_PAGE_SIZE);
      return mapped.length;
    },
    []
  );

  const fetchFirstPage = useCallback(async () => {
    const gen = ++fetchGenRef.current;
    loadedCountRef.current = 0;
    fetchingMoreRef.current = false;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setHasMore(true);
    setItems([]);
    scrollRef.current?.scrollTo({ top: 0 });

    try {
      await fetchPage(0, false, search, fechaDesde, fechaHasta);
    } catch (err) {
      if (gen !== fetchGenRef.current) return;
      const message =
        err instanceof Error ? err.message : "Error desconocido";
      setError(`Error al cargar compras: ${message}`);
      setItems([]);
      setHasMore(false);
    } finally {
      if (gen === fetchGenRef.current) {
        setLoading(false);
      }
    }
  }, [fetchPage, search, fechaDesde, fechaHasta]);

  const loadMore = useCallback(async () => {
    if (
      !hasMore ||
      loading ||
      loadingMore ||
      fetchingMoreRef.current
    ) {
      return;
    }

    fetchingMoreRef.current = true;
    setLoadingMore(true);
    const gen = fetchGenRef.current;
    try {
      await fetchPage(loadedCountRef.current, true, search, fechaDesde, fechaHasta);
    } catch (err) {
      if (gen !== fetchGenRef.current) return;
      const message =
        err instanceof Error ? err.message : "Error desconocido";
      setError(`Error al cargar más compras: ${message}`);
    } finally {
      fetchingMoreRef.current = false;
      if (gen === fetchGenRef.current) {
        setLoadingMore(false);
      }
    }
  }, [fetchPage, hasMore, loading, loadingMore, search, fechaDesde, fechaHasta]);

  useEffect(() => {
    void fetchFirstPage();
  }, [fetchFirstPage]);

  useEffect(() => {
    return () => {
      if (exportMessageTimer.current) {
        clearTimeout(exportMessageTimer.current);
      }
      if (syncMessageTimer.current) {
        clearTimeout(syncMessageTimer.current);
      }
    };
  }, []);

  function showExportMessage(type: "success" | "error", text: string) {
    if (exportMessageTimer.current) {
      clearTimeout(exportMessageTimer.current);
    }
    setExportMessage({ type, text });
    exportMessageTimer.current = setTimeout(() => {
      setExportMessage(null);
      exportMessageTimer.current = null;
    }, 4000);
  }

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

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => COMPRAS_ROW_HEIGHT,
    overscan: 10,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps -- measure on layout-affecting changes

  const virtualItems = virtualizer.getVirtualItems();
  const lastVirtualIndex =
    virtualItems[virtualItems.length - 1]?.index ?? -1;
  const paddingTop = virtualItems[0]?.start ?? 0;
  const paddingBottom =
    virtualizer.getTotalSize() -
    (virtualItems[virtualItems.length - 1]?.end ?? 0);

  useEffect(() => {
    if (loading || !hasMore) return;
    if (lastVirtualIndex < 0 || items.length === 0) return;
    if (lastVirtualIndex >= Math.floor(items.length * 0.8)) {
      void loadMore();
    }
  }, [lastVirtualIndex, items.length, hasMore, loading, loadMore]);

  const hasActiveFilters =
    searchInput.trim() !== "" || fechaDesde !== "" || fechaHasta !== "";

  async function handleExportExcel() {
    if (exporting) return;
    setExporting(true);
    setExportMessage(null);

    try {
      const rows: OcDetalleRow[] = [];
      let from = 0;

      for (;;) {
        const to = from + COMPRAS_EXPORT_PAGE_SIZE - 1;
        let query = ocDetallesTable().select(COMPRAS_SELECT);
        query = applyOcDetallesFilters(query, search, fechaDesde, fechaHasta);
        const { data, error: queryError } = await query
          .order("fecha_creacion", { ascending: false })
          .range(from, to);

        if (queryError) {
          throw new Error(queryError.message);
        }

        const rawRows = (data as Record<string, unknown>[] | null) ?? [];
        for (let i = 0; i < rawRows.length; i += 1) {
          rows.push(mapOcDetalleRow(rawRows[i], from + i));
        }

        if (rawRows.length < COMPRAS_EXPORT_PAGE_SIZE) break;
        from += COMPRAS_EXPORT_PAGE_SIZE;
      }

      if (rows.length === 0) {
        showExportMessage(
          "error",
          "No hay resultados para los filtros actuales. No se generó el Excel."
        );
        return;
      }

      const sheetRows = rows.map((item) => ({
        OC: asText(item.numero_oc),
        FECHA: excelFecha(item.fecha_creacion),
        PROVEEDOR: asText(item.proveedor),
        CÓDIGO: asText(item.codigo_repuesto),
        DESCRIPCIÓN: asText(item.descripcion_repuesto),
        CANTIDAD: excelCantidad(item.cantidad),
        "P. UNIT. SIN IGV": excelPUnitSinIgv(
          item.precio_total_con_igv_soles,
          item.cantidad
        ),
      }));

      const worksheet = XLSX.utils.json_to_sheet(sheetRows);
      applyPrecioColumnFormat(worksheet);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Compras");
      XLSX.writeFile(workbook, `compras_oc_${todayYmdLocal()}.xlsx`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error al exportar";
      showExportMessage("error", `Error al exportar Excel: ${message}`);
    } finally {
      setExporting(false);
    }
  }

  async function handleSyncOc() {
    if (syncing) return;
    setSyncing(true);
    setSyncMessage(null);

    try {
      const res = await fetch("/api/logistica/trigger-sync-oc", {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        upserted?: unknown;
        fetched?: unknown;
      };

      if (!res.ok || json.success === false) {
        throw new Error(
          json.error || `Error HTTP ${res.status}`
        );
      }

      const count =
        typeof json.upserted === "number"
          ? json.upserted
          : typeof json.fetched === "number"
            ? json.fetched
            : null;
      showSyncMessage(
        "success",
        count != null
          ? `✅ ${count} OC sincronizadas`
          : "✅ Sincronización completada"
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error al sincronizar";
      showSyncMessage("error", message);
    } finally {
      setSyncing(false);
      await fetchFirstPage();
    }
  }

  const emptyMessage = useMemo(() => {
    if (hasActiveFilters) {
      return "No se encontraron resultados para los filtros actuales.";
    }
    return "No hay compras registradas.";
  }, [hasActiveFilters]);

  return (
    <div role="tabpanel" className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block min-w-0 flex-1">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Buscar
            </span>
            <div className="relative">
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Buscar OC, proveedor, código o descripción..."
                className="w-full rounded-xl border border-border bg-white py-2.5 pl-3 pr-9 text-sm text-foreground outline-none transition placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              {searchInput ? (
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
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

          <div className="flex w-full shrink-0 flex-col gap-1 sm:w-auto">
            <div className="flex items-end gap-1.5">
              <label className="block min-w-0 sm:w-[150px]">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Desde
                </span>
                <input
                  type="date"
                  value={fechaDesde}
                  onChange={(e) => setFechaDesde(e.target.value)}
                  className={`w-full min-w-0 rounded-xl border bg-white px-3 py-2.5 text-sm text-foreground outline-none transition focus:ring-2 ${
                    fechaRangeInvalid
                      ? "border-red-400 focus:border-red-500 focus:ring-red-500/20"
                      : "border-border focus:border-accent focus:ring-accent/20"
                  }`}
                />
              </label>
              <label className="block min-w-0 sm:w-[150px]">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Hasta
                </span>
                <input
                  type="date"
                  value={fechaHasta}
                  onChange={(e) => setFechaHasta(e.target.value)}
                  className={`w-full min-w-0 rounded-xl border bg-white px-3 py-2.5 text-sm text-foreground outline-none transition focus:ring-2 ${
                    fechaRangeInvalid
                      ? "border-red-400 focus:border-red-500 focus:ring-red-500/20"
                      : "border-border focus:border-accent focus:ring-accent/20"
                  }`}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setFechaDesde("");
                  setFechaHasta("");
                }}
                disabled={!fechaDesde && !fechaHasta}
                className="mb-0.5 inline-flex shrink-0 items-center justify-center rounded-lg border border-border bg-white px-2.5 py-2 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Limpiar
              </button>
            </div>
            {fechaRangeInvalid ? (
              <p className="text-[11px] text-red-600">
                Desde no puede ser mayor que Hasta.
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:justify-end lg:pb-0.5">
          <button
            type="button"
            onClick={() => void handleExportExcel()}
            disabled={exporting || loading}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 shadow-sm transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exporting ? (
              <>
                <Loader2
                  className="h-3.5 w-3.5 animate-spin text-emerald-600"
                  aria-hidden
                />
                Exportando...
              </>
            ) : (
              <>
                <FileSpreadsheet
                  className="h-3.5 w-3.5 text-emerald-600"
                  aria-hidden
                />
                Exportar Excel
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => void handleSyncOc()}
            disabled={syncing}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {syncing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Sincronizando...
              </>
            ) : (
              "🔄 Sincronizar OC"
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

      {exportMessage ? (
        <p
          role="status"
          className={`text-right text-[11px] ${
            exportMessage.type === "success"
              ? "text-emerald-700"
              : "text-red-600"
          }`}
        >
          {exportMessage.text}
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
        <div
          ref={scrollRef}
          className="w-full overflow-y-auto overflow-x-hidden"
          style={{ height: "calc(100vh - 220px)" }}
        >
          <table className="w-full table-fixed divide-y divide-border text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-[100px] px-1.5 py-2">OC</th>
                <th className="w-[108px] px-1.5 py-2">FECHA</th>
                <th className="w-[210px] px-1.5 py-2">PROVEEDOR</th>
                <th className="w-[132px] px-1.5 py-2">CÓDIGO</th>
                <th className="min-w-0 px-1.5 py-2">DESCRIPCIÓN</th>
                <th className="w-[72px] px-1.5 py-2 text-right">CANTIDAD</th>
                <th className="w-[120px] px-1.5 py-2 text-right">
                  P. UNIT. SIN IGV
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white">
              {loading ? (
                <tr>
                  <td
                    colSpan={COMPRAS_COL_SPAN}
                    className="px-4 py-12 text-center text-muted"
                  >
                    <span className="inline-flex items-center gap-2 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin text-accent" />
                      Cargando compras…
                    </span>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td
                    colSpan={COMPRAS_COL_SPAN}
                    className="px-4 py-12 text-center text-muted"
                  >
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                <>
                  {paddingTop > 0 ? (
                    <tr aria-hidden>
                      <td
                        colSpan={COMPRAS_COL_SPAN}
                        style={{
                          height: paddingTop,
                          padding: 0,
                          border: "none",
                        }}
                      />
                    </tr>
                  ) : null}
                  {virtualItems.map((virtualRow) => {
                    const item = items[virtualRow.index];
                    if (!item) return null;
                    const oc = asText(item.numero_oc) || "-";
                    const proveedor = asText(item.proveedor) || "-";
                    const codigo = asText(item.codigo_repuesto) || "-";
                    const descripcion = asText(item.descripcion_repuesto) || "-";
                    return (
                      <tr
                        key={item.rowIndex}
                        className="transition hover:bg-accent/5"
                      >
                        <td className="w-[100px] px-1.5 py-2 font-mono text-[11px] font-semibold text-accent">
                          <TruncCell value={oc} />
                        </td>
                        <td className="w-[108px] px-1.5 py-2 text-slate-700">
                          <TruncCell
                            value={formatFechaCreacion(item.fecha_creacion)}
                          />
                        </td>
                        <td className="w-[210px] px-1.5 py-2 text-slate-700">
                          <TruncCell value={proveedor} />
                        </td>
                        <td className="w-[132px] px-1.5 py-2 font-mono text-[11px] text-slate-700">
                          <TruncCell value={codigo} />
                        </td>
                        <td className="min-w-0 px-1.5 py-2 text-slate-700">
                          <TruncCell value={descripcion} />
                        </td>
                        <td className="w-[72px] px-1.5 py-2 text-right text-slate-700">
                          {formatCantidad(item.cantidad)}
                        </td>
                        <td className="w-[120px] px-1.5 py-2 text-right font-medium text-slate-700">
                          {formatPUnitSinIgv(
                            item.precio_total_con_igv_soles,
                            item.cantidad
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {paddingBottom > 0 ? (
                    <tr aria-hidden>
                      <td
                        colSpan={COMPRAS_COL_SPAN}
                        style={{
                          height: paddingBottom,
                          padding: 0,
                          border: "none",
                        }}
                      />
                    </tr>
                  ) : null}
                  {loadingMore ? (
                    <tr>
                      <td
                        colSpan={COMPRAS_COL_SPAN}
                        className="px-4 py-3 text-center text-muted"
                      >
                        <span className="inline-flex items-center gap-2 text-xs">
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin text-accent"
                            aria-hidden
                          />
                          Cargando más compras...
                        </span>
                      </td>
                    </tr>
                  ) : null}
                </>
              )}
            </tbody>
          </table>
        </div>
        {!loading ? (
          <div className="border-t border-border bg-slate-50/80 px-4 py-2.5 text-xs text-muted">
            {items.length} registro{items.length === 1 ? "" : "s"}
            {hasMore ? " · hay más en servidor" : ""}
          </div>
        ) : null}
      </div>
    </div>
  );
}
