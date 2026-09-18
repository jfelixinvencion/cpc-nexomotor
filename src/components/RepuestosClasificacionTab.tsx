"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, RefreshCw, X } from "lucide-react";
import { usePermisos } from "@/lib/auth/usePermisos";
import {
  OBSOLESCENCIA_VALUES,
  TIPO_SKU_VALUES,
  parseRepuestoDate,
  type Obsolescencia,
  type RepuestoClasificacionRow,
  type TipoSku,
} from "@/lib/repuestos-clasificacion";

const PAGE_SIZE = 50;
const TEXT_SAVE_MS = 450;

type SaveStatus = "idle" | "saving" | "saved" | "error";
type EditableField = "tipo_sku" | "categoria" | "sub_categoria" | "obsolescencia";

type ApiList = {
  success?: boolean;
  error?: unknown;
  items?: RepuestoClasificacionRow[];
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

function formatStock(value: number | string | null | undefined) {
  if (value == null || value === "") return "-";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return String(n);
}

function formatSoles(value: number | string | null | undefined) {
  if (value == null || value === "") return "-";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "-";
  return `S/ ${n.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatFecha(value: string | null | undefined) {
  const d = parseRepuestoDate(value);
  if (!d) return value ? String(value) : "-";
  return d.toLocaleDateString("es-PE");
}

function formatEmptyNumber(value: number | string | null | undefined) {
  if (value == null || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("es-PE", {
    maximumFractionDigits: 2,
  });
}

function SaveHint({ status }: { status: SaveStatus }) {
  if (status === "saving") {
    return <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent" />;
  }
  if (status === "saved") {
    return <Check className="h-3 w-3 shrink-0 text-emerald-600" />;
  }
  if (status === "error") {
    return (
      <span className="text-[10px] font-semibold text-red-600" title="Error al guardar">
        !
      </span>
    );
  }
  return null;
}

type SelectCellProps = {
  value: string | null;
  options: readonly string[];
  status: SaveStatus;
  onSave: (next: string | null) => void;
};

function SelectCell({ value, options, status, onSave }: SelectCellProps) {
  return (
    <div className="flex items-center gap-1">
      <select
        value={value ?? ""}
        disabled={status === "saving"}
        onChange={(e) => onSave(e.target.value === "" ? null : e.target.value)}
        className="w-full min-w-[7.5rem] rounded-md border border-border bg-white px-1.5 py-1 text-xs text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 disabled:opacity-60"
      >
        <option value="">—</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      <SaveHint status={status} />
    </div>
  );
}

type TextCellProps = {
  value: string | null;
  status: SaveStatus;
  onSave: (next: string | null) => void;
};

function TextCell({ value, status, onSave }: TextCellProps) {
  const [draft, setDraft] = useState(value ?? "");
  const lastSaved = useRef(value ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraft(value ?? "");
    lastSaved.current = value ?? "";
  }, [value]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function commit(next: string) {
    const trimmed = next.trim();
    const normalized = trimmed === "" ? "" : trimmed;
    if (normalized === lastSaved.current) return;
    lastSaved.current = normalized;
    onSave(normalized === "" ? null : normalized);
  }

  function handleChange(next: string) {
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(next), TEXT_SAVE_MS);
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        value={draft}
        disabled={status === "saving"}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => {
          if (timer.current) clearTimeout(timer.current);
          commit(draft);
        }}
        className="w-full min-w-[6.5rem] rounded-md border border-border bg-white px-1.5 py-1 text-xs text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 disabled:opacity-60"
      />
      <SaveHint status={status} />
    </div>
  );
}

export default function RepuestosClasificacionTab() {
  const { puede } = usePermisos();
  const canEditar = puede("administracion", "repuestos", "editar");
  const [items, setItems] = useState<RepuestoClasificacionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [saveStatus, setSaveStatus] = useState<Record<string, SaveStatus>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLTableRowElement | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const flash = useCallback((type: "success" | "error", text: string) => {
    if (msgTimer.current) clearTimeout(msgTimer.current);
    setMessage({ type, text });
    msgTimer.current = setTimeout(() => setMessage(null), 4000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/administracion/repuestos-clasificacion", {
        credentials: "include",
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
        err instanceof Error
          ? err.message
          : "No se pudo cargar la clasificación de repuestos"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const saved = savedTimers.current;
    return () => {
      if (msgTimer.current) clearTimeout(msgTimer.current);
      for (const timer of Object.values(saved)) clearTimeout(timer);
    };
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((row) => {
      return (
        asText(row.codigo).toLowerCase().includes(q) ||
        asText(row.descripcion).toLowerCase().includes(q) ||
        asText(row.tipo_sku).toLowerCase().includes(q) ||
        asText(row.categoria).toLowerCase().includes(q) ||
        asText(row.sub_categoria).toLowerCase().includes(q)
      );
    });
  }, [items, search]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [search]);

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
          setVisibleCount((n) => Math.min(n + PAGE_SIZE, filtered.length));
        }
      },
      { root, rootMargin: "120px", threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, filtered.length, visibleCount]);

  function statusKey(codigo: string, field: EditableField) {
    return `${codigo}:${field}`;
  }

  const saveField = useCallback(
    async (codigo: string, field: EditableField, value: string | null) => {
      const key = statusKey(codigo, field);
      if (savedTimers.current[key]) {
        clearTimeout(savedTimers.current[key]);
        delete savedTimers.current[key];
      }
      setSaveStatus((prev) => ({ ...prev, [key]: "saving" }));
      try {
        const res = await fetch(
          `/api/administracion/repuestos-clasificacion/${encodeURIComponent(codigo)}`,
          {
            method: "PATCH",
            credentials: "include",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ [field]: value }),
          }
        );
        const json = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          error?: unknown;
        };
        if (!res.ok || json.success === false) {
          throw new Error(
            apiErrorMessage(json.error ?? json, `Error HTTP ${res.status}`)
          );
        }
        setItems((prev) =>
          prev.map((row) =>
            row.codigo === codigo
              ? {
                  ...row,
                  [field]:
                    field === "tipo_sku"
                      ? ((value as TipoSku | null) ?? null)
                      : field === "obsolescencia"
                        ? ((value as Obsolescencia | null) ?? null)
                        : value,
                }
              : row
          )
        );
        setSaveStatus((prev) => ({ ...prev, [key]: "saved" }));
        savedTimers.current[key] = setTimeout(() => {
          setSaveStatus((prev) => ({ ...prev, [key]: "idle" }));
          delete savedTimers.current[key];
        }, 1200);
      } catch (err) {
        setSaveStatus((prev) => ({ ...prev, [key]: "error" }));
        flash(
          "error",
          err instanceof Error ? err.message : "No se pudo guardar"
        );
      }
    },
    [flash]
  );

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch(
        "/api/administracion/repuestos-clasificacion/sync-nuevos",
        {
          method: "POST",
          credentials: "include",
          headers: { Accept: "application/json" },
        }
      );
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: unknown;
        inserted?: number;
      };
      if (!res.ok || json.success === false) {
        throw new Error(
          apiErrorMessage(json.error ?? json, `Error HTTP ${res.status}`)
        );
      }
      await load();
      const inserted = Number(json.inserted ?? 0);
      flash(
        "success",
        inserted > 0
          ? `${inserted} código${inserted === 1 ? "" : "s"} nuevo${inserted === 1 ? "" : "s"} agregado${inserted === 1 ? "" : "s"}`
          : "No hay códigos nuevos"
      );
    } catch (err) {
      flash(
        "error",
        err instanceof Error ? err.message : "Error al actualizar"
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
              placeholder="Buscar código, descripción, tipo, categoría o sub categoría..."
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
        {canEditar ? (
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
            {syncing ? "Actualizando..." : "Actualizar"}
          </button>
        ) : null}
      </div>

      {syncing ? (
        <div className="inline-flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-1.5 text-xs font-medium text-accent">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Actualizando...
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
          style={{ maxHeight: "calc(100vh - 280px)" }}
        >
          <table className="min-w-[1280px] w-full divide-y divide-border text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-2">Código</th>
                <th className="px-2 py-2">Descripción</th>
                <th className="px-2 py-2 text-right">Stock</th>
                <th className="px-2 py-2">Último Egreso</th>
                <th className="px-2 py-2 text-right">Costo Unitario</th>
                <th className="px-2 py-2">Tipo SKU</th>
                <th className="px-2 py-2">Categoría</th>
                <th className="px-2 py-2">Sub Categoría</th>
                <th className="px-2 py-2">Rotación</th>
                <th className="px-2 py-2">Obsolescencia</th>
                <th className="px-2 py-2 text-right">Consumo Prom. día</th>
                <th className="px-2 py-2">Proveedor</th>
                <th className="px-2 py-2 text-right">Stock Out (días)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white">
              {loading ? (
                <tr>
                  <td colSpan={13} className="px-4 py-12 text-center text-muted">
                    <span className="inline-flex items-center gap-2 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin text-accent" />
                      Cargando repuestos…
                    </span>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-4 py-12 text-center text-muted">
                    {search.trim()
                      ? "No se encontraron resultados para el filtro actual."
                      : "No hay registros de repuestos."}
                  </td>
                </tr>
              ) : (
                <>
                  {visibleRows.map((row, index) => {
                    const tipoKey = statusKey(row.codigo, "tipo_sku");
                    const catKey = statusKey(row.codigo, "categoria");
                    const subKey = statusKey(row.codigo, "sub_categoria");
                    const obsKey = statusKey(row.codigo, "obsolescencia");
                    return (
                      <tr
                        key={`${row.codigo}:${index}`}
                        className="hover:bg-accent/5"
                      >
                        <td className="px-2 py-1.5 font-semibold text-accent">
                          {row.codigo || "-"}
                        </td>
                        <td className="px-2 py-1.5">{row.descripcion || "-"}</td>
                        <td className="px-2 py-1.5 text-right">
                          {formatStock(row.stock)}
                        </td>
                        <td className="px-2 py-1.5">
                          {formatFecha(row.ultimo_egreso)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-medium">
                          {formatSoles(row.costo_unitario_soles)}
                        </td>
                        <td className="px-2 py-1.5">
                          {canEditar ? (
                            <SelectCell
                              value={row.tipo_sku}
                              options={TIPO_SKU_VALUES}
                              status={saveStatus[tipoKey] ?? "idle"}
                              onSave={(next) =>
                                void saveField(row.codigo, "tipo_sku", next)
                              }
                            />
                          ) : (
                            row.tipo_sku || "-"
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {canEditar ? (
                            <TextCell
                              value={row.categoria}
                              status={saveStatus[catKey] ?? "idle"}
                              onSave={(next) =>
                                void saveField(row.codigo, "categoria", next)
                              }
                            />
                          ) : (
                            row.categoria || "-"
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {canEditar ? (
                            <TextCell
                              value={row.sub_categoria}
                              status={saveStatus[subKey] ?? "idle"}
                              onSave={(next) =>
                                void saveField(row.codigo, "sub_categoria", next)
                              }
                            />
                          ) : (
                            row.sub_categoria || "-"
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <span
                            className={
                              row.rotacion === "Con Rotación"
                                ? "inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"
                                : "inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600"
                            }
                          >
                            {row.rotacion}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          {canEditar ? (
                            <SelectCell
                              value={row.obsolescencia}
                              options={OBSOLESCENCIA_VALUES}
                              status={saveStatus[obsKey] ?? "idle"}
                              onSave={(next) =>
                                void saveField(row.codigo, "obsolescencia", next)
                              }
                            />
                          ) : (
                            row.obsolescencia || "-"
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {formatEmptyNumber(row.consumo_prom_dia)}
                        </td>
                        <td className="px-2 py-1.5">{row.proveedor || "-"}</td>
                        <td className="px-2 py-1.5 text-right">
                          {formatEmptyNumber(row.stock_out_dias)}
                        </td>
                      </tr>
                    );
                  })}
                  {hasMore ? (
                    <tr ref={sentinelRef}>
                      <td
                        colSpan={13}
                        className="px-4 py-3 text-center text-muted"
                      >
                        <span className="inline-flex items-center gap-2 text-xs">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                          Cargando más ({visibleRows.length} de {filtered.length})
                        </span>
                      </td>
                    </tr>
                  ) : (
                    <tr>
                      <td
                        colSpan={13}
                        className="px-4 py-2 text-center text-[10px] text-slate-400"
                      >
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
