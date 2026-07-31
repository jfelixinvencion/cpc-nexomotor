"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  CheckCircle2,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";

type HistorialConsumible = {
  id: number;
  fecha_hora: string;
  responsable: string;
  bahia: string;
  codigo: string;
  descripcion: string;
  cantidad: number;
  aprobado: boolean;
  fecha_aprobacion: string | null;
};

type PlanillaActivo = {
  id: number;
  nombres: string;
  apellido_paterno: string;
  apellido_materno: string | null;
};

type ConsumibleOption = {
  codigo: string;
  descripcion: string;
};

type LineaSku = {
  key: string;
  query: string;
  selected: ConsumibleOption | null;
  cantidad: string;
  options: ConsumibleOption[];
  searching: boolean;
  dropdownOpen: boolean;
};

const BAHIAS = ["1", "2", "3", "4", "5"] as const;

function asText(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function asBool(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "t";
}

function fullName(p: PlanillaActivo) {
  return [p.nombres, p.apellido_paterno, p.apellido_materno]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
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

function createEmptyLine(): LineaSku {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    query: "",
    selected: null,
    cantidad: "1",
    options: [],
    searching: false,
    dropdownOpen: false,
  };
}

function bahiaBadgeClass(bahia: string) {
  const map: Record<string, string> = {
    "1": "bg-rose-100 text-rose-800 ring-rose-600/20",
    "2": "bg-pink-100 text-pink-800 ring-pink-600/20",
    "3": "bg-fuchsia-100 text-fuchsia-800 ring-fuchsia-600/20",
    "4": "bg-red-100 text-red-800 ring-red-600/20",
    "5": "bg-orange-100 text-orange-800 ring-orange-600/20",
  };
  return map[bahia] ?? "bg-slate-100 text-slate-700 ring-slate-500/20";
}

async function fetchAprobadoFlag(id: number) {
  const { data, error } = await supabase
    .from("historial_consumibles")
    .select("id, aprobado")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return { aprobado: null as boolean | null, error };
  }

  return {
    aprobado: data ? asBool((data as { aprobado?: unknown }).aprobado) : null,
    error: null,
  };
}

