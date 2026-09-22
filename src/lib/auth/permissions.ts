export const AUTH_MODULOS = [
  "logistica",
  "administracion",
  "almacen",
  "dashboard",
] as const;

export const AUTH_PESTANAS = [
  "compras",
  "inversa",
  "control_documentario",
  "ventas_taller",
  "planilla",
  "herramientas",
  "consumibles",
  "perfiles",
  "usuarios",
  "stock_actual",
  "repuestos",
  "inventario",
] as const;

export const AUTH_ACCIONES = [
  "ver",
  "crear",
  "editar",
  "eliminar",
  "confirmar",
  "certificar",
  "exportar",
  "sincronizar",
  "ver_documentos",
  "adjuntos_subir",
  "adjuntos_eliminar",
  "adjuntos_descargar",
  "prestar",
  "devolver",
  "visto_bueno",
  "desactivar",
  "validar_contabilidad",
  "descargar_adjuntos_masivo",
] as const;

export type AuthModulo = (typeof AUTH_MODULOS)[number];
export type AuthPestana = (typeof AUTH_PESTANAS)[number];
export type AuthAccion = (typeof AUTH_ACCIONES)[number];

export type PermisoItem = {
  modulo: AuthModulo;
  pestana: AuthPestana;
  accion: AuthAccion;
};

export type PermisoCatalogoAccion = {
  accion: AuthAccion;
  label: string;
};

export type PermisoCatalogoPestana = {
  pestana: AuthPestana;
  label: string;
  acciones: PermisoCatalogoAccion[];
};

export type PermisoCatalogoModulo = {
  modulo: AuthModulo;
  label: string;
  pestanas: PermisoCatalogoPestana[];
};

const ACCION_LABEL: Record<AuthAccion, string> = {
  ver: "Ver",
  crear: "Crear",
  editar: "Editar",
  eliminar: "Eliminar",
  confirmar: "Confirmar",
  certificar: "Certificar",
  exportar: "Exportar",
  sincronizar: "Sincronizar",
  ver_documentos: "Ver documentos",
  adjuntos_subir: "Subir adjuntos",
  adjuntos_eliminar: "Eliminar adjuntos",
  adjuntos_descargar: "Descargar adjuntos",
  prestar: "Prestar",
  devolver: "Devolver",
  visto_bueno: "Visto bueno",
  desactivar: "Desactivar",
  validar_contabilidad: "Validar Contabilidad",
  descargar_adjuntos_masivo: "Descargar adjuntos masivo",
};

function acciones(
  ids: AuthAccion[]
): PermisoCatalogoAccion[] {
  return ids.map((accion) => ({ accion, label: ACCION_LABEL[accion] }));
}

/** Combinaciones válidas. El frontend no puede enviar permisos fuera de este árbol. */
export const PERMISSION_CATALOG: PermisoCatalogoModulo[] = [
  {
    modulo: "logistica",
    label: "Logística",
    pestanas: [
      {
        pestana: "compras",
        label: "Compras",
        acciones: acciones(["ver", "exportar", "sincronizar", "ver_documentos"]),
      },
      {
        pestana: "inversa",
        label: "Logística inversa",
        acciones: acciones(["ver", "editar", "certificar", "exportar", "sincronizar"]),
      },
      {
        pestana: "control_documentario",
        label: "Control documentario",
        acciones: acciones([
          "ver",
          "crear",
          "editar",
          "eliminar",
          "confirmar",
          "validar_contabilidad",
          "exportar",
          "adjuntos_subir",
          "adjuntos_eliminar",
          "adjuntos_descargar",
          "descargar_adjuntos_masivo",
        ]),
      },
      {
        pestana: "ventas_taller",
        label: "Ventas_Taller",
        acciones: acciones(["ver", "sincronizar"]),
      },
    ],
  },
  {
    modulo: "administracion",
    label: "Administración",
    pestanas: [
      {
        pestana: "planilla",
        label: "Planilla",
        acciones: acciones(["ver", "crear", "editar", "eliminar"]),
      },
      {
        pestana: "herramientas",
        label: "Herramientas",
        acciones: acciones(["ver", "crear", "editar", "eliminar"]),
      },
      {
        pestana: "consumibles",
        label: "Consumibles",
        acciones: acciones(["ver", "crear", "editar", "eliminar"]),
      },
      {
        pestana: "repuestos",
        label: "Repuestos",
        acciones: acciones(["ver", "editar"]),
      },
      {
        pestana: "perfiles",
        label: "Perfiles",
        acciones: acciones(["ver", "crear", "editar", "desactivar"]),
      },
      {
        pestana: "usuarios",
        label: "Usuarios",
        acciones: acciones(["ver", "crear", "editar", "desactivar"]),
      },
    ],
  },
  {
    modulo: "almacen",
    label: "Almacén",
    pestanas: [
      {
        pestana: "herramientas",
        label: "Herramientas",
        acciones: acciones(["ver", "prestar", "devolver"]),
      },
      {
        pestana: "consumibles",
        label: "Consumibles",
        acciones: acciones(["ver", "crear", "editar", "eliminar", "visto_bueno"]),
      },
      {
        pestana: "stock_actual",
        label: "Stock Actual",
        acciones: [
          { accion: "ver", label: ACCION_LABEL.ver },
          { accion: "sincronizar", label: "Sincronizar stock" },
        ],
      },
    ],
  },
  {
    modulo: "dashboard",
    label: "Dashboard",
    pestanas: [
      {
        pestana: "inventario",
        label: "Inventario",
        acciones: acciones(["ver"]),
      },
    ],
  },
];

