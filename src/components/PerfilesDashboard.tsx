"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Ban,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  Search,
  X,
} from "lucide-react";
import { adminFetch, formatDateTime } from "@/lib/auth/admin-fetch";
import {
  hasPermission,
  PERMISSION_CATALOG,
  permisoKey,
  type PermisoItem,
} from "@/lib/auth/permissions";

export type PerfilListItem = {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  usuariosAsignados: number;
};

type PerfilDetalle = {
  perfil: {
    id: string;
    nombre: string;
    descripcion: string | null;
    activo: boolean;
  };
  permisos: Array<PermisoItem & { permitido: boolean }>;
  usuariosAsignados: number;
};

function allowedKeysFromPermisos(
  permisos: Array<PermisoItem & { permitido?: boolean }>
): Set<string> {
  const keys = new Set<string>();
  for (const item of permisos) {
    if (item.permitido === false) continue;
    keys.add(permisoKey(item.modulo, item.pestana, item.accion));
  }
  return keys;
}

function keysToPayload(keys: Set<string>): PermisoItem[] {
  const payload: PermisoItem[] = [];
  for (const mod of PERMISSION_CATALOG) {
    for (const tab of mod.pestanas) {
      for (const act of tab.acciones) {
        const key = permisoKey(mod.modulo, tab.pestana, act.accion);
        if (keys.has(key)) {
          payload.push({
            modulo: mod.modulo,
            pestana: tab.pestana,
            accion: act.accion,
          });
        }
      }
    }
  }
  return payload;
}

