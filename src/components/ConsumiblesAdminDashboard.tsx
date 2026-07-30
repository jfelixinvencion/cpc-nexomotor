"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";

type Consumible = {
  id: number;
  codigo: string;
  descripcion: string;
};

type RepuestoOption = {
  codigo: string;
  repuesto: string;
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

function formatSupabaseError(error: unknown, fallback = "Error desconocido") {
  if (!error) return fallback;
  if (typeof error === "string" && error.trim()) return error;

  if (typeof error === "object") {
    const e = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };
    const parts = [
      asText(e.message),
      asText(e.details),
      asText(e.hint),
      asText(e.code) ? `code=${asText(e.code)}` : "",
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(" | ");
    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}") return json;
    } catch {
      // ignore
    }
  }

  const asString = String(error);
  return asString && asString !== "[object Object]" ? asString : fallback;
}

export default function ConsumiblesAdminDashboard() {
  const [items, setItems] = useState<Consumible[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<RepuestoOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selected, setSelected] = useState<RepuestoOption | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<Consumible | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const comboboxRef = useRef<HTMLDivElement | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from("consumibles")
      .select("id, codigo, descripcion")
      .order("codigo", { ascending: true });

    if (fetchError) {
      const message = formatSupabaseError(
        fetchError,
        "No se pudieron cargar los consumibles"
      );
      console.error("Error cargando consumibles:", message, fetchError);
      setError(message);
      setItems([]);
      setLoading(false);
      return;
    }

    setItems(
      ((data as Record<string, unknown>[]) ?? []).map((row) => ({
        id: Number(row.id),
        codigo: asText(row.codigo),
        descripcion: asText(row.descripcion),
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        comboboxRef.current &&
        !comboboxRef.current.contains(event.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    if (selected && query === `[${selected.codigo}] - ${selected.repuesto}`) {
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    const term = query.trim();
    if (term.length < 1) {
      setOptions([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(() => {
      void (async () => {
        // Evita romper el filtro .or() de PostgREST con caracteres especiales.
        const safeTerm = term.replace(/[%_,()]/g, " ").trim();
        if (!safeTerm) {
          setOptions([]);
          setSearching(false);
          return;
        }
        const pattern = `%${safeTerm}%`;
        const { data, error: searchError } = await supabase
          .from("repuestos")
          .select("codigo, repuesto")
          .or(`codigo.ilike.${pattern},repuesto.ilike.${pattern}`)
          .limit(20);

        if (searchError) {
          const message = formatSupabaseError(
            searchError,
            "No se pudo buscar en repuestos"
          );
          console.error("Error buscando repuestos:", message, searchError);
          setFormError(message);
          setOptions([]);
          setSearching(false);
          return;
        }

        setOptions(
          ((data as Record<string, unknown>[]) ?? []).map((row) => ({
            codigo: asText(row.codigo),
            repuesto: asText(row.repuesto),
          }))
        );
        setSearching(false);
        setDropdownOpen(true);
      })();
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, modalOpen, selected]);

  const filtered = useMemo(() => {
    const q = normalize(search);
    if (!q) return items;
    return items.filter((item) => {
      const haystack = normalize(`${item.codigo} ${item.descripcion}`);
      return haystack.includes(q);
    });
  }, [items, search]);

  function openCreate() {
    setModalOpen(true);
    setQuery("");
    setOptions([]);
    setSelected(null);
    setFormError(null);
    setDropdownOpen(false);
  }

  function closeCreate() {
    if (saving) return;
    setModalOpen(false);
    setQuery("");
    setOptions([]);
    setSelected(null);
    setFormError(null);
    setDropdownOpen(false);
  }

  function selectOption(option: RepuestoOption) {
    setSelected(option);
    setQuery(`[${option.codigo}] - ${option.repuesto}`);
    setDropdownOpen(false);
    setFormError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!selected) {
      setFormError("Selecciona un SKU de la lista de repuestos.");
      return;
    }

    setSaving(true);

    const { data: existing, error: existsError } = await supabase
      .from("consumibles")
      .select("id")
      .eq("codigo", selected.codigo)
      .limit(1);

    if (existsError) {
      const message = formatSupabaseError(
        existsError,
        "No se pudo validar el código"
      );
      console.error("Error validando consumible:", message, existsError);
      setFormError(message);
      setSaving(false);
      return;
    }

    if ((existing ?? []).length > 0) {
      setFormError(
        `El código ${selected.codigo} ya existe en consumibles.`
      );
      setSaving(false);
      return;
    }

    const { error: insertError } = await supabase.from("consumibles").insert({
      codigo: selected.codigo,
      descripcion: selected.repuesto,
    });

    if (insertError) {
      const message = formatSupabaseError(
        insertError,
        "No se pudo agregar el consumible"
      );
      console.error("Error insertando consumible:", message, insertError);
      setFormError(message);
      setSaving(false);
      return;
    }

    setSaving(false);
    setModalOpen(false);
    setQuery("");
    setSelected(null);
    setOptions([]);
    await loadItems();
  }

  function openDelete(item: Consumible) {
    setPendingDelete(item);
    setDeleteError(null);
  }

  function closeDelete() {
    if (deleting) return;
    setPendingDelete(null);
    setDeleteError(null);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);

    const { error: deleteErr } = await supabase
      .from("consumibles")
      .delete()
      .eq("id", pendingDelete.id);

    if (deleteErr) {
      const message = formatSupabaseError(
        deleteErr,
        "No se pudo eliminar el consumible"
      );
      console.error("Error eliminando consumible:", message, deleteErr);
      setDeleteError(message);
      setDeleting(false);
      return;
    }

    setDeleting(false);
    setPendingDelete(null);
    await loadItems();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Consumibles</h2>
          <p className="mt-1 text-sm text-muted">
            Catálogo SKU vinculado a{" "}
            <span className="font-mono text-xs text-emerald-700">
              public.consumibles
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-700/20 transition hover:bg-emerald-800"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Agregar SKU Consumible
        </button>
      </div>

      <label className="relative block max-w-xl">
        <span className="sr-only">Buscar</span>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por código o descripción…"
          className="w-full rounded-xl border border-border bg-white py-2.5 pl-10 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
        />
      </label>

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
                <th className="px-4 py-3">Código</th>
                <th className="px-4 py-3">Descripción</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white">
              {loading ? (
                <tr>
                  <td colSpan={3} className="px-4 py-12 text-center text-muted">
                    <span className="inline-flex items-center gap-2 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                      Cargando consumibles…
                    </span>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-12 text-center text-muted">
                    No hay consumibles registrados.
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-emerald-50/40">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-emerald-800">
                      {item.codigo}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {item.descripcion || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openDelete(item)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                        aria-label={`Eliminar ${item.codigo}`}
                        title="Eliminar"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
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

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="consumible-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeCreate();
          }}
        >
          <div className="w-full max-w-lg overflow-visible rounded-2xl border border-border bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-border bg-emerald-50/60 px-5 py-4">
              <h3
                id="consumible-modal-title"
                className="text-base font-bold text-foreground"
              >
                Agregar SKU Consumible
              </h3>
              <button
                type="button"
                onClick={closeCreate}
                disabled={saving}
                className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white disabled:opacity-50"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSubmit(e)}
              className="space-y-4 p-5"
            >
              <div ref={comboboxRef} className="relative">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Buscar en repuestos
                  </span>
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                      aria-hidden
                    />
                    <input
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setSelected(null);
                        setFormError(null);
                        setDropdownOpen(true);
                      }}
                      onFocus={() => {
                        if (options.length > 0) setDropdownOpen(true);
                      }}
                      placeholder="Escribe código o descripción…"
                      className={`w-full rounded-xl border px-3 py-2.5 pl-10 text-sm outline-none transition focus:ring-2 ${
                        selected
                          ? "border-emerald-400 bg-emerald-50 text-emerald-900 focus:border-emerald-500 focus:ring-emerald-500/20"
                          : "border-border bg-white focus:border-emerald-500 focus:ring-emerald-500/20"
                      }`}
                      autoComplete="off"
                    />
                    {searching ? (
                      <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-emerald-600" />
                    ) : null}
                  </div>
                </label>

                {dropdownOpen && (options.length > 0 || searching) ? (
                  <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-border bg-white py-1 shadow-lg">
                    {searching && options.length === 0 ? (
                      <li className="px-3 py-2 text-sm text-muted">
                        Buscando…
                      </li>
                    ) : (
                      options.map((option) => (
                        <li key={option.codigo}>
                          <button
                            type="button"
                            onClick={() => selectOption(option)}
                            className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition hover:bg-emerald-50"
                          >
                            <span className="shrink-0 font-mono text-xs font-semibold text-emerald-800">
                              [{option.codigo}]
                            </span>
                            <span className="text-foreground">
                              {option.repuesto || "Sin descripción"}
                            </span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                ) : null}

                {dropdownOpen &&
                !searching &&
                query.trim() &&
                options.length === 0 &&
                !selected ? (
                  <div className="absolute z-20 mt-1 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-muted shadow-lg">
                    Sin resultados en repuestos.
                  </div>
                ) : null}
              </div>

              {selected ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-sm text-emerald-900">
                  Seleccionado:{" "}
                  <span className="font-mono font-semibold">
                    {selected.codigo}
                  </span>{" "}
                  — {selected.repuesto}
                </div>
              ) : null}

              {formError ? (
                <p
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {formError}
                </p>
              ) : null}

              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeCreate}
                  disabled={saving}
                  className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving || !selected}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-700/20 transition hover:bg-emerald-800 disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Guardando…
                    </>
                  ) : (
                    "Guardar"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {pendingDelete ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="consumible-eliminar-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDelete();
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-border bg-red-50/70 px-5 py-4">
              <h3
                id="consumible-eliminar-title"
                className="text-base font-bold text-foreground"
              >
                Confirmar eliminación
              </h3>
              <button
                type="button"
                onClick={closeDelete}
                disabled={deleting}
                className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white disabled:opacity-50"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <p className="text-sm text-slate-600">
                ¿Eliminar el consumible{" "}
                <span className="font-mono font-semibold text-emerald-800">
                  {pendingDelete.codigo}
                </span>
                ?
              </p>
              <p className="text-sm text-slate-500">
                {pendingDelete.descripcion || "Sin descripción"}
              </p>

              {deleteError ? (
                <p
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {deleteError}
                </p>
              ) : null}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeDelete}
                  disabled={deleting}
                  className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void confirmDelete()}
                  disabled={deleting}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Eliminando…
                    </>
                  ) : (
                    "Sí, eliminar"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
