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
import { hasPermission, type PermisoItem } from "@/lib/auth/permissions";

type UsuarioListItem = {
  id: string;
  username: string;
  nombreCompleto: string | null;
  perfilId: string;
  perfilNombre: string | null;
  activo: boolean;
  lastLoginAt: string | null;
  createdAt: string | null;
  password_hash?: never;
};

type UsuariosListResponse = {
  usuarios: UsuarioListItem[];
  perfilesActivos: Array<{ id: string; nombre: string }>;
};

const MIN_PASSWORD_LENGTH = 8;

export default function UsuariosDashboard({
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
  const canVer = hasPermission(permisos, "administracion", "usuarios", "ver");
  const canCrear = hasPermission(permisos, "administracion", "usuarios", "crear");
  const canEditar = hasPermission(permisos, "administracion", "usuarios", "editar");
  const canDesactivar = hasPermission(
    permisos,
    "administracion",
    "usuarios",
    "desactivar"
  );

  const [items, setItems] = useState<UsuarioListItem[]>([]);
  const [perfiles, setPerfiles] = useState<Array<{ id: string; nombre: string }>>(
    []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [nombreCompleto, setNombreCompleto] = useState("");
  const [perfilId, setPerfilId] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [activo, setActivo] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingToggle, setPendingToggle] = useState<UsuarioListItem | null>(
    null
  );
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const fetchUsuarios = useCallback(async () => {
    if (!sessionOk || !canVer) return;
    setLoading(true);
    setError(null);
    const result = await adminFetch<UsuariosListResponse>("/api/usuarios");
    if (!result.ok) {
      setError(result.error);
      setItems([]);
      setLoading(false);
      return;
    }
    setItems(sanitizeUsuarios(result.data?.usuarios));
    setPerfiles(result.data?.perfilesActivos ?? []);
    setLoading(false);
  }, [sessionOk, canVer]);

  const selectorPerfiles = useMemo(() => {
    const list = [...perfiles];
    if (
      perfilId &&
      !list.some((item) => item.id === perfilId)
    ) {
      const current = items.find((item) => item.perfilId === perfilId);
      list.push({
        id: perfilId,
        nombre: current?.perfilNombre
          ? `${current.perfilNombre} (inactivo)`
          : "Perfil actual",
      });
    }
    return list;
  }, [perfiles, perfilId, items]);

  useEffect(() => {
    void fetchUsuarios();
  }, [fetchUsuarios]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      [item.username, item.nombreCompleto ?? "", item.perfilNombre ?? ""]
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
    setPassword("");
    setPasswordConfirm("");
  }

  async function openCreate() {
    setEditingId(null);
    setUsername("");
    setNombreCompleto("");
    setPassword("");
    setPasswordConfirm("");
    setActivo(true);
    setFormError(null);
    setPerfilId("");
    setModalOpen(true);
  }

  async function openEdit(item: UsuarioListItem) {
    setEditingId(item.id);
    setUsername(item.username);
    setNombreCompleto(item.nombreCompleto ?? "");
    setPerfilId(item.perfilId);
    setPassword("");
    setPasswordConfirm("");
    setActivo(item.activo);
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const user = username.trim();
    const nombre = nombreCompleto.trim();
    if (!user) {
      setFormError("El usuario es obligatorio.");
      return;
    }
    if (!nombre) {
      setFormError("El nombre completo es obligatorio.");
      return;
    }
    if (!perfilId) {
      setFormError("Debe seleccionar un perfil válido.");
      return;
    }
    if (!editingId || password || passwordConfirm) {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setFormError(
          `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`
        );
        return;
      }
      if (password !== passwordConfirm) {
        setFormError("La confirmación de contraseña no coincide.");
        return;
      }
    }

    setSaving(true);
    setFormError(null);
    const payload: Record<string, unknown> = {
      username: user,
      nombreCompleto: nombre,
      perfilId,
      activo,
    };
    if (!editingId || password) {
      payload.password = password;
    }

    const result = editingId
      ? await adminFetch<UsuarioListItem>(`/api/usuarios/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        })
      : await adminFetch<UsuarioListItem>("/api/usuarios", {
          method: "POST",
          body: JSON.stringify(payload),
        });
    setSaving(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    closeModal();
    await fetchUsuarios();
  }

  async function confirmToggle() {
    if (!pendingToggle) return;
    setToggling(true);
    setToggleError(null);
    const result = await adminFetch<UsuarioListItem>(
      `/api/usuarios/${pendingToggle.id}`,
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
    await fetchUsuarios();
  }

  if (sessionExpired) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
      >
        La sesión expiró. Vuelva a iniciar sesión con su usuario real para
        gestionar usuarios.
      </div>
    );
  }

  if (isLegacy) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        La gestión de usuarios requiere el inicio de sesión real. El acceso
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
        No tiene permiso para ver usuarios.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Usuarios</h2>
          <p className="mt-1 text-sm text-muted">
            Cuentas del sistema y asignación de perfiles.
          </p>
        </div>
        {canCrear ? (
          <button
            type="button"
            onClick={() => void openCreate()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-700/20 transition hover:bg-emerald-800"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Nuevo usuario
          </button>
        ) : null}
      </div>

      <label className="relative block max-w-md">
        <span className="sr-only">Buscar usuarios</span>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por usuario, nombre o perfil…"
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
                <th className="px-4 py-3">Usuario</th>
                <th className="px-4 py-3">Nombre completo</th>
                <th className="px-4 py-3">Perfil</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Último acceso</th>
                <th className="px-4 py-3">Creado</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted">
                    <span className="inline-flex items-center gap-2 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                      Cargando usuarios…
                    </span>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted">
                    No hay usuarios para mostrar.
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr
                    key={item.id}
                    className="transition hover:bg-emerald-50/40"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-emerald-800">
                      {item.username}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {item.nombreCompleto || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {item.perfilNombre || "—"}
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
                      {formatDateTime(item.lastLoginAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {formatDateTime(item.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {canEditar ? (
                          <button
                            type="button"
                            onClick={() => void openEdit(item)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-emerald-100 hover:text-emerald-700"
                            aria-label={`Editar ${item.username}`}
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
                            aria-label={`Desactivar ${item.username}`}
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
                            aria-label={`Activar ${item.username}`}
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
            {filtered.length} de {items.length} usuario
            {items.length === 1 ? "" : "s"}
          </div>
        ) : null}
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="usuario-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-white shadow-2xl shadow-slate-900/20">
            <div className="sticky top-0 flex items-center justify-between border-b border-border bg-emerald-50/60 px-5 py-4">
              <h3 id="usuario-modal-title" className="text-base font-bold">
                {editingId ? "Editar usuario" : "Nuevo usuario"}
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
            <form onSubmit={handleSubmit} className="space-y-4 p-5">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Usuario
                </span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                  required
                  className="w-full rounded-xl border border-border px-3 py-2.5 font-mono text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Nombre completo
                </span>
                <input
                  value={nombreCompleto}
                  onChange={(e) => setNombreCompleto(e.target.value)}
                  autoComplete="off"
                  required
                  className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Perfil
                </span>
                <select
                  value={perfilId}
                  onChange={(e) => setPerfilId(e.target.value)}
                  required
                  className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                >
                  <option value="">Seleccione un perfil</option>
                  {selectorPerfiles.map((perfil) => (
                    <option key={perfil.id} value={perfil.id}>
                      {perfil.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Contraseña{editingId ? " (opcional)" : ""}
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder={
                    editingId
                      ? "Dejar vacío para conservar la actual"
                      : undefined
                  }
                  className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Confirmar contraseña
                </span>
                <input
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={activo}
                  disabled={activo && !canDesactivar}
                  onChange={(e) => setActivo(e.target.checked)}
                />
                Usuario activo
              </label>
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
              {pendingToggle.activo ? "Desactivar usuario" : "Activar usuario"}
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              {pendingToggle.activo
                ? `¿Desactivar a “${pendingToggle.username}”? No podrá iniciar sesión mientras esté inactivo.`
                : `¿Activar a “${pendingToggle.username}”?`}
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

function sanitizeUsuarios(raw: unknown): UsuarioListItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const item = (row ?? {}) as Record<string, unknown>;
    return {
      id: String(item.id ?? ""),
      username: String(item.username ?? ""),
      nombreCompleto:
        typeof item.nombreCompleto === "string" ? item.nombreCompleto : null,
      perfilId: String(item.perfilId ?? ""),
      perfilNombre:
        typeof item.perfilNombre === "string" ? item.perfilNombre : null,
      activo: item.activo === true,
      lastLoginAt:
        typeof item.lastLoginAt === "string" ? item.lastLoginAt : null,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : null,
    };
  });
}