export default function PerfilesDashboard({
  sessionOk,
  sessionExpired,
  isLegacy,
  permisos,
}: {
  sessionOk: boolean;
  sessionExpired: boolean;
  isLegacy: boolean;
  permisos: PermisoItem[];
}) {
  const canVer = hasPermission(permisos, "administracion", "perfiles", "ver");
  const canCrear = hasPermission(permisos, "administracion", "perfiles", "crear");
  const canEditar = hasPermission(permisos, "administracion", "perfiles", "editar");
  const canDesactivar = hasPermission(
    permisos,
    "administracion",
    "perfiles",
    "desactivar"
  );

  const [items, setItems] = useState<PerfilListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingToggle, setPendingToggle] = useState<PerfilListItem | null>(null);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const fetchPerfiles = useCallback(async () => {
    if (!sessionOk || !canVer) return;
    setLoading(true);
    setError(null);
    const result = await adminFetch<PerfilListItem[]>("/api/perfiles");
    if (!result.ok) {
      setError(result.error);
      setItems([]);
      setLoading(false);
      return;
    }
    setItems(Array.isArray(result.data) ? result.data : []);
    setLoading(false);
  }, [sessionOk, canVer]);

  useEffect(() => {
    void fetchPerfiles();
  }, [fetchPerfiles]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      [item.nombre, item.descripcion ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [items, search]);

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setEditingId(null);
    setFormError(null);
  }

  function openCreate() {
    setEditingId(null);
    setNombre("");
    setDescripcion("");
    setSelectedKeys(new Set());
    setFormError(null);
    setModalOpen(true);
  }

  async function openEdit(item: PerfilListItem) {
    setFormError(null);
    setEditingId(item.id);
    setNombre(item.nombre);
    setDescripcion(item.descripcion ?? "");
    setSelectedKeys(new Set());
    setModalOpen(true);
    const result = await adminFetch<PerfilDetalle>(`/api/perfiles/${item.id}`);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setNombre(result.data.perfil.nombre);
    setDescripcion(result.data.perfil.descripcion ?? "");
    setSelectedKeys(allowedKeysFromPermisos(result.data.permisos));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = nombre.trim();
    if (!trimmed) {
      setFormError("El nombre del perfil es obligatorio.");
      return;
    }
    setSaving(true);
    setFormError(null);
    const payload = {
      nombre: trimmed,
      descripcion: descripcion.trim(),
      permisos: keysToPayload(selectedKeys).map((item) => ({
        ...item,
        permitido: true,
      })),
    };
    const result = editingId
      ? await adminFetch<PerfilDetalle>(`/api/perfiles/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        })
      : await adminFetch<PerfilDetalle>("/api/perfiles", {
          method: "POST",
          body: JSON.stringify(payload),
        });
    setSaving(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setModalOpen(false);
    setEditingId(null);
    await fetchPerfiles();
  }

  async function confirmToggle() {
    if (!pendingToggle) return;
    setToggling(true);
    setToggleError(null);
    const result = await adminFetch<PerfilDetalle>(
      `/api/perfiles/${pendingToggle.id}`,
      {
        method: pendingToggle.activo ? "DELETE" : "PATCH",
        body: pendingToggle.activo
          ? undefined
          : JSON.stringify({ activo: true }),
      }
    );
    setToggling(false);
    if (!result.ok) {
      setToggleError(result.error);
      return;
    }
    setPendingToggle(null);
    await fetchPerfiles();
  }

  if (sessionExpired) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
      >
        La sesión expiró. Vuelva a iniciar sesión con su usuario real para
        gestionar perfiles.
      </div>
    );
  }

  if (isLegacy) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        La gestión de perfiles requiere el inicio de sesión real. El acceso
        legacy Admin / NexoMotor no asigna permisos de administración.
      </div>
    );
  }

  if (!sessionOk) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
        Verificando sesión…
      </div>
    );
  }

  if (!canVer) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
      >
        No tiene permiso para ver perfiles.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Perfiles</h2>
          <p className="mt-1 text-sm text-muted">
            Roles y matriz de permisos del sistema.
          </p>
        </div>
        {canCrear ? (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-700/20 transition hover:bg-emerald-800"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Nuevo perfil
          </button>
        ) : null}
      </div>

      <label className="relative block max-w-md">
        <span className="sr-only">Buscar perfiles</span>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre o descripción…"
          className="w-full rounded-xl border border-border bg-white py-2.5 pl-10 pr-3 text-sm text-foreground outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
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
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Descripción</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Usuarios</th>
                <th className="px-4 py-3">Actualizado</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted">
                    <span className="inline-flex items-center gap-2 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                      Cargando perfiles…
                    </span>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted">
                    No hay perfiles para mostrar.
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr
                    key={item.id}
                    className="transition hover:bg-emerald-50/40"
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      {item.nombre}
                    </td>
                    <td className="max-w-xs px-4 py-3 text-slate-600">
                      {item.descripcion || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                          item.activo
                            ? "bg-emerald-100 text-emerald-800 ring-emerald-600/20"
                            : "bg-slate-200 text-slate-700 ring-slate-500/20"
                        }`}
                      >
                        {item.activo ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {item.usuariosAsignados}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {formatDateTime(item.updatedAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {canEditar ? (
                          <button
                            type="button"
                            onClick={() => void openEdit(item)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-emerald-100 hover:text-emerald-700"
                            aria-label={`Editar ${item.nombre}`}
                            title="Editar"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        ) : null}
                        {item.activo && canDesactivar ? (
                          <button
                            type="button"
                            onClick={() => {
                              setToggleError(null);
                              setPendingToggle(item);
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                            aria-label={`Desactivar ${item.nombre}`}
                            title="Desactivar"
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        ) : null}
                        {!item.activo && canEditar ? (
                          <button
                            type="button"
                            onClick={() => {
                              setToggleError(null);
                              setPendingToggle(item);
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-emerald-100 hover:text-emerald-700"
                            aria-label={`Activar ${item.nombre}`}
                            title="Activar"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                        ) : null}
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
            {filtered.length} de {items.length} perfil
            {items.length === 1 ? "" : "es"}
          </div>
        ) : null}
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="perfil-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-border bg-white shadow-2xl shadow-slate-900/20">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-emerald-50/60 px-5 py-4">
              <h3 id="perfil-modal-title" className="text-base font-bold">
                {editingId ? "Editar perfil" : "Nuevo perfil"}
              </h3>
              <button
                type="button"
                onClick={closeModal}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-white"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-5 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Nombre
                  </span>
                  <input
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    required
                    maxLength={80}
                    className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Descripción
                  </span>
                  <input
                    value={descripcion}
                    onChange={(e) => setDescripcion(e.target.value)}
                    maxLength={200}
                    className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                  />
                </label>
              </div>

              <PermisosMatrix
                selected={selectedKeys}
                onChange={setSelectedKeys}
                disabled={saving}
              />

              {formError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {formError}
                </div>
              ) : null}

              <div className="flex justify-end gap-2">
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
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {pendingToggle ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-border bg-white p-5 shadow-2xl">
            <h3 className="text-base font-bold">
              {pendingToggle.activo ? "Desactivar perfil" : "Activar perfil"}
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              {pendingToggle.activo
                ? `¿Desactivar el perfil “${pendingToggle.nombre}”? Los usuarios activos asignados deben reasignarse antes.`
                : `¿Activar el perfil “${pendingToggle.nombre}”?`}
            </p>
            {toggleError ? (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {toggleError}
              </div>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={toggling}
                onClick={() => setPendingToggle(null)}
                className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={toggling}
                onClick={() => void confirmToggle()}
                className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${
                  pendingToggle.activo
                    ? "bg-red-600 shadow-md shadow-red-600/20 hover:bg-red-700"
                    : "bg-emerald-700 shadow-md shadow-emerald-700/20 hover:bg-emerald-800"
                }`}
              >
                {toggling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {pendingToggle.activo ? "Desactivar" : "Activar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PermisosMatrix({
  selected,
  onChange,
  disabled,
}: {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  disabled: boolean;
}) {
  function toggleKeys(keys: string[], turnOn: boolean) {
    const next = new Set(selected);
    for (const key of keys) {
      if (turnOn) next.add(key);
      else next.delete(key);
    }
    onChange(next);
  }

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Matriz de permisos
      </p>
      {PERMISSION_CATALOG.map((mod) => {
        const moduleKeys = mod.pestanas.flatMap((tab) =>
          tab.acciones.map((act) =>
            permisoKey(mod.modulo, tab.pestana, act.accion)
          )
        );
        const moduleOn = moduleKeys.every((key) => selected.has(key));
        const moduleSome = moduleKeys.some((key) => selected.has(key));
        return (
          <fieldset
            key={mod.modulo}
            className="rounded-xl border border-border bg-slate-50/60 p-4"
          >
            <legend className="px-1 text-sm font-bold text-foreground">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={moduleOn}
                  ref={(el) => {
                    if (el) el.indeterminate = moduleSome && !moduleOn;
                  }}
                  disabled={disabled}
                  onChange={(e) => toggleKeys(moduleKeys, e.target.checked)}
                />
                {mod.label}
              </label>
            </legend>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {mod.pestanas.map((tab) => {
                const tabKeys = tab.acciones.map((act) =>
                  permisoKey(mod.modulo, tab.pestana, act.accion)
                );
                const tabOn = tabKeys.every((key) => selected.has(key));
                const tabSome = tabKeys.some((key) => selected.has(key));
                return (
                  <div
                    key={`${mod.modulo}:${tab.pestana}`}
                    className="rounded-xl border border-border bg-white p-3"
                  >
                    <label className="mb-2 flex items-center gap-2 text-sm font-semibold">
                      <input
                        type="checkbox"
                        checked={tabOn}
                        ref={(el) => {
                          if (el) el.indeterminate = tabSome && !tabOn;
                        }}
                        disabled={disabled}
                        onChange={(e) => toggleKeys(tabKeys, e.target.checked)}
                      />
                      {tab.label}
                    </label>
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      {tab.acciones.map((act) => {
                        const key = permisoKey(
                          mod.modulo,
                          tab.pestana,
                          act.accion
                        );
                        return (
                          <label
                            key={key}
                            className="inline-flex items-center gap-1.5 text-sm text-slate-700"
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(key)}
                              disabled={disabled}
                              onChange={(e) =>
                                toggleKeys([key], e.target.checked)
                              }
                            />
                            {act.label}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