const CATALOG_KEYS = new Set<string>();
for (const mod of PERMISSION_CATALOG) {
  for (const tab of mod.pestanas) {
    for (const act of tab.acciones) {
      CATALOG_KEYS.add(`${mod.modulo}:${tab.pestana}:${act.accion}`);
    }
  }
}

export function permisoKey(
  modulo: string,
  pestana: string,
  accion: string
): string {
  return `${modulo}:${pestana}:${accion}`;
}

export function isAuthModulo(value: string): value is AuthModulo {
  return (AUTH_MODULOS as readonly string[]).includes(value);
}

export function isAuthPestana(value: string): value is AuthPestana {
  return (AUTH_PESTANAS as readonly string[]).includes(value);
}

export function isAuthAccion(value: string): value is AuthAccion {
  return (AUTH_ACCIONES as readonly string[]).includes(value);
}

export function isCatalogPermission(
  modulo: string,
  pestana: string,
  accion: string
): boolean {
  return CATALOG_KEYS.has(permisoKey(modulo, pestana, accion));
}

export function parseCatalogPermiso(raw: unknown): PermisoItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const modulo = typeof row.modulo === "string" ? row.modulo : "";
  const pestana = typeof row.pestana === "string" ? row.pestana : "";
  const accion = typeof row.accion === "string" ? row.accion : "";
  if (!isCatalogPermission(modulo, pestana, accion)) return null;
  return {
    modulo: modulo as AuthModulo,
    pestana: pestana as AuthPestana,
    accion: accion as AuthAccion,
  };
}

/** Devuelve solo combinaciones del catálogo con permitido === true. */
export function parsePermisosPayload(raw: unknown): PermisoItem[] | { error: string } {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    return { error: "permisos debe ser un arreglo." };
  }
  const seen = new Set<string>();
  const allowed: PermisoItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { error: "Cada permiso debe ser un objeto válido del catálogo." };
    }
    const row = item as Record<string, unknown>;
    const parsed = parseCatalogPermiso(item);
    if (!parsed) {
      return {
        error:
          "Hay un permiso fuera del catálogo. Solo se aceptan combinaciones módulo/pestaña/acción definidas.",
      };
    }
    const permitido = row.permitido;
    if (permitido === false) continue;
    if (permitido != null && typeof permitido !== "boolean") {
      return { error: "El campo permitido debe ser booleano." };
    }
    const key = permisoKey(parsed.modulo, parsed.pestana, parsed.accion);
    if (seen.has(key)) continue;
    seen.add(key);
    allowed.push(parsed);
  }
  return allowed;
}

export function hasPermission(
  permisos: readonly PermisoItem[],
  modulo: AuthModulo,
  pestana: AuthPestana,
  accion: AuthAccion
): boolean {
  return permisos.some(
    (item) =>
      item.modulo === modulo &&
      item.pestana === pestana &&
      item.accion === accion
  );
}

export function expandPermisosForClient(allowed: PermisoItem[]): Array<
  PermisoItem & { permitido: boolean }
> {
  const on = new Set(
    allowed.map((p) => permisoKey(p.modulo, p.pestana, p.accion))
  );
  const out: Array<PermisoItem & { permitido: boolean }> = [];
  for (const mod of PERMISSION_CATALOG) {
    for (const tab of mod.pestanas) {
      for (const act of tab.acciones) {
        out.push({
          modulo: mod.modulo,
          pestana: tab.pestana,
          accion: act.accion,
          permitido: on.has(permisoKey(mod.modulo, tab.pestana, act.accion)),
        });
      }
    }
  }
  return out;
}