export default function ConsumiblesAlmacenDashboard() {
  const [historial, setHistorial] = useState<HistorialConsumible[]>([]);
  const [activos, setActivos] = useState<PlanillaActivo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [responsable, setResponsable] = useState("");
  const [bahia, setBahia] = useState("");
  const [lineas, setLineas] = useState<LineaSku[]>([createEmptyLine()]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<HistorialConsumible | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [pendingVb, setPendingVb] = useState<HistorialConsumible | null>(null);
  const [approving, setApproving] = useState(false);
  const [vbError, setVbError] = useState<string | null>(null);

  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {}
  );
  const modalTitleId = useId();

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [histRes, planRes] = await Promise.all([
      supabase
        .from("historial_consumibles")
        .select(
          "id, fecha_hora, responsable, bahia, codigo, descripcion, cantidad, aprobado, fecha_aprobacion"
        )
        .order("fecha_hora", { ascending: false }),
      supabase
        .from("planilla")
        .select("id, nombres, apellido_paterno, apellido_materno, estado")
        .eq("estado", "Activo")
        .order("nombres", { ascending: true }),
    ]);

    if (histRes.error || planRes.error) {
      const first = histRes.error || planRes.error;
      const message = formatSupabaseError(
        first,
        "No se pudieron cargar consumibles"
      );
      console.error("Error cargando historial consumibles:", message, first);
      setError(message);
      setLoading(false);
      return;
    }

    setHistorial(
      ((histRes.data as Record<string, unknown>[]) ?? []).map((row) => ({
        id: Number(row.id),
        fecha_hora: asText(row.fecha_hora),
        responsable: asText(row.responsable),
        bahia: asText(row.bahia),
        codigo: asText(row.codigo),
        descripcion: asText(row.descripcion),
        cantidad: Number(row.cantidad ?? 0),
        aprobado: asBool(row.aprobado),
        fecha_aprobacion: asText(row.fecha_aprobacion) || null,
      }))
    );

    setActivos(
      ((planRes.data as Record<string, unknown>[]) ?? []).map((row) => ({
        id: Number(row.id),
        nombres: asText(row.nombres),
        apellido_paterno: asText(row.apellido_paterno),
        apellido_materno: asText(row.apellido_materno) || null,
      }))
    );

    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    return () => {
      Object.values(debounceTimers.current).forEach((t) => clearTimeout(t));
    };
  }, []);

  function toggleSelectRow(id: number) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  function openCreateModal() {
    const selected = historial.find((h) => h.id === selectedId);
    setModalMode("create");
    setEditingId(null);
    setResponsable("");
    setBahia("");
    if (selected) {
      setLineas([
        {
          ...createEmptyLine(),
          query: `[${selected.codigo}] - ${selected.descripcion}`,
          selected: {
            codigo: selected.codigo,
            descripcion: selected.descripcion,
          },
          cantidad: String(selected.cantidad || 1),
        },
      ]);
    } else {
      setLineas([createEmptyLine()]);
    }
    setFormError(null);
    setModalOpen(true);
  }

  async function openEditModal(item: HistorialConsumible) {
    if (item.aprobado) {
      setError("Este registro ya está aprobado y no puede editarse.");
      return;
    }

    const { aprobado, error: checkError } = await fetchAprobadoFlag(item.id);
    if (checkError) {
      setError(
        formatSupabaseError(checkError, "No se pudo verificar el estado")
      );
      return;
    }
    if (aprobado === true) {
      setError("Este registro ya está aprobado y no puede editarse.");
      await loadData();
      return;
    }

    setModalMode("edit");
    setEditingId(item.id);
    setResponsable(item.responsable);
    setBahia(item.bahia);
    setLineas([
      {
        ...createEmptyLine(),
        query: `[${item.codigo}] - ${item.descripcion}`,
        selected: {
          codigo: item.codigo,
          descripcion: item.descripcion,
        },
        cantidad: String(item.cantidad || 1),
      },
    ]);
    setFormError(null);
    setSelectedId(null);
    setModalOpen(true);
  }

  function resetModalState() {
    setModalOpen(false);
    setFormError(null);
    setSelectedId(null);
    setEditingId(null);
    setModalMode("create");
    setResponsable("");
    setBahia("");
    setLineas([createEmptyLine()]);
  }

  function closeModal() {
    if (saving) return;
    resetModalState();
  }

  function updateLinea(key: string, patch: Partial<LineaSku>) {
    setLineas((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );
  }

  function addLinea() {
    if (modalMode === "edit") return;
    setLineas((prev) => [...prev, createEmptyLine()]);
  }

  function removeLinea(key: string) {
    if (modalMode === "edit") return;
    setLineas((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((line) => line.key !== key);
    });
  }

  function searchConsumibles(key: string, term: string) {
    if (debounceTimers.current[key]) {
      clearTimeout(debounceTimers.current[key]);
    }

    const trimmed = term.trim();
    if (!trimmed) {
      updateLinea(key, {
        options: [],
        searching: false,
        dropdownOpen: false,
      });
      return;
    }

    updateLinea(key, { searching: true, dropdownOpen: true });

    debounceTimers.current[key] = setTimeout(() => {
      void (async () => {
        const safeTerm = trimmed.replace(/[%_,()]/g, " ").trim();
        if (!safeTerm) {
          updateLinea(key, {
            options: [],
            searching: false,
            dropdownOpen: false,
          });
          return;
        }

        const pattern = `%${safeTerm}%`;
        const { data, error: searchError } = await supabase
          .from("consumibles")
          .select("codigo, descripcion")
          .or(`codigo.ilike.${pattern},descripcion.ilike.${pattern}`)
          .limit(10);

        if (searchError) {
          const message = formatSupabaseError(
            searchError,
            "No se pudo buscar consumibles"
          );
          console.error("Error buscando consumibles:", message, searchError);
          setFormError(message);
          updateLinea(key, {
            options: [],
            searching: false,
            dropdownOpen: true,
          });
          return;
        }

        updateLinea(key, {
          options: ((data as Record<string, unknown>[]) ?? []).map((row) => ({
            codigo: asText(row.codigo),
            descripcion: asText(row.descripcion),
          })),
          searching: false,
          dropdownOpen: true,
        });
      })();
    }, 300);
  }

  function selectSku(key: string, option: ConsumibleOption) {
    updateLinea(key, {
      selected: option,
      query: `[${option.codigo}] - ${option.descripcion}`,
      options: [],
      dropdownOpen: false,
      searching: false,
    });
    setFormError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const responsableValue = responsable.trim();
    if (!responsableValue) {
      setFormError("Selecciona un responsable.");
      return;
    }
    if (!bahia.trim() || !BAHIAS.includes(bahia as (typeof BAHIAS)[number])) {
      setFormError("Selecciona una bahía.");
      return;
    }

    const payloadLines: Array<{
      codigo: string;
      descripcion: string;
      cantidad: number;
    }> = [];

    for (const [index, line] of lineas.entries()) {
      if (!line.selected) {
        setFormError(`Selecciona un SKU en la línea ${index + 1}.`);
        return;
      }
      const cantidad = Number(line.cantidad);
      if (
        !Number.isFinite(cantidad) ||
        !Number.isInteger(cantidad) ||
        cantidad < 1
      ) {
        setFormError(
          `La cantidad de la línea ${index + 1} debe ser un entero ≥ 1.`
        );
        return;
      }
      payloadLines.push({
        codigo: line.selected.codigo,
        descripcion: line.selected.descripcion,
        cantidad,
      });
    }

    setSaving(true);

    if (modalMode === "edit" && editingId != null) {
      const { aprobado, error: checkError } = await fetchAprobadoFlag(editingId);
      if (checkError) {
        setFormError(
          formatSupabaseError(checkError, "No se pudo verificar el estado")
        );
        setSaving(false);
        return;
      }
      if (aprobado === true) {
        setFormError("Este registro ya está aprobado y no puede editarse.");
        setSaving(false);
        await loadData();
        return;
      }

      const line = payloadLines[0];
      const { error: updateError } = await supabase
        .from("historial_consumibles")
        .update({
          responsable: responsableValue,
          bahia,
          codigo: line.codigo,
          descripcion: line.descripcion,
          cantidad: line.cantidad,
        })
        .eq("id", editingId)
        .eq("aprobado", false)
        .select("id")
        .maybeSingle();

      if (updateError) {
        const message = formatSupabaseError(
          updateError,
          "No se pudo actualizar el registro"
        );
        console.error("Error actualizando historial:", message, updateError);
        setFormError(message);
        setSaving(false);
        return;
      }

      setSaving(false);
      resetModalState();
      await loadData();
      return;
    }

    const fechaHora = new Date().toISOString();
    const rows = payloadLines.map((line) => ({
      responsable: responsableValue,
      bahia,
      codigo: line.codigo,
      descripcion: line.descripcion,
      cantidad: line.cantidad,
      fecha_hora: fechaHora,
      aprobado: false,
    }));

    const { error: insertError } = await supabase
      .from("historial_consumibles")
      .insert(rows);

    if (insertError) {
      const message = formatSupabaseError(
        insertError,
        "No se pudo guardar la salida"
      );
      console.error("Error guardando salida de consumibles:", message, insertError);
      setFormError(message);
      setSaving(false);
      return;
    }

    setSaving(false);
    resetModalState();
    await loadData();
  }

  function openDeleteConfirm(item: HistorialConsumible) {
    if (item.aprobado) {
      setError("Este registro ya está aprobado y no puede eliminarse.");
      return;
    }
    setDeleteError(null);
    setPendingDelete(item);
  }

  function closeDeleteModal() {
    if (deleting) return;
    setPendingDelete(null);
    setDeleteError(null);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);

    const { aprobado, error: checkError } = await fetchAprobadoFlag(
      pendingDelete.id
    );
    if (checkError) {
      setDeleteError(
        formatSupabaseError(checkError, "No se pudo verificar el estado")
      );
      setDeleting(false);
      return;
    }
    if (aprobado === true) {
      setDeleteError("Este registro ya está aprobado y no puede eliminarse.");
      setDeleting(false);
      await loadData();
      return;
    }

    const { error: deleteErr } = await supabase
      .from("historial_consumibles")
      .delete()
      .eq("id", pendingDelete.id)
      .eq("aprobado", false);

    if (deleteErr) {
      const message = formatSupabaseError(
        deleteErr,
        "No se pudo eliminar el registro"
      );
      console.error("Error eliminando historial:", message, deleteErr);
      setDeleteError(message);
      setDeleting(false);
      return;
    }

    setDeleting(false);
    setPendingDelete(null);
    setSelectedId(null);
    await loadData();
  }

  function openVbConfirm(item: HistorialConsumible) {
    if (item.aprobado) return;
    setVbError(null);
    setPendingVb(item);
  }

  function closeVbModal() {
    if (approving) return;
    setPendingVb(null);
    setVbError(null);
  }

  async function confirmVb() {
    if (!pendingVb) return;
    setApproving(true);
    setVbError(null);

    const { aprobado, error: checkError } = await fetchAprobadoFlag(pendingVb.id);
    if (checkError) {
      setVbError(
        formatSupabaseError(checkError, "No se pudo verificar el estado")
      );
      setApproving(false);
      return;
    }
    if (aprobado === true) {
      setVbError("Este registro ya está aprobado.");
      setApproving(false);
      await loadData();
      return;
    }

    const { error: updateError } = await supabase
      .from("historial_consumibles")
      .update({
        aprobado: true,
        fecha_aprobacion: new Date().toISOString(),
      })
      .eq("id", pendingVb.id)
      .eq("aprobado", false)
      .select("id")
      .maybeSingle();

    if (updateError) {
      const message = formatSupabaseError(
        updateError,
        "No se pudo aprobar el registro"
      );
      console.error("Error aprobando historial:", message, updateError);
      setVbError(message);
      setApproving(false);
      return;
    }

    setApproving(false);
    setPendingVb(null);
    setSelectedId(null);
    await loadData();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-bold text-foreground">Consumibles</h2>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-rose-600/20 transition hover:bg-rose-700"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Agregar salida
        </button>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-rose-200/70">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Fecha/Hora</th>
                <th className="px-4 py-2.5">Responsable</th>
                <th className="px-4 py-2.5">Bahía</th>
                <th className="px-4 py-2.5">Código</th>
                <th className="px-4 py-2.5">Descripción</th>
                <th className="px-4 py-2.5 text-right">Cantidad</th>
                <th className="px-4 py-2.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-rose-600" />
                      Cargando historial…
                    </span>
                  </td>
                </tr>
              ) : historial.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted">
                    Aún no hay salidas registradas.
                  </td>
                </tr>
              ) : (
                historial.map((item) => {
                  const selected = selectedId === item.id;
                  const locked = item.aprobado;
                  return (
                    <tr
                      key={item.id}
                      onClick={() => {
                        if (!locked) toggleSelectRow(item.id);
                      }}
                      className={`transition ${
                        locked
                          ? "bg-emerald-50/40"
                          : selected
                            ? "cursor-pointer bg-rose-100/80 ring-1 ring-inset ring-rose-300"
                            : "cursor-pointer hover:bg-rose-50/60"
                      }`}
                    >
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">
                        {formatDateTime(item.fecha_hora)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">
                        {item.responsable || "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${bahiaBadgeClass(item.bahia)}`}
                        >
                          Bahía {item.bahia || "—"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs font-semibold text-rose-800">
                        {item.codigo}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-foreground">
                        {item.descripcion || "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-700">
                        {item.cantidad}
                      </td>
                      <td
                        className="whitespace-nowrap px-4 py-2.5 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {locked ? (
                          <span
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800"
                            title={
                              item.fecha_aprobacion
                                ? `Aprobado ${formatDateTime(item.fecha_aprobacion)}`
                                : "Aprobado"
                            }
                          >
                            <Lock className="h-3.5 w-3.5" aria-hidden />
                            VB
                          </span>
                        ) : (
                          <div className="inline-flex items-center justify-end gap-0.5">
                            <button
                              type="button"
                              onClick={() => void openEditModal(item)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-100 hover:text-rose-700"
                              aria-label={`Editar ${item.codigo}`}
                              title="Editar"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => openDeleteConfirm(item)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                              aria-label={`Eliminar ${item.codigo}`}
                              title="Eliminar"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => openVbConfirm(item)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-700"
                              aria-label={`Visto bueno ${item.codigo}`}
                              title="Visto Bueno"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby={modalTitleId}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-rose-50/80 px-5 py-4">
              <h3
                id={modalTitleId}
                className="text-base font-bold text-foreground"
              >
                {modalMode === "edit"
                  ? "Editar salida de consumibles"
                  : "Registrar salida de consumibles"}
              </h3>
              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white disabled:opacity-50"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSubmit(e)}
              className="space-y-5 p-5"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Responsable
                  </span>
                  <select
                    required
                    value={responsable}
                    onChange={(e) => setResponsable(e.target.value)}
                    className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
                  >
                    <option value="">Seleccionar responsable…</option>
                    {activos.map((persona) => {
                      const nombre = fullName(persona);
                      return (
                        <option key={persona.id} value={nombre}>
                          {nombre}
                        </option>
                      );
                    })}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Bahía
                  </span>
                  <select
                    required
                    value={bahia}
                    onChange={(e) => setBahia(e.target.value)}
                    className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
                  >
                    <option value="">Seleccionar bahía…</option>
                    {BAHIAS.map((b) => (
                      <option key={b} value={b}>
                        Bahía {b}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-foreground">
                    Consumibles solicitados
                  </h4>
                  {modalMode === "create" ? (
                    <button
                      type="button"
                      onClick={addLinea}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      Agregar otro SKU
                    </button>
                  ) : null}
                </div>

                <div className="space-y-3">
                  {lineas.map((line, index) => (
                    <div
                      key={line.key}
                      className="rounded-xl border border-border bg-slate-50/60 p-3"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Línea {index + 1}
                        </span>
                        {modalMode === "create" ? (
                          <button
                            type="button"
                            onClick={() => removeLinea(line.key)}
                            disabled={lineas.length <= 1}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                            aria-label={`Eliminar línea ${index + 1}`}
                            title="Eliminar línea"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>

                      <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
                        <div className="relative">
                          <label className="block">
                            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                              SKU
                            </span>
                            <div className="relative">
                              <Search
                                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                                aria-hidden
                              />
                              <input
                                value={line.query}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  updateLinea(line.key, {
                                    query: value,
                                    selected: null,
                                  });
                                  searchConsumibles(line.key, value);
                                }}
                                onFocus={() => {
                                  if (line.options.length > 0) {
                                    updateLinea(line.key, {
                                      dropdownOpen: true,
                                    });
                                  }
                                }}
                                placeholder="Buscar código o descripción…"
                                className={`w-full rounded-xl border py-2.5 pl-10 pr-3 text-sm outline-none transition focus:ring-2 ${
                                  line.selected
                                    ? "border-rose-300 bg-rose-50 text-rose-900 focus:border-rose-500 focus:ring-rose-500/20"
                                    : "border-border bg-white focus:border-rose-500 focus:ring-rose-500/20"
                                }`}
                                autoComplete="off"
                              />
                              {line.searching ? (
                                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-rose-600" />
                              ) : null}
                            </div>
                          </label>

                          {line.dropdownOpen &&
                          (line.options.length > 0 || line.searching) ? (
                            <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-xl border border-border bg-white py-1 shadow-lg">
                              {line.searching && line.options.length === 0 ? (
                                <li className="px-3 py-2 text-sm text-muted">
                                  Buscando…
                                </li>
                              ) : (
                                line.options.map((option) => (
                                  <li key={`${line.key}-${option.codigo}`}>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        selectSku(line.key, option)
                                      }
                                      className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition hover:bg-rose-50"
                                    >
                                      <span className="shrink-0 font-mono text-xs font-semibold text-rose-800">
                                        [{option.codigo}]
                                      </span>
                                      <span className="text-foreground">
                                        {option.descripcion ||
                                          "Sin descripción"}
                                      </span>
                                    </button>
                                  </li>
                                ))
                              )}
                            </ul>
                          ) : null}
                        </div>

                        <label className="block">
                          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Cantidad
                          </span>
                          <input
                            required
                            type="number"
                            min={1}
                            step={1}
                            value={line.cantidad}
                            onChange={(e) =>
                              updateLinea(line.key, {
                                cantidad: e.target.value,
                              })
                            }
                            className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

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
                  onClick={closeModal}
                  disabled={saving}
                  className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving || !responsable.trim() || !bahia.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-rose-600/20 transition hover:bg-rose-700 disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Guardando…
                    </>
                  ) : modalMode === "edit" ? (
                    "Guardar cambios"
                  ) : (
                    "Guardar salida"
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
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDeleteModal();
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-border bg-red-50/70 px-5 py-4">
              <h3 className="text-base font-bold text-foreground">
                Confirmar eliminación
              </h3>
              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={deleting}
                className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white disabled:opacity-50"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <p className="text-sm text-slate-600">
                ¿Eliminar{" "}
                <span className="font-mono font-semibold text-rose-800">
                  {pendingDelete.codigo}
                </span>{" "}
                — {pendingDelete.descripcion}?
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

      {pendingVb ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeVbModal();
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-border bg-emerald-50/70 px-5 py-4">
              <h3 className="text-base font-bold text-foreground">
                Confirmar Visto Bueno
              </h3>
              <button
                type="button"
                onClick={closeVbModal}
                disabled={approving}
                className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white disabled:opacity-50"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <p className="text-sm text-slate-600">
                ¿Confirmar Visto Bueno? Una vez aprobado, el registro no podrá
                ser editado ni eliminado.
              </p>
              <p className="text-sm text-slate-500">
                <span className="font-mono font-semibold text-rose-800">
                  {pendingVb.codigo}
                </span>{" "}
                — {pendingVb.descripcion}
              </p>
              {vbError ? (
                <p
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {vbError}
                </p>
              ) : null}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeVbModal}
                  disabled={approving}
                  className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void confirmVb()}
                  disabled={approving}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {approving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Aprobando…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Confirmar VB
                    </>
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
