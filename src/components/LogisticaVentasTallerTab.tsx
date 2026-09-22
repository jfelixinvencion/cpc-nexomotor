"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Eye, Loader2, RefreshCw, X } from "lucide-react";
import { usePermisos } from "@/lib/auth/usePermisos";

const PAGE_SIZE = 50;
const COL_SPAN = 9;
const ROW_HEIGHT = 48;
const ICON_BTN =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border p-1 transition disabled:cursor-not-allowed disabled:opacity-60";

const ESTADOS_FILTRO = ["ABIERTO", "ANULADO", "FACTURADO"] as const;

export type VentaTallerRow = {
  id: number;
  seccion: string | null;
  ot: string | null;
  fecha_ingreso: string | null;
  tipo_ot: string | null;
  estado: string | null;
  estado_vehiculo: string | null;
  placa: string | null;
  vin: string | null;
  motor: string | null;
  marca: string | null;
  modelo_tecnico: string | null;
  anio_modelo: string | null;
  tipo: string | null;
  codigo: string | null;
  descripcion: string | null;
  cant_solicitada: number | string | null;
  precio_total_soles: number | string | null;
  costo_unitario_soles: number | string | null;
  costo_total_soles: number | string | null;
  margen_total_soles: number | string | null;
  observaciones: string | null;
};

type ApiList = {
  success?: boolean;
  error?: string;
  items?: VentaTallerRow[];
  total?: number;
  page?: number;
  page_size?: number;
  has_more?: boolean;
};

type ApiFacets = {
  success?: boolean;
  error?: string;
  facets?: {
    estados?: string[];
    tipo_ot?: string[];
    tipos?: string[];
  };
};

type SyncResponse = {
  success?: boolean;
  error?: string;
  otsProcesadas?: unknown;
  otsInsertadasNuevasCerradas?: unknown;
  otsSaltadasCerradasExistentes?: unknown;
  filasInsertadas?: unknown;
};

