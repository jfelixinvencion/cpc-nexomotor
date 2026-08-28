"use client";

import { useCallback, useEffect, useState } from "react";
import {
  hasPermission,
  type AuthAccion,
  type AuthModulo,
  type AuthPestana,
  type PermisoItem,
} from "@/lib/auth/permissions";

const SESSION_KEY = "nexo_session";
export const AUTH_CHANGED_EVENT = "nexo-auth-changed";
export const NO_PERMISO_TITLE = "No tienes permiso para esta acción";

type ClientSession = {
  user: string;
  loggedIn: boolean;
  timestamp: number;
  source?: "mock" | "real";
};

export type PermisosState = {
  cargando: boolean;
  autenticado: boolean;
  source: "mock" | "real" | null;
  perfil: string | null;
  permisos: PermisoItem[];
};

const emptyState: PermisosState = {
  cargando: true,
  autenticado: false,
  source: null,
  perfil: null,
  permisos: [],
};

let cache: { key: string; state: PermisosState } | null = null;
let inflight: Promise<PermisosState> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function readClientSession(): ClientSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClientSession;
    if (parsed && parsed.loggedIn === true) return parsed;
    return null;
  } catch {
    return null;
  }
}

function sessionKey(session: ClientSession | null): string {
  if (!session) return "none";
  const source = session.source === "real" ? "real" : "mock";
  return `${source}:${session.user}:${session.timestamp}`;
}

async function fetchPermisos(): Promise<PermisosState> {
  const session = readClientSession();
  const key = sessionKey(session);
  if (cache && cache.key === key && !cache.state.cargando) {
    return cache.state;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    if (!session) {
      const state: PermisosState = {
        ...emptyState,
        cargando: false,
      };
      cache = { key, state };
      return state;
    }

    const source = session.source === "real" ? "real" : "mock";
    if (source === "mock") {
      const state: PermisosState = {
        cargando: false,
        autenticado: true,
        source: "mock",
        perfil: null,
        permisos: [],
      };
      cache = { key, state };
      return state;
    }

    try {
      const res = await fetch("/api/auth/me", {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (res.status === 401) {
        const state: PermisosState = {
          cargando: false,
          autenticado: false,
          source: "real",
          perfil: null,
          permisos: [],
        };
        cache = { key, state };
        return state;
      }
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { perfil?: string; permisos?: PermisoItem[] };
      };
      if (!res.ok || json.success === false) {
        const state: PermisosState = {
          cargando: false,
          autenticado: false,
          source: "real",
          perfil: null,
          permisos: [],
        };
        cache = { key, state };
        return state;
      }
      const state: PermisosState = {
        cargando: false,
        autenticado: true,
        source: "real",
        perfil: json.data?.perfil ?? null,
        permisos: Array.isArray(json.data?.permisos) ? json.data.permisos : [],
      };
      cache = { key, state };
      return state;
    } catch {
      const state: PermisosState = {
        cargando: false,
        autenticado: false,
        source: "real",
        perfil: null,
        permisos: [],
      };
      cache = { key, state };
      return state;
    }
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function invalidatePermisosCache() {
  cache = null;
  inflight = null;
  void fetchPermisos().then(() => emit());
}

export function usePermisos() {
  const [state, setState] = useState<PermisosState>(
    cache?.state ?? emptyState
  );

  useEffect(() => {
    let cancelled = false;
    const apply = (next: PermisosState) => {
      if (!cancelled) setState(next);
    };

    void fetchPermisos().then(apply);

    const onChange = () => {
      void fetchPermisos().then(apply);
    };
    listeners.add(onChange);

    const onAuthChanged = () => {
      cache = null;
      inflight = null;
      void fetchPermisos().then(() => {
        emit();
      });
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      cache = null;
      inflight = null;
      void fetchPermisos().then(() => emit());
    };

    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      listeners.delete(onChange);
      window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const puede = useCallback(
    (modulo: AuthModulo, pestana: AuthPestana, accion: AuthAccion) => {
      if (state.cargando) return false;
      if (state.source === "mock") return true;
      return hasPermission(state.permisos, modulo, pestana, accion);
    },
    [state.cargando, state.source, state.permisos]
  );

  return {
    ...state,
    puede,
  };
}
