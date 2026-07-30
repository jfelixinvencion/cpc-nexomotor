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

export type PlanillaRow = {
  id: number;
  tipo_documento: string | null;
  documento: string;
  nombres: string;
  apellido_paterno: string;
  apellido_materno: string | null;
  estado: string;
  tipo: string | null;
  local: string | null;
};

type FormState = {
  id: number | null;
  tipo_documento: string;
  documento: string;
  nombres: string;
  apellido_paterno: string;
  apellido_materno: string;
  estado: string;
  tipo: string;
  local: string;
};

const emptyForm: FormState = {
  id: null,
  tipo_documento: "DNI",
  documento: "",
  nombres: "",
  apellido_paterno: "",
  apellido_materno: "",
  estado: "Activo",
  tipo: "",
  local: "",
};

const ESTADO_OPTIONS = ["Activo", "Inactivo"] as const;

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function asText(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function asNullable(value: unknown) {
  const text = asText(value);
  return text === "" ? null : text;
}

function mapPlanilla(row: Record<string, unknown>): PlanillaRow {
  const tipoDocumento =
    row.tipo_documento ??
    row.tipo_doc ??
    row.tipodocumento ??
    row.doc_tipo ??
    null;

  return {
    id: Number(row.id),
    tipo_documento: asNullable(tipoDocumento),
    documento: asText(row.documento),
    nombres: asText(row.nombres),
    apellido_paterno: asText(row.apellido_paterno),
    apellido_materno: asNullable(row.apellido_materno),
    estado: asText(row.estado) || "Activo",
    tipo: asNullable(row.tipo),
    local: asNullable(row.local),
  };
}

function fullName(item: PlanillaRow) {
  return [item.nombres, item.apellido_paterno, item.apellido_materno]
    .filter(Boolean)
    .join(" ");
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

function estadoBadgeClass(estado: string) {
  const key = normalize(estado);
  if (key === "activo") {
    return "bg-emerald-100 text-emerald-800 ring-emerald-600/20";
  }
  if (key === "inactivo") {
    return "bg-slate-200 text-slate-700 ring-slate-500/20";
  }
  return "bg-amber-100 text-amber-800 ring-amber-600/20";
}

export default function PlanillaDashboard() {
  const [items, setItems] = useState<PlanillaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterEstado, setFilterEstado] = useState("");
  const [filterTipo, setFilterTipo] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PlanillaRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchPlanilla = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from("planilla")
      .select("*");

    if (fetchError) {
      console.error("Error al cargar planilla:", fetchError);
      setError(fetchError.message);
      setItems([]);
      setLoading(false);
      return;
    }

    const mapped = ((data as Record<string, unknown>[]) ?? [])
      .map(mapPlanilla)
      .sort((a, b) =>
        fullName(a).localeCompare(fullName(b), "es", { sensitivity: "base" })
      );

    setItems(mapped);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchPlanilla();
  }, [fetchPlanilla]);

  const tipos = useMemo(
    () => uniqueSorted(items.map((i) => i.tipo)),
    [items]
  );

  const filtered = useMemo(() => {
    const q = normalize(search);
    const tokens = q.split(/\s+/).filter(Boolean);

    return items.filter((item) => {
      const matchesEstado =
        !filterEstado ||
        normalize(item.estado) === normalize(filterEstado);
      const matchesTipo = !filterTipo || item.tipo === filterTipo;

      if (!matchesEstado || !matchesTipo) return false;
      if (tokens.length === 0) return true;

      const haystack = normalize(
        [
          item.documento,
          item.nombres,
          item.apellido_paterno,
          item.apellido_materno ?? "",
          fullName(item),
        ].join(" ")
      );

      return tokens.every((token) => haystack.includes(token));
    });
  }, [items, search, filterEstado, filterTipo]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(item: PlanillaRow) {
    setEditingId(item.id);
    setForm({
      id: item.id,
      tipo_documento: item.tipo_documento ?? "DNI",
      documento: item.documento ?? "",
      nombres: item.nombres ?? "",
      apellido_paterno: item.apellido_paterno ?? "",
      apellido_materno: item.apellido_materno ?? "",
      estado: item.estado || "Activo",
      tipo: item.tipo ?? "",
      local: item.local ?? "",
    });
    setFormError(null);
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
  }

  function openDeleteConfirm(item: PlanillaRow) {
    setDeleteError(null);
    setPendingDelete(item);
  }

  function closeDeleteModal() {
    if (deleting) return;
    setPendingDelete(null);
    setDeleteError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const payload = {
      tipo_documento: form.tipo_documento.trim() || null,
      documento: form.documento.trim(),
      nombres: form.nombres.trim(),
      apellido_paterno: form.apellido_paterno.trim(),
      apellido_materno: form.apellido_materno.trim() || null,
      estado: form.estado.trim() || "Activo",
      tipo: form.tipo.trim() || null,
      local: form.local.trim() || null,
    };

    if (!payload.documento) {
      setFormError("El documento es obligatorio.");
      return;
    }
    if (!payload.nombres) {
      setFormError("Los nombres son obligatorios.");
      return;
    }
    if (!payload.apellido_paterno) {
      setFormError("El apellido paterno es obligatorio.");
      return;
    }

    setSaving(true);

    if (editingId != null) {
      const { error: updateError } = await supabase
        .from("planilla")
        .update(payload)
        .eq("id", editingId)
        .select("id")
        .single();

      if (updateError) {
        console.error("Error al actualizar planilla:", updateError);
        setFormError(updateError.message);
        setSaving(false);
        return;
      }
    } else {
      const { error: insertError } = await supabase
        .from("planilla")
        .insert(payload)
        .select("id")
        .single();

      if (insertError) {
        console.error("Error al insertar planilla:", insertError);
        setFormError(insertError.message);
        setSaving(false);
        return;
      }
    }

    await fetchPlanilla();
    setSaving(false);
    setModalOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;

    const id = pendingDelete.id;
    setDeleting(true);
    setDeleteError(null);

    const { error: deleteErr } = await supabase
      .from("planilla")
      .delete()
      .eq("id", id)
      .select("id")
      .single();

    if (deleteErr) {
      console.error("Error al eliminar planilla:", deleteErr);
      setDeleteError(deleteErr.message);
      setDeleting(false);
      return;
    }

    await fetchPlanilla();
    setDeleting(false);
    setPendingDelete(null);
    setDeleteError(null);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Planilla</h2>
          <p className="mt-1 text-sm text-muted">
            Personal vinculado a{" "}
            <span className="font-mono text-xs text-emerald-700">
              public.planilla
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
            placeholder="Buscar por documento, nombres o apellidos…"
            className="w-full rounded-xl border border-border bg-white py-2.5 pl-10 pr-3 text-sm text-foreground outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Estado
          </span>
          <select
            value={filterEstado}
            onChange={(e) => setFilterEstado(e.target.value)}
            className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          >
            <option value="">Todos</option>
            {ESTADO_OPTIONS.map((estado) => (
              <option key={estado} value={estado}>
                {estado}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Tipo
          </span>
          <select
            value={filterTipo}
            onChange={(e) => setFilterTipo(e.target.value)}
            className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          >
            <option value="">Todos</option>
            {tipos.map((tipo) => (
              <option key={tipo} value={tipo}>
                {tipo}
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
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Documento</th>
                <th className="px-4 py-3">Nombre completo</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Local</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted">
                    <span className="inline-flex items-center gap-2 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                      Cargando planilla…
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
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${estadoBadgeClass(item.estado)}`}
                      >
                        {item.estado}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="font-mono text-xs font-semibold text-emerald-800">
                        {item.documento}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {item.tipo_documento || "—"}
                      </div>
                    </td>
                    <td className="max-w-xs px-4 py-3 font-medium text-foreground">
                      {fullName(item)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {item.tipo || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {item.local || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEdit(item)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-emerald-100 hover:text-emerald-700"
                          aria-label={`Editar ${fullName(item)}`}
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openDeleteConfirm(item)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                          aria-label={`Eliminar ${fullName(item)}`}
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
          aria-labelledby="planilla-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-white shadow-2xl shadow-slate-900/20">
            <div className="sticky top-0 flex items-center justify-between border-b border-border bg-emerald-50/60 px-5 py-4">
              <h3
                id="planilla-modal-title"
                className="text-base font-bold text-foreground"
              >
                {editingId != null ? "Editar registro" : "Agregar registro"}
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

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Tipo doc.
                  </span>
                  <input
                    value={form.tipo_documento}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        tipo_documento: e.target.value,
                      }))
                    }
                    list="planilla-tipos-documento"
                    className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                    placeholder="DNI"
                  />
                  <datalist id="planilla-tipos-documento">
                    <option value="DNI" />
                    <option value="CE" />
                    <option value="PAS" />
                    <option value="RUC" />
                  </datalist>
                </label>

                <label className="block sm:col-span-2">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Documento
                  </span>
                  <input
                    required
                    value={form.documento}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        documento: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-border px-3 py-2.5 font-mono text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                    placeholder="Número de documento"
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Nombres
                </span>
                <input
                  required
                  value={form.nombres}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, nombres: e.target.value }))
                  }
                  className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Apellido paterno
                  </span>
                  <input
                    required
                    value={form.apellido_paterno}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        apellido_paterno: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Apellido materno
                  </span>
                  <input
                    value={form.apellido_materno}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        apellido_materno: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Estado
                  </span>
                  <select
                    value={form.estado}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, estado: e.target.value }))
                    }
                    className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                  >
                    {ESTADO_OPTIONS.map((estado) => (
                      <option key={estado} value={estado}>
                        {estado}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Tipo
                  </span>
                  <input
                    value={form.tipo}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, tipo: e.target.value }))
                    }
                    list="planilla-tipos"
                    className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                    placeholder="Ej. Operario"
                  />
                  <datalist id="planilla-tipos">
                    {tipos.map((tipo) => (
                      <option key={tipo} value={tipo} />
                    ))}
                  </datalist>
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Local
                  </span>
                  <input
                    value={form.local}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, local: e.target.value }))
                    }
                    className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                    placeholder="Ej. Taller"
                  />
                </label>
              </div>

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
          aria-labelledby="planilla-eliminar-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDeleteModal();
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-white shadow-2xl shadow-slate-900/20">
            <div className="flex items-center justify-between border-b border-border bg-red-50/70 px-5 py-4">
              <h3
                id="planilla-eliminar-title"
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
                ¿Eliminar a{" "}
                <span className="font-semibold text-foreground">
                  {fullName(pendingDelete)}
                </span>{" "}
                (
                <span className="font-mono text-xs text-emerald-800">
                  {pendingDelete.documento}
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