function asText(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function displayDash(value: unknown) {
  const text = asText(value);
  return text === "" ? "—" : text;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatFecha(value: string | null | undefined) {
  if (value == null || value.trim() === "") return "—";
  const raw = value.trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatCantidad(value: number | string | null | undefined) {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return displayDash(value);
  return String(n);
}

function formatSoles(value: number | string | null | undefined) {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return `S/ ${n.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function apiErrorMessage(raw: unknown, fallback: string) {
  if (typeof raw === "string" && raw.trim()) return raw;
  if (raw && typeof raw === "object" && "error" in raw) {
    const inner = (raw as { error?: unknown }).error;
    if (typeof inner === "string" && inner.trim()) return inner;
  }
  return fallback;
}

function mergeOptions(base: string[], selected: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...base, ...selected]) {
    const text = value.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

export default function LogisticaVentasTallerTab() {
  const { puede } = usePermisos();
  const canSincronizar = puede("logistica", "ventas_taller", "sincronizar");

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [estados, setEstados] = useState<string[]>([]);
  const [tiposOt, setTiposOt] = useState<string[]>([]);
  const [tipos, setTipos] = useState<string[]>([]);
  const [facetTipoOt, setFacetTipoOt] = useState<string[]>([]);
  const [facetTipos, setFacetTipos] = useState<string[]>([]);
  const [items, setItems] = useState<VentaTallerRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [ioSupported, setIoSupported] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [detalle, setDetalle] = useState<VentaTallerRow | null>(null);

  const syncMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchGenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const fetchingMoreRef = useRef(false);
  const loadedPagesRef = useRef(new Set<number>());
  const pageCacheRef = useRef(new Map<number, VentaTallerRow[]>());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setIoSupported(typeof IntersectionObserver !== "undefined");
  }, []);

  const buildParams = useCallback(
    (nextPage: number) => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (estados.length > 0) params.set("states", estados.join(","));
      if (tiposOt.length > 0) params.set("tipo_ot", tiposOt.join(","));
      if (tipos.length > 0) params.set("tipos", tipos.join(","));
      params.set("page", String(nextPage));
      params.set("page_size", String(PAGE_SIZE));
      return params;
    },
    [search, estados, tiposOt, tipos]
  );

  const fetchFacets = useCallback(async () => {
    try {
      const res = await fetch("/api/logistica/ventas-taller?facets=1", {
        headers: { Accept: "application/json" },
      });
      const json = (await res.json().catch(() => ({}))) as ApiFacets;
      if (!res.ok || json.success === false) return;
      setFacetTipoOt(json.facets?.tipo_ot ?? []);
      setFacetTipos(json.facets?.tipos ?? []);
    } catch {
      // Los desplegables siguen usables con la selección actual.
    }
  }, []);

  useEffect(() => {
    void fetchFacets();
  }, [fetchFacets]);

  const resetPageCache = useCallback(() => {
    loadedPagesRef.current = new Set();
    pageCacheRef.current = new Map();
  }, []);

  const fetchPage = useCallback(
    async (nextPage: number, signal: AbortSignal) => {
      const cached = pageCacheRef.current.get(nextPage);
      if (cached) return { rows: cached, total: null, hasMore: null };

      const res = await fetch(
        `/api/logistica/ventas-taller?${buildParams(nextPage).toString()}`,
        { headers: { Accept: "application/json" }, signal }
      );
      const json = (await res.json().catch(() => ({}))) as ApiList;
      if (!res.ok || json.success === false) {
        throw new Error(
          apiErrorMessage(json, "Error al cargar ventas de taller")
        );
      }
      const rows = json.items ?? [];
      pageCacheRef.current.set(nextPage, rows);
      loadedPagesRef.current.add(nextPage);
      return {
        rows,
        total: typeof json.total === "number" ? json.total : rows.length,
        hasMore: Boolean(json.has_more),
      };
    },
    [buildParams]
  );

  const fetchFirstPage = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const gen = ++fetchGenRef.current;
    fetchingMoreRef.current = false;
    resetPageCache();
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setLoadMoreError(null);
    setHasMore(false);
    setItems([]);
    setPage(1);
    setTotal(0);
    scrollRef.current?.scrollTo({ top: 0 });

    try {
      const result = await fetchPage(1, controller.signal);
      if (gen !== fetchGenRef.current) return;
      setItems(result.rows);
      setPage(1);
      setTotal(result.total ?? result.rows.length);
      setHasMore(result.hasMore ?? result.rows.length >= PAGE_SIZE);
    } catch (err) {
      if (controller.signal.aborted || gen !== fetchGenRef.current) return;
      setError(
        err instanceof Error ? err.message : "Error al cargar ventas de taller"
      );
      setItems([]);
      setHasMore(false);
      setTotal(0);
    } finally {
      if (gen === fetchGenRef.current) setLoading(false);
    }
  }, [fetchPage, resetPageCache]);

  const loadMore = useCallback(async () => {
    if (
      loading ||
      loadingMore ||
      !hasMore ||
      fetchingMoreRef.current ||
      items.length === 0
    ) {
      return;
    }

    const nextPage = page + 1;
    if (loadedPagesRef.current.has(nextPage)) return;

    fetchingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    const gen = fetchGenRef.current;
    const signal = abortRef.current?.signal ?? new AbortController().signal;

    try {
      const result = await fetchPage(nextPage, signal);
      if (gen !== fetchGenRef.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((row) => row.id));
        const extra = result.rows.filter((row) => !seen.has(row.id));
        return extra.length > 0 ? [...prev, ...extra] : prev;
      });
      setPage(nextPage);
      if (result.total != null) setTotal(result.total);
      if (result.hasMore != null) setHasMore(result.hasMore);
      else setHasMore(result.rows.length >= PAGE_SIZE);
    } catch (err) {
      if (signal.aborted || gen !== fetchGenRef.current) return;
      setLoadMoreError(
        err instanceof Error ? err.message : "Error al cargar más registros"
      );
    } finally {
      fetchingMoreRef.current = false;
      if (gen === fetchGenRef.current) setLoadingMore(false);
    }
  }, [fetchPage, hasMore, items.length, loading, loadingMore, page]);

  useEffect(() => {
    void fetchFirstPage();
  }, [fetchFirstPage]);

  useEffect(() => {
    if (!ioSupported || loading || !hasMore || items.length === 0) return;
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      { root, rootMargin: "240px", threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, ioSupported, items.length, loadMore, loading]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps -- measure on layout-affecting changes

  const virtualItems = virtualizer.getVirtualItems();
  const paddingTop = virtualItems[0]?.start ?? 0;
  const paddingBottom =
    virtualizer.getTotalSize() -
    (virtualItems[virtualItems.length - 1]?.end ?? 0);

  function showSyncMessage(type: "success" | "error", text: string) {
    if (syncMessageTimer.current) clearTimeout(syncMessageTimer.current);
    setSyncMessage({ type, text });
    syncMessageTimer.current = setTimeout(() => setSyncMessage(null), 8000);
  }

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    setSyncMessage(null);

    try {
      const res = await fetch("/api/logistica/trigger-sync-ventas-taller", {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const json = (await res.json().catch(() => ({}))) as SyncResponse;
      if (!res.ok || json.success === false) {
        throw new Error(apiErrorMessage(json, `Error HTTP ${res.status}`));
      }

      const filas =
        typeof json.filasInsertadas === "number" ? json.filasInsertadas : null;
      const ots =
        typeof json.otsProcesadas === "number" ? json.otsProcesadas : null;
      showSyncMessage(
        "success",
        ots != null && filas != null
          ? `✅ ${ots} OT procesadas · ${filas} filas insertadas`
          : "✅ Sincronización completada"
      );
      void fetchFacets();
      await fetchFirstPage();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error al sincronizar";
      showSyncMessage("error", message);
    } finally {
      setSyncing(false);
    }
  }

  const emptyMessage = useMemo(() => {
    if (
      search.trim() !== "" ||
      estados.length > 0 ||
      tiposOt.length > 0 ||
      tipos.length > 0
    ) {
      return "No se encontraron resultados para los filtros actuales.";
    }
    return "No hay ventas de taller registradas.";
  }, [search, estados, tiposOt, tipos]);

  const tipoOtOptions = useMemo(
    () => mergeOptions(facetTipoOt, tiposOt),
    [facetTipoOt, tiposOt]
  );
  const tipoOptions = useMemo(
    () => mergeOptions(facetTipos, tipos),
    [facetTipos, tipos]
  );

  return (
    <div role="tabpanel" className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="min-w-0 shrink-0">
            <h2 className="text-sm font-semibold text-foreground">
              Ventas_Taller
            </h2>
          </div>
          <label className="block min-w-0 flex-1 basis-[220px]">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Buscar
            </span>
            <div className="relative">
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="OT, fecha ingreso, placa, código o descripción..."
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
          <FilterDropdown
            label="Estado"
            options={[...ESTADOS_FILTRO]}
            selected={estados}
            onChange={setEstados}
          />
          <FilterDropdown
            label="Tipo OT"
            options={tipoOtOptions}
            selected={tiposOt}
            onChange={setTiposOt}
          />
          <FilterDropdown
            label="Tipo"
            options={tipoOptions}
            selected={tipos}
            onChange={setTipos}
          />
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2">
          {canSincronizar ? (
            <button
              type="button"
              onClick={() => void handleSync()}
              disabled={syncing}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {syncing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  Sincronizando...
                </>
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  Sincronizar
                </>
              )}
            </button>
          ) : null}
        </div>
      </div>

      {syncMessage ? (
        <p
          role="status"
          className={`text-right text-[11px] ${
            syncMessage.type === "success" ? "text-emerald-700" : "text-red-600"
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
        <div
          ref={scrollRef}
          className="w-full overflow-y-auto overflow-x-hidden"
          style={{ height: "calc(100vh - 220px)" }}
        >
          <table className="w-full table-fixed divide-y divide-border text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-[88px] px-1.5 py-2">OT</th>
                <th className="w-[108px] px-1.5 py-2">Fecha ingreso</th>
                <th className="w-[110px] px-1.5 py-2">Tipo OT</th>
                <th className="w-[92px] px-1.5 py-2">Placa</th>
                <th className="w-[88px] px-1.5 py-2">Tipo</th>
                <th className="w-[132px] px-1.5 py-2">Código</th>
                <th className="min-w-0 px-1 py-2">Descripcion</th>
                <th className="w-[88px] px-1.5 py-2 text-right">
                  Cant solicitada
                </th>
                <th className="w-[56px] px-1 py-2 text-center">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white">
              {loading ? (
                <tr>
                  <td
                    colSpan={COL_SPAN}
                    className="px-4 py-12 text-center text-muted"
                  >
                    <span className="inline-flex items-center gap-2 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin text-accent" />
                      Cargando ventas de taller…
                    </span>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td
                    colSpan={COL_SPAN}
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
                        colSpan={COL_SPAN}
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
                    return (
                      <tr
                        key={item.id}
                        className={`transition hover:bg-accent/5 ${
                          asText(item.estado) === "ABIERTO"
                            ? "bg-emerald-50"
                            : ""
                        }`}
                      >
                        <td className="w-[88px] px-1.5 py-2 font-mono text-[11px] font-semibold text-accent">
                          <TruncCell value={displayDash(item.ot)} />
                        </td>
                        <td className="w-[108px] px-1.5 py-2 text-slate-700">
                          <TruncCell value={formatFecha(item.fecha_ingreso)} />
                        </td>
                        <td className="w-[110px] px-1.5 py-2 text-slate-700">
                          <TruncCell value={displayDash(item.tipo_ot)} />
                        </td>
                        <td className="w-[92px] px-1.5 py-2 font-mono text-[11px] text-slate-700">
                          <TruncCell value={displayDash(item.placa)} />
                        </td>
                        <td className="w-[88px] px-1.5 py-2 text-slate-700">
                          <TruncCell value={displayDash(item.tipo)} />
                        </td>
                        <td className="w-[132px] px-1.5 py-2 font-mono text-[11px] text-slate-700">
                          <TruncCell value={displayDash(item.codigo)} />
                        </td>
                        <td className="min-w-0 px-1 py-2 text-slate-700">
                          <TruncCell value={displayDash(item.descripcion)} />
                        </td>
                        <td className="w-[88px] px-1.5 py-2 text-right text-slate-700">
                          {formatCantidad(item.cant_solicitada)}
                        </td>
                        <td className="w-[56px] px-1 py-2 text-center">
                          <button
                            type="button"
                            title="Ver detalle"
                            aria-label="Ver detalle"
                            className={`${ICON_BTN} border-gray-200 bg-white text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`}
                            onClick={() => setDetalle(item)}
                          >
                            <Eye className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {paddingBottom > 0 ? (
                    <tr aria-hidden>
                      <td
                        colSpan={COL_SPAN}
                        style={{
                          height: paddingBottom,
                          padding: 0,
                          border: "none",
                        }}
                      />
                    </tr>
                  ) : null}
                </>
              )}
            </tbody>
          </table>
          {!loading && items.length > 0 ? (
            <div ref={sentinelRef} className="h-1 w-full" aria-hidden />
          ) : null}
          {loadingMore ? (
            <div className="flex items-center justify-center gap-2 px-4 py-2 text-xs text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
              Cargando más…
            </div>
          ) : null}
          {loadMoreError ? (
            <div className="px-4 py-2 text-center">
              <p className="text-[11px] text-red-600">{loadMoreError}</p>
              <button
                type="button"
                onClick={() => void loadMore()}
                className="mt-1 text-xs font-medium text-accent hover:underline"
              >
                Reintentar
              </button>
            </div>
          ) : null}
          {!ioSupported && !loading && hasMore ? (
            <div className="px-4 py-2 text-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
                className="text-xs font-medium text-accent hover:underline disabled:opacity-60"
              >
                Cargar más
              </button>
            </div>
          ) : null}
        </div>
        {!loading ? (
          <div className="border-t border-border bg-slate-50/80 px-4 py-2.5 text-xs text-muted">
            {items.length} de {total} registro{total === 1 ? "" : "s"}
            {hasMore ? " · desplaza para ver más" : ""}
          </div>
        ) : null}
      </div>

      {detalle ? (
        <VentaTallerDetalleModal
          row={detalle}
          onClose={() => setDetalle(null)}
        />
      ) : null}
    </div>
  );
}

function FilterDropdown({
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
  const count = selected.length;

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  function toggle(value: string) {
    if (selectedSet.has(value)) {
      onChange(selected.filter((item) => item !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  return (
    <div ref={rootRef} className="relative w-full shrink-0 sm:w-[150px]">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Filtrar por ${label}`}
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex w-full items-center justify-between gap-1 rounded-xl border px-3 py-2.5 text-sm shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-accent/20 ${
          count > 0
            ? "border-accent/40 bg-accent/10 text-accent"
            : "border-border bg-white text-slate-700 hover:bg-slate-50"
        }`}
      >
        <span className="truncate">
          {count > 0 ? `${label} (${count})` : label}
        </span>
        <span aria-hidden>▾</span>
      </button>
      {open ? (
        <div
          role="listbox"
          aria-multiselectable
          className="absolute left-0 z-30 mt-1 min-w-full rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
        >
          <div className="flex items-center justify-end border-b border-gray-100 px-2 pb-1">
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={count === 0}
              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 disabled:opacity-40"
            >
              Limpiar
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {options.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-400">Sin opciones</p>
            ) : (
              options.map((option) => (
                <label
                  key={option}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedSet.has(option)}
                    onChange={() => toggle(option)}
                    className="h-3.5 w-3.5 rounded border-gray-300"
                  />
                  <span className="truncate" title={option}>
                    {option}
                  </span>
                </label>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
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

function VentaTallerDetalleModal({
  row,
  onClose,
}: {
  row: VentaTallerRow;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const fields: { label: string; value: string }[] = [
    { label: "Sección", value: displayDash(row.seccion) },
    { label: "OT", value: displayDash(row.ot) },
    { label: "Fecha ingreso", value: formatFecha(row.fecha_ingreso) },
    { label: "Tipo OT", value: displayDash(row.tipo_ot) },
    { label: "Estado", value: displayDash(row.estado) },
    { label: "Estado vehículo", value: displayDash(row.estado_vehiculo) },
    { label: "Placa", value: displayDash(row.placa) },
    { label: "VIN", value: displayDash(row.vin) },
    { label: "Motor", value: displayDash(row.motor) },
    { label: "Marca", value: displayDash(row.marca) },
    { label: "Modelo tecnico", value: displayDash(row.modelo_tecnico) },
    { label: "Año modelo", value: displayDash(row.anio_modelo) },
    { label: "Tipo", value: displayDash(row.tipo) },
    { label: "Código", value: displayDash(row.codigo) },
    { label: "Descripcion", value: displayDash(row.descripcion) },
    { label: "Cant solicitada", value: formatCantidad(row.cant_solicitada) },
    { label: "Precio total (S/)", value: formatSoles(row.precio_total_soles) },
    {
      label: "Costo unitario (S/)",
      value: formatSoles(row.costo_unitario_soles),
    },
    { label: "Costo total (S/)", value: formatSoles(row.costo_total_soles) },
    { label: "Margen total (S/)", value: formatSoles(row.margen_total_soles) },
    { label: "Observaciones", value: displayDash(row.observaciones) },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ventas-taller-detalle-title"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl shadow-slate-900/20"
      >
        <div className="flex items-center justify-between border-b border-border bg-slate-50 px-5 py-4">
          <div>
            <h3
              id="ventas-taller-detalle-title"
              className="text-base font-bold text-foreground"
            >
              Detalle de venta de taller
            </h3>
            <p className="text-xs text-muted">
              OT {displayDash(row.ot)}
              {row.placa ? ` · ${displayDash(row.placa)}` : ""}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            title="Cerrar"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {fields.map((field) => (
              <div
                key={field.label}
                className={
                  field.label === "Observaciones" ||
                  field.label === "Descripcion"
                    ? "sm:col-span-2"
                    : ""
                }
              >
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {field.label}
                </dt>
                <dd className="mt-0.5 break-words text-sm text-foreground">
                  {field.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
