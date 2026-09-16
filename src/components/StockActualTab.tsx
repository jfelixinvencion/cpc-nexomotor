"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
import { usePermisos } from "@/lib/auth/usePermisos";

const PAGE_SIZE = 50;

type StockRow = {
  codigo: string;
  repuesto: string | null;
  ubicacion: string | null;
  stock: number | string | null;
  costo_unitario_soles: number | string | null;
};

type ApiList = {
  success?: boolean;
  error?: unknown;
  items?: StockRow[];
};

function asText(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function apiErrorMessage(raw: unknown, fallback: string) {
  if (typeof raw === "string" && raw.trim()) return raw;
  if (raw && typeof raw === "object" && "error" in raw) {
    const inner = (raw as { error?: unknown }).error;
    if (typeof inner === "string" && inner.trim()) return inner;
  }
  return fallback;
}

function formatSolesIncIgv(value: number | string | null | undefined) {
  if (value == null || value === "") return "-";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "-";
  const inc = Math.round(n * 1.18 * 100) / 100;
  return `S/ ${inc.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatStock(value: number | string | null | undefined) {
  if (value == null || value === "") return "-";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return String(n);
}

function isZeroStock(value: number | string | null | undefined) {
  if (value == null || value === "") return false;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n === 0;
}

export default function StockActualTab() {
  const { puede } = usePermisos();
  const canSincronizar = puede("almacen", "stock_actual", "sincronizar");
  const [items, setItems] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [hideZeroStock, setHideZeroStock] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLTableRowElement | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((type: "success" | "error", text: string) => {
    if (msgTimer.current) clearTimeout(msgTimer.current);
    setMessage({ type, text });
    msgTimer.current = setTimeout(() => setMessage(null), 4000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/almacen/stock-actual", {
        headers: { Accept: "application/json" },
      });
      const json = (await res.json().catch(() => ({}))) as ApiList;
      if (!res.ok || json.success === false) {
        throw new Error(
          apiErrorMessage(json.error ?? json, `Error HTTP ${res.status}`)
        );
      }
      setItems(json.items ?? []);
      setVisibleCount(PAGE_SIZE);
    } catch (err) {
      setItems([]);
      setError(
        err instanceof Error ? err.message : "No se pudo cargar el stock"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      if (msgTimer.current) clearTimeout(msgTimer.current);
    };
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((row) => {
      if (hideZeroStock && isZeroStock(row.stock)) return false;
      if (!q) return true;
      const codigo = asText(row.codigo).toLowerCase();
      const descripcion = asText(row.repuesto).toLowerCase();
      const ubicacion = asText(row.ubicacion).toLowerCase();
      return (
        codigo.includes(q) || descripcion.includes(q) || ubicacion.includes(q)
      );
    });
  }, [items, search, hideZeroStock]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [search, hideZeroStock]);

  const visibleRows = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount]
  );
  const hasMore = visibleCount < filtered.length;

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || !hasMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((n) =>
            Math.min(n + PAGE_SIZE, filtered.length)
          );
        }
      },
      { root, rootMargin: "120px", threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, filtered.length, visibleCount]);

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/almacen/trigger-sync-stock", {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: unknown;
      };
      if (!res.ok || json.success === false) {
        throw new Error(
          apiErrorMessage(json.error ?? json, `Error HTTP ${res.status}`)
        );
      }
      await load();
      flash("success", "Stock sincronizado con Sigma.");
    } catch (err) {
      flash(
        "error",
        err instanceof Error ? err.message : "Error al sincronizar"
      );
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div role="tabpanel" className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-3">
        <label className="block min-w-0 flex-1">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Buscar
          </span>
          <div className="relative">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar código, descripción o ubicación..."
              className="w-full rounded-xl border border-border bg-white py-2.5 pl-3 pr-9 text-sm text-foreground outline-none transition placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </label>
        <div className="flex shrink-0 items-center gap-2 lg:pb-0.5">
          <button
            type="button"
            onClick={() => setHideZeroStock((prev) => !prev)}
            aria-pressed={hideZeroStock}
            title={
              hideZeroStock
                ? "Mostrar también los ítems con stock 0"
                : "Ocultar ítems con stock 0"
            }
            className={
              hideZeroStock
                ? "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent/20"
                : "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            }
          >
            {hideZeroStock ? "Mostrar todo" : "Ocultar sin stock"}
          </button>
          {canSincronizar ? (
            <button
              type="button"
              onClick={() => void handleSync()}
              disabled={syncing || loading}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-60"
            >
              {syncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {syncing ? "Sincronizando..." : "Actualizar"}
            </button>
          ) : null}
        </div>
      </div>

      {syncing ? (
        <div className="inline-flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-1.5 text-xs font-medium text-accent">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Sincronizando...
        </div>
      ) : null}

      {message ? (
        <p
          className={`text-right text-[11px] ${
            message.type === "success" ? "text-emerald-700" : "text-red-600"
          }`}
        >
          {message.text}
        </p>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border">
        <div
          ref={scrollRef}
          className="w-full overflow-auto"
          style={{ maxHeight: "calc(100vh - 240px)" }}
        >
          <table className="min-w-[720px] w-full divide-y divide-border text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-2">Codigo</th>
                <th className="px-2 py-2">Descripcion</th>
                <th className="px-2 py-2">Ubicacion</th>
                <th className="px-2 py-2 text-right">Stock</th>
                <th className="px-2 py-2 text-right">C. Unit Inc. IGV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-muted">
                    <span className="inline-flex items-center gap-2 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin text-accent" />
                      Cargando stock…
                    </span>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-muted">
                    {items.length > 0 && (search.trim() || hideZeroStock)
                      ? "No se encontraron resultados para el filtro actual."
                      : "No hay registros de stock."}
                  </td>
                </tr>
              ) : (
                <>
                  {visibleRows.map((row, index) => (
                    <tr
                      key={`${row.codigo}:${row.ubicacion ?? ""}:${index}`}
                      className="hover:bg-accent/5"
                    >
                      <td className="px-2 py-1.5 font-semibold text-accent">
                        {row.codigo || "-"}
                      </td>
                      <td className="px-2 py-1.5">{row.repuesto || "-"}</td>
                      <td className="px-2 py-1.5">{row.ubicacion || "-"}</td>
                      <td className="px-2 py-1.5 text-right">
                        {formatStock(row.stock)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium">
                        {formatSolesIncIgv(row.costo_unitario_soles)}
                      </td>
                    </tr>
                  ))}
                  {hasMore ? (
                    <tr ref={sentinelRef}>
                      <td colSpan={5} className="px-4 py-3 text-center text-muted">
                        <span className="inline-flex items-center gap-2 text-xs">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                          Cargando más ({visibleRows.length} de {filtered.length})
                        </span>
                      </td>
                    </tr>
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-4 py-2 text-center text-[10px] text-slate-400">
                        {visibleRows.length} de {filtered.length} registros
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
