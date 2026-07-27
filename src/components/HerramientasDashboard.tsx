"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";

export type Herramienta = {
  id: number;
  codigo: string;
  descripcion: string;
  cantidad: number;
  responsable: string | null;
  ubicacion: string | null;
};

type FormState = {
  id: number | null;
  descripcion: string;
  codigo: string;
  cantidad: string;
  responsable: string;
  ubicacion: string;
};

const emptyForm: FormState = {
  id: null,
  descripcion: "",
  codigo: "",
  cantidad: "1",
  responsable: "",
  ubicacion: "",
};

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function mapHerramienta(row: Record<string, unknown>): Herramienta {
  return {
    id: Number(row.id),
    codigo: String(row.codigo ?? ""),
    descripcion: String(row.descripcion ?? ""),
    cantidad: Number(row.cantidad ?? 0),
    responsable:
      row.responsable == null || String(row.responsable).trim() === ""
        ? null
        : String(row.responsable).trim(),
    ubicacion:
      row.ubicacion == null || String(row.ubicacion).trim() === ""
        ? null
        : String(row.ubicacion).trim(),
  };
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

function findCodigoForDescripcion(
  items: Herramienta[],
  descripcion: string,
  excludeId?: number
) {
  const key = normalize(descripcion);
  if (!key) return null;
  const match = items.find(
    (item) =>
      item.id !== excludeId &&
      normalize(item.descripcion) === key &&
      item.codigo.trim() !== ""
  );
  return match?.codigo ?? null;
}

export default function HerramientasDashboard() {
  const [items, setItems] = useState<Herramienta[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterResponsable, setFilterResponsable] = useState("");
  const [filterUbicacion, setFilterUbicacion] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [codigoLocked, setCodigoLocked] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Herramienta | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchHerramientas = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from("herramientas")
      .select("*");

    if (fetchError) {
      setError(fetchError.message);
      setItems([]);
      setLoading(false);
      return;
    }

    const mapped = ((data as Record<string, unknown>[]) ?? [])
      .map(mapHerramienta)
      .sort((a, b) =>
        a.codigo.localeCompare(b.codigo, "es", { sensitivity: "base" })
      );

    setItems(mapped);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchHerramientas();
  }, [fetchHerramientas]);

  const responsables = useMemo(
    () => uniqueSorted(items.map((i) => i.responsable)),
    [items]
  );
  const ubicaciones = useMemo(
    () => uniqueSorted(items.map((i) => i.ubicacion)),
    [items]
  );

  const filtered = useMemo(() => {
    const q = normalize(search);
    return items.filter((item) => {
      const matchesSearch =
        !q ||
        normalize(item.codigo).includes(q) ||
        normalize(item.descripcion).includes(q);
      const matchesResponsable =
        !filterResponsable || item.responsable === filterResponsable;
      const matchesUbicacion =
        !filterUbicacion || item.ubicacion === filterUbicacion;
      return matchesSearch && matchesResponsable && matchesUbicacion;
    });
  }, [items, search, filterResponsable, filterUbicacion]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setCodigoLocked(false);
    setModalOpen(true);
  }

  function openEdit(item: Herramienta) {
    setEditingId(item.id);
    setForm({
      id: item.id,
      descripcion: item.descripcion ?? "",
      codigo: item.codigo ?? "",
      cantidad: String(item.cantidad ?? 1),
      responsable: item.responsable ?? "",
      ubicacion: item.ubicacion ?? "",
    });
    setFormError(null);
    setCodigoLocked(false);
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setCodigoLocked(false);
  }

  function openDeleteConfirm(item: Herramienta) {
    setDeleteError(null);
    setPendingDelete(item);
  }

  function closeDeleteModal() {
    if (deleting) return;
    setPendingDelete(null);
    setDeleteError(null);
  }

  function handleDescripcionChange(value: string) {
    const existingCodigo = findCodigoForDescripcion(
      items,
      value,
      editingId ?? undefined
    );
    if (existingCodigo) {
      setForm((prev) => ({
        ...prev,
        descripcion: value,
        codigo: existingCodigo,
      }));
      setCodigoLocked(true);
      return;
    }
    setForm((prev) => ({ ...prev, descripcion: value }));
    if (codigoLocked) setCodigoLocked(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const descripcion = form.descripcion.trim();
    const cantidad = Number(form.cantidad);
    const existingCodigo = findCodigoForDescripcion(
      items,
      descripcion,
      editingId ?? undefined
    );
    const codigo = (existingCodigo ?? form.codigo).trim();
    const responsable = form.responsable.trim() || null;
    const ubicacion = form.ubicacion.trim() || null;

    if (!descripcion) {
      setFormError("La descripción es obligatoria.");
      return;
    }
    if (!codigo) {
      setFormError("El código es obligatorio.");
      return;
    }
    if (!Number.isFinite(cantidad) || cantidad < 0) {
      setFormError("La cantidad debe ser un número válido.");
      return;
    }

    const payload = {
      codigo,
      descripcion,
      cantidad,
      responsable,
      ubicacion,
    };

    setSaving(true);

    if (editingId != null) {
      const { error: updateError } = await supabase
        .from("herramientas")
        .update({
          codigo,
          descripcion,
          cantidad,
          responsable,
          ubicacion,
        })
        .eq("id", editingId);

      if (updateError) {
        console.error("Error al actualizar herramienta:", updateError);
        setFormError(updateError.message);
        setSaving(false);
        return;
      }

      setSaving(false);
      setModalOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      setFormError(null);
      await fetchHerramientas();
      return;
    }

    const { error: insertError } = await supabase
      .from("herramientas")
      .insert(payload);

    if (insertError) {
      console.error("Error al insertar herramienta:", insertError);
      setFormError(insertError.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    setModalOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    await fetchHerramientas();
  }

  async function confirmDelete() {
    if (!pendingDelete) return;

    const id = pendingDelete.id;
    setDeleting(true);
    setDeleteError(null);

    const { error: deleteErr } = await supabase
      .from("herramientas")
      .delete()
      .eq("id", id);

    if (deleteErr) {
      console.error("Error al eliminar herramienta:", deleteErr);
      setDeleteError(deleteErr.message);
      setDeleting(false);
      return;
    }

    setDeleting(false);
    setPendingDelete(null);
    setDeleteError(null);
    await fetchHerramientas();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Herramientas</h2>
          <p className="mt-1 text-sm text-muted">
            Registros sincronizados desde{" "}
            <span className="font-mono text-xs text-emerald-700">
              public.herramientas
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-700/20 transition hover:bg-emerald-800"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Agregar
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="relative sm:col-span-2">
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
            className="w-full rounded-xl border border-border bg-white py-2.5 pl-10 pr-3 text-sm text-foreground outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Responsable
          </span>
          <select
            value={filterResponsable}
            onChange={(e) => setFilterResponsable(e.target.value)}
            className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          >
            <option value="">Todos</option>
            {responsables.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Ubicación
          </span>
          <select
            value={filterUbicacion}
            onChange={(e) => setFilterUbicacion(e.target.value)}
            className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          >
            <option value="">Todas</option>
            {ubicaciones.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
      </div>

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
                <th className="px-4 py-3 text-right">Cantidad</th>
                <th className="px-4 py-3">Responsable</th>
                <th className="px-4 py-3">Ubicación</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted">
                    <span className="inline-flex items-center gap-2 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                      Cargando herramientas…
                    </span>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted">
                    No hay registros que coincidan con los filtros.
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr
                    key={item.id}
                    className="transition hover:bg-emerald-50/40"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-emerald-800">
                      {item.codigo}
                    </td>
                    <td className="max-w-xs px-4 py-3 font-medium text-foreground">
                      {item.descripcion}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700">
                      {item.cantidad}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {item.responsable || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {item.ubicacion || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEdit(item)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-emerald-100 hover:text-emerald-700"
                          aria-label={`Editar ${item.descripcion}`}
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openDeleteConfirm(item)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                          aria-label={`Eliminar ${item.descripcion}`}
                          title="Eliminar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
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
          aria-labelledby="herramienta-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-white shadow-2xl shadow-slate-900/20">
            <div className="flex items-center justify-between border-b border-border bg-emerald-50/60 px-5 py-4">
              <h3
                id="herramienta-modal-title"
                className="text-base font-bold text-foreground"
              >
                {editingId != null
                  ? "Editar herramienta"
                  : "Agregar herramienta"}
              </h3>
              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white hover:text-slate-800 disabled:opacity-50"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSubmit(e)}
              className="space-y-4 p-5"
            >
              {editingId != null ? (
                <div className="rounded-xl border border-border bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  ID:{" "}
                  <span className="font-mono font-semibold text-slate-700">
                    {form.id}
                  </span>
                </div>
              ) : null}

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Descripción
                </span>
                <input
                  required
                  value={form.descripcion}
                  onChange={(e) => handleDescripcionChange(e.target.value)}
                  className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                  placeholder="Ej. Llave combinada 13 mm"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Código
                </span>
                <input
                  required
                  value={form.codigo}
                  onChange={(e) => {
                    setCodigoLocked(false);
                    setForm((prev) => ({ ...prev, codigo: e.target.value }));
                  }}
                  readOnly={codigoLocked}
                  className={`w-full rounded-xl border border-border px-3 py-2.5 font-mono text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 ${
                    codigoLocked ? "bg-emerald-50 text-emerald-900" : ""
                  }`}
                  placeholder="Ej. HER-001"
                />
                {codigoLocked ? (
                  <p className="mt-1.5 text-xs text-emerald-700">
                    Se reutiliza el código existente para esta descripción.
                  </p>
                ) : null}
              </label>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Cantidad
                  </span>
                  <input
                    required
                    type="number"
                    min={0}
                    step={1}
                    value={form.cantidad}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        cantidad: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                  />
                </label>

                <label className="block sm:col-span-2">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Responsable
                  </span>
                  <input
                    value={form.responsable}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        responsable: e.target.value,
                      }))
                    }
                    list="herramientas-responsables"
                    className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                    placeholder="Nombre del responsable"
                  />
                  <datalist id="herramientas-responsables">
                    {responsables.map((r) => (
                      <option key={r} value={r} />
                    ))}
                  </datalist>
                </label>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Ubicación
                </span>
                <input
                  value={form.ubicacion}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, ubicacion: e.target.value }))
                  }
                  list="herramientas-ubicaciones"
                  className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                  placeholder="Ej. Estante A-2"
                />
                <datalist id="herramientas-ubicaciones">
                  {ubicaciones.map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              </label>

              {formError ? (
                <p
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {formError}
                </p>
              ) : null}

              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-700/20 transition hover:bg-emerald-800 disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Guardando…
                    </>
                  ) : editingId != null ? (
                    "Guardar"
                  ) : (
                    "Agregar"
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
          aria-labelledby="eliminar-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDeleteModal();
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-white shadow-2xl shadow-slate-900/20">
            <div className="flex items-center justify-between border-b border-border bg-red-50/70 px-5 py-4">
              <h3
                id="eliminar-modal-title"
                className="text-base font-bold text-foreground"
              >
                Confirmar eliminación
              </h3>
              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={deleting}
                className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white hover:text-slate-800 disabled:opacity-50"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <p className="text-sm text-slate-600">
                ¿Eliminar la herramienta{" "}
                <span className="font-semibold text-foreground">
                  {pendingDelete.descripcion}
                </span>{" "}
                (
                <span className="font-mono text-xs text-emerald-800">
                  {pendingDelete.codigo}
                </span>
                )? Esta acción no se puede deshacer.
              </p>
              <p className="text-xs text-slate-400">
                Se eliminará el registro con ID{" "}
                <span className="font-mono font-semibold text-slate-600">
                  {pendingDelete.id}
                </span>
                .
              </p>

              {deleteError ? (
                <p
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {deleteError}
                </p>
              ) : null}

              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeDeleteModal}
                  disabled={deleting}
                  className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void confirmDelete()}
                  disabled={deleting}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-red-600/20 transition hover:bg-red-700 disabled:opacity-50"
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
