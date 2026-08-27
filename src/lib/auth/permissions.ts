export const AUTH_MODULOS = [
  "logistica",
  "administracion",
  "almacen",
] as const;

export const AUTH_PESTANAS = [
  "compras",
  "inversa",
  "control_documentario",
  "planilla",
  "herramientas",
  "consumibles",
  "perfiles",
  "usuarios",
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
] as const;

export type AuthModulo = (typeof AUTH_MODULOS)[number];
export type AuthPestana = (typeof AUTH_PESTANAS)[number];
export type AuthAccion = (typeof AUTH_ACCIONES)[number];

export type PermisoItem = {
  modulo: AuthModulo;
  pestana: AuthPestana;
  accion: AuthAccion;
};

export function isAuthModulo(value: string): value is AuthModulo {
  return (AUTH_MODULOS as readonly string[]).includes(value);
}

export function isAuthPestana(value: string): value is AuthPestana {
  return (AUTH_PESTANAS as readonly string[]).includes(value);
}

export function isAuthAccion(value: string): value is AuthAccion {
  return (AUTH_ACCIONES as readonly string[]).includes(value);
}
