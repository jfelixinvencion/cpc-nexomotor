import { isSkuExcluido } from "@/lib/repuestos-clasificacion";
import {
  canonicalizeEstadoRepuesto,
  displayEstadoRepuesto,
  normalizeEstadoKey,
} from "@/lib/logistica-inversa-estado";

export { normalizeEstadoKey } from "@/lib/logistica-inversa-estado";

export const INVERSA_PAGE_SIZE = 1000;
export const LINEA_FECHA_YMD_RE = /^(\d{4})-(\d{2})-(\d{2})/;
export const SIN_CATEGORIA = "Sin categoría";
export const SIN_VALORIZAR = "Sin valorizar";
export const VALOR_SIN_IGV_LABEL = "Valor sin IGV";

export const CUBOS = [
  "devuelto",
  "pendiente",
  "no_retornable",
  "otro",
] as const;
export type CuboInversa = (typeof CUBOS)[number];

export const ESTADOS_NORM = [
  "AVERIADO",
  "PENDIENTE",
  "NO RETORNABLE",
  "NO DEVUELTO",
  "OTRO",
] as const;
export type EstadoNorm = (typeof ESTADOS_NORM)[number];

export const ANTIGUEDAD_BUCKETS = ["0-30", "31-60", "61-90", "90+"] as const;
export type AntiguedadBucket = (typeof ANTIGUEDAD_BUCKETS)[number];

export const CALIDAD_FILTROS = [
  "sin_valorizar",
  "sin_categoria",
  "otro_estado",
] as const;
export type CalidadFiltro = (typeof CALIDAD_FILTROS)[number];

export type InversaRawRow = {
  id: string;
  ot_id: number | string | null;
  ot_numero: string | number | null;
  placa: string | null;
  linea_codigo: string | null;
  linea_descripcion: string | null;
  linea_cantidad: number | string | null;
  linea_fecha_entrega: string | null;
  estado_repuesto: string | null;
  observaciones: string | null;
  vendido_chatarrero_at: string | null;
  fecha_registro_retorno: string | null;
};

export type RepuestoCostoRow = {
  codigo: string | null;
  stock: number | string | null;
  costo_unitario_soles: number | string | null;
};

export type ClasificacionCategoriaRow = {
  codigo: string | null;
  categoria: string | null;
};

export type CuboTotales = {
  lineas: number;
  cantidad: number;
  valorizado: number | null;
  sinValorizar: number;
};

export type EnrichedInversaLine = {
  id: string;
  otKey: string | null;
  otNumero: string | null;
  placa: string | null;
  codigo: string;
  descripcion: string | null;
  cantidad: number | null;
  fechaEntrega: string | null;
  mes: string | null;
  estadoRaw: string | null;
  estadoNorm: EstadoNorm;
  estadoLabel: string;
  cubo: CuboInversa;
  observaciones: string | null;
  categoria: string | null;
  valor: number | null;
  antiguedadDias: number | null;
  antiguedadBucket: AntiguedadBucket | null;
};

export type InversaDetalleFiltros = {
  mes?: string;
  cubo?: CuboInversa;
  estado?: EstadoNorm;
  categoria?: string;
  antiguedad?: AntiguedadBucket;
  codigo?: string;
  calidad?: CalidadFiltro;
  grupo?: "avance";
};

export type InversaDetalleRow = {
  id: string;
  ot: string | null;
  placa: string | null;
  codigo: string;
  descripcion: string | null;
  cantidad: number | null;
  fechaEntrega: string | null;
  valorizado: number | null;
  categoria: string | null;
  estado: string;
  estadoNorm: EstadoNorm;
  cubo: CuboInversa;
  motivo: string | null;
};

export type MensualInversa = {
  mes: string;
  devueltoLineas: number;
  pendienteLineas: number;
  noRetornableLineas: number;
  otroLineas: number;
  devueltoCantidad: number;
  pendienteCantidad: number;
  noRetornableCantidad: number;
  avanceLineas: number | null;
  avanceCantidad: number | null;
};

export type EstadoPorMes = {
  mes: string;
  estados: Array<{ estado: string; estadoNorm: EstadoNorm; lineas: number }>;
};

export type CategoriaPendiente = {
  categoria: string;
  lineas: number;
  cantidad: number;
  valorizado: number | null;
  sinValorizar: number;
};

export type AntiguedadPendiente = {
  bucket: AntiguedadBucket;
  label: string;
  lineas: number;
  cantidad: number;
  valorizado: number | null;
  sinValorizar: number;
};

export type TopPendiente = {
  codigo: string;
  descripcion: string | null;
  categoria: string | null;
  lineas: number;
  cantidad: number;
  valorizado: number;
};

export type InversaResumen = {
  fechaCorte: string;
  excluidasVendido: {
    lineas: number;
    nota: string;
    porEstado: Array<{ estado: string; lineas: number }>;
  };
  kpis: {
    avanceLineas: number | null;
    avanceCantidad: number | null;
    valorizadoPendiente: number | null;
    valorizadoDevuelto: number | null;
    valorizadoNoRetornable: number | null;
    lineasPendientes: number;
    otsPendientes: number;
    antiguedadPromedioPendiente: number | null;
    cubos: Record<CuboInversa, CuboTotales>;
    noRetornableDetalle: {
      consumible: CuboTotales;
      sinDevolucion: CuboTotales;
    };
  };
  mensual: MensualInversa[];
  estadoPorMes: EstadoPorMes[];
  pendientePorCategoria: CategoriaPendiente[];
  antiguedadPendiente: AntiguedadPendiente[];
  top10Pendiente: TopPendiente[];
  calidad: {
    sinValorizar: number;
    sinCategoria: number;
    otroEstado: number;
  };
};

/** Valor canónico / cubo de estado → etiqueta en pantalla. */
export const ESTADO_LABEL: Record<EstadoNorm, string> = {
  AVERIADO: displayEstadoRepuesto("AVERIADO") || "Averiado",
  PENDIENTE: "Pendiente",
  "NO RETORNABLE": displayEstadoRepuesto("NO RETORNABLE") || "No retornable",
  "NO DEVUELTO": displayEstadoRepuesto("NO DEVUELTO") || "No devuelto",
  OTRO: "Otro estado",
};

export const CUBO_LABEL: Record<CuboInversa, string> = {
  devuelto: "Devuelto",
  pendiente: "Pendiente",
  no_retornable: "No recuperable",
  otro: "Otro estado",
};

export function etiquetaEstado(estadoNorm: EstadoNorm): string {
  return ESTADO_LABEL[estadoNorm];
}

export const ANTIGUEDAD_LABEL: Record<AntiguedadBucket, string> = {
  "0-30": "0-30 días",
  "31-60": "31-60 días",
  "61-90": "61-90 días",
  "90+": "Más de 90 días",
};

function emptyCubo(): CuboTotales {
  return { lineas: 0, cantidad: 0, valorizado: null, sinValorizar: 0 };
}

export function asNullableText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

export function filledTimestamp(value: unknown): boolean {
  return asNullableText(value) != null;
}

export function isVendidoChatarrero(value: unknown): boolean {
  return filledTimestamp(value);
}

export function normalizeCodigo(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

export function ymdFromLineaFechaEntrega(
  value: string | null | undefined
): string | null {
  if (value == null) return null;
  const m = value.trim().match(LINEA_FECHA_YMD_RE);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function ymFromLineaFechaEntrega(
  value: string | null | undefined
): string | null {
  const ymd = ymdFromLineaFechaEntrega(value);
  return ymd ? ymd.slice(0, 7) : null;
}

export function todayYmdLima(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function daysBetweenYmd(from: string, to: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return null;
  }
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((b - a) / 86_400_000);
}

export function antiguedadBucketFromDays(
  days: number | null
): AntiguedadBucket | null {
  if (days == null || !Number.isFinite(days)) return null;
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export function parseCantidad(
  value: number | string | null | undefined
): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseCostoUnitario(
  value: number | string | null | undefined
): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function classifyEstado(estadoRepuesto: unknown): {
  estadoNorm: EstadoNorm;
  cubo: CuboInversa;
  estadoLabel: string;
  estadoRaw: string | null;
} {
  const estadoRaw = asNullableText(estadoRepuesto);
  if (!estadoRaw) {
    return {
      estadoNorm: "PENDIENTE",
      cubo: "pendiente",
      estadoLabel: etiquetaEstado("PENDIENTE"),
      estadoRaw,
    };
  }
  const canon = canonicalizeEstadoRepuesto(estadoRaw);
  if (canon === "AVERIADO") {
    return {
      estadoNorm: "AVERIADO",
      cubo: "devuelto",
      estadoLabel: etiquetaEstado("AVERIADO"),
      estadoRaw,
    };
  }
  if (canon === "NO RETORNABLE") {
    return {
      estadoNorm: "NO RETORNABLE",
      cubo: "no_retornable",
      estadoLabel: etiquetaEstado("NO RETORNABLE"),
      estadoRaw,
    };
  }
  if (canon === "NO DEVUELTO") {
    return {
      estadoNorm: "NO DEVUELTO",
      cubo: "no_retornable",
      estadoLabel: etiquetaEstado("NO DEVUELTO"),
      estadoRaw,
    };
  }
  return {
    estadoNorm: "OTRO",
    cubo: "otro",
    estadoLabel: estadoRaw ?? etiquetaEstado("OTRO"),
    estadoRaw,
  };
}

export function addCostoCandidate(
  map: Map<string, { stock: number; costo: number | null }>,
  row: RepuestoCostoRow
) {
  const codigo = normalizeCodigo(row.codigo);
  if (!codigo || isSkuExcluido(row.codigo)) return;
  const stock = parseCantidad(row.stock) ?? 0;
  const costo = parseCostoUnitario(row.costo_unitario_soles);
  const prev = map.get(codigo);
  if (!prev) {
    map.set(codigo, { stock, costo });
    return;
  }
  if (stock > prev.stock) {
    map.set(codigo, { stock, costo });
    return;
  }
  if (stock === prev.stock && prev.costo == null && costo != null) {
    map.set(codigo, { stock, costo });
  }
}

export function addCategoriaCandidate(
  map: Map<string, string>,
  row: ClasificacionCategoriaRow
) {
  const codigo = normalizeCodigo(row.codigo);
  const categoria = asNullableText(row.categoria);
  if (!codigo || !categoria || map.has(codigo)) return;
  map.set(codigo, categoria);
}

export function enrichInversaLines(
  rows: InversaRawRow[],
  costos: Map<string, { stock: number; costo: number | null }>,
  categorias: Map<string, string>,
  todayYmd = todayYmdLima()
): {
  lines: EnrichedInversaLine[];
  excluidasVendido: InversaResumen["excluidasVendido"];
} {
  const excludedByEstado = new Map<string, number>();
  let excluidas = 0;
  const lines: EnrichedInversaLine[] = [];

  for (const row of rows) {
    if (isVendidoChatarrero(row.vendido_chatarrero_at)) {
      excluidas += 1;
      const estado = asNullableText(row.estado_repuesto) ?? "(vacío)";
      excludedByEstado.set(estado, (excludedByEstado.get(estado) ?? 0) + 1);
      continue;
    }

    const classified = classifyEstado(row.estado_repuesto);
    const codigo = normalizeCodigo(row.linea_codigo) || "(sin código)";
    const cantidad = parseCantidad(row.linea_cantidad);
    const ymd = ymdFromLineaFechaEntrega(row.linea_fecha_entrega);
    const mes = ymFromLineaFechaEntrega(row.linea_fecha_entrega);
    const costo = costos.get(codigo)?.costo ?? null;
    const valor =
      cantidad != null && costo != null ? roundMoney(cantidad * costo) : null;
    const antiguedadDias = ymd ? daysBetweenYmd(ymd, todayYmd) : null;
    const otNumero = asNullableText(row.ot_numero);
    const otId = asNullableText(row.ot_id);

    lines.push({
      id: String(row.id),
      otKey: otId ?? otNumero,
      otNumero,
      placa: asNullableText(row.placa),
      codigo,
      descripcion: asNullableText(row.linea_descripcion),
      cantidad,
      fechaEntrega: ymd,
      mes,
      estadoRaw: classified.estadoRaw,
      estadoNorm: classified.estadoNorm,
      estadoLabel: classified.estadoLabel,
      cubo: classified.cubo,
      observaciones: asNullableText(row.observaciones),
      categoria: categorias.get(codigo) ?? null,
      valor,
      antiguedadDias,
      antiguedadBucket: antiguedadBucketFromDays(antiguedadDias),
    });
  }

  const porEstado = [...excludedByEstado.entries()]
    .map(([estado, lineas]) => ({ estado, lineas }))
    .sort((a, b) => b.lineas - a.lineas);

  return {
    lines,
    excluidasVendido: {
      lineas: excluidas,
      nota:
        excluidas === 1
          ? "1 línea vendida a chatarra excluida"
          : `${excluidas} líneas vendidas a chatarra excluidas`,
      porEstado,
    },
  };
}

function addToCubo(target: CuboTotales, line: EnrichedInversaLine) {
  target.lineas += 1;
  if (line.cantidad != null) target.cantidad += line.cantidad;
  if (line.valor == null) target.sinValorizar += 1;
  else {
    target.valorizado = roundMoney((target.valorizado ?? 0) + line.valor);
  }
}

export function avancePct(
  devuelto: number,
  pendiente: number
): number | null {
  const denom = devuelto + pendiente;
  if (denom <= 0) return null;
  return Math.round((devuelto / denom) * 10000) / 100;
}

export function matchesDetalleFiltros(
  line: EnrichedInversaLine,
  filtros: InversaDetalleFiltros
): boolean {
  if (filtros.mes && line.mes !== filtros.mes) return false;
  if (filtros.cubo && line.cubo !== filtros.cubo) return false;
  if (filtros.estado && line.estadoNorm !== filtros.estado) return false;
  if (filtros.categoria) {
    const cat = line.categoria ?? SIN_CATEGORIA;
    if (cat !== filtros.categoria) return false;
  }
  if (filtros.antiguedad && line.antiguedadBucket !== filtros.antiguedad) {
    return false;
  }
  if (filtros.codigo && line.codigo !== normalizeCodigo(filtros.codigo)) {
    return false;
  }
  if (filtros.grupo === "avance" && line.cubo !== "devuelto" && line.cubo !== "pendiente") {
    return false;
  }
  if (filtros.calidad === "sin_valorizar" && line.valor != null) return false;
  if (filtros.calidad === "sin_categoria" && line.categoria != null) return false;
  if (filtros.calidad === "otro_estado" && line.estadoNorm !== "OTRO") return false;
  return true;
}

export function toDetalleRow(line: EnrichedInversaLine): InversaDetalleRow {
  return {
    id: line.id,
    ot: line.otNumero,
    placa: line.placa,
    codigo: line.codigo,
    descripcion: line.descripcion,
    cantidad: line.cantidad,
    fechaEntrega: line.fechaEntrega,
    valorizado: line.valor,
    categoria: line.categoria,
    estado: line.estadoLabel,
    estadoNorm: line.estadoNorm,
    cubo: line.cubo,
    motivo: line.observaciones,
  };
}

export function buildInversaResumen(
  lines: EnrichedInversaLine[],
  excluidasVendido: InversaResumen["excluidasVendido"],
  now = new Date()
): InversaResumen {
  const cubos: Record<CuboInversa, CuboTotales> = {
    devuelto: emptyCubo(),
    pendiente: emptyCubo(),
    no_retornable: emptyCubo(),
    otro: emptyCubo(),
  };
  const noRetornableDetalle = {
    consumible: emptyCubo(),
    sinDevolucion: emptyCubo(),
  };

  const mensualMap = new Map<string, MensualInversa>();
  const estadoMesMap = new Map<string, Map<string, { estadoNorm: EstadoNorm; lineas: number }>>();
  const catMap = new Map<string, CategoriaPendiente>();
  const ageMap = new Map<AntiguedadBucket, AntiguedadPendiente>();
  for (const bucket of ANTIGUEDAD_BUCKETS) {
    ageMap.set(bucket, {
      bucket,
      label: ANTIGUEDAD_LABEL[bucket],
      lineas: 0,
      cantidad: 0,
      valorizado: null,
      sinValorizar: 0,
    });
  }
  const topMap = new Map<
    string,
    { descripcion: string | null; categoria: string | null; lineas: number; cantidad: number; valorizado: number }
  >();

  const otPendiente = new Set<string>();
  let ageSum = 0;
  let ageN = 0;
  let sinValorizar = 0;
  let sinCategoria = 0;
  let otroEstado = 0;

  function monthRow(mes: string): MensualInversa {
    const prev = mensualMap.get(mes);
    if (prev) return prev;
    const next: MensualInversa = {
      mes,
      devueltoLineas: 0,
      pendienteLineas: 0,
      noRetornableLineas: 0,
      otroLineas: 0,
      devueltoCantidad: 0,
      pendienteCantidad: 0,
      noRetornableCantidad: 0,
      avanceLineas: null,
      avanceCantidad: null,
    };
    mensualMap.set(mes, next);
    return next;
  }

  for (const line of lines) {
    addToCubo(cubos[line.cubo], line);
    if (line.estadoNorm === "NO RETORNABLE") {
      addToCubo(noRetornableDetalle.consumible, line);
    }
    if (line.estadoNorm === "NO DEVUELTO") {
      addToCubo(noRetornableDetalle.sinDevolucion, line);
    }

    if (line.valor == null) sinValorizar += 1;
    if (line.categoria == null) sinCategoria += 1;
    if (line.estadoNorm === "OTRO") otroEstado += 1;

    const mesKey = line.mes ?? "Sin fecha";
    const month = monthRow(mesKey);
    const qty = line.cantidad ?? 0;
    if (line.cubo === "devuelto") {
      month.devueltoLineas += 1;
      month.devueltoCantidad += qty;
    } else if (line.cubo === "pendiente") {
      month.pendienteLineas += 1;
      month.pendienteCantidad += qty;
    } else if (line.cubo === "no_retornable") {
      month.noRetornableLineas += 1;
      month.noRetornableCantidad += qty;
    } else {
      month.otroLineas += 1;
    }

    let estadoMes = estadoMesMap.get(mesKey);
    if (!estadoMes) {
      estadoMes = new Map();
      estadoMesMap.set(mesKey, estadoMes);
    }
    const estadoKey = line.estadoNorm;
    const prevEstado = estadoMes.get(estadoKey);
    if (prevEstado) prevEstado.lineas += 1;
    else {
      estadoMes.set(estadoKey, { estadoNorm: line.estadoNorm, lineas: 1 });
    }

    if (line.cubo === "pendiente") {
      if (line.otKey) otPendiente.add(line.otKey);
      if (line.antiguedadDias != null) {
        ageSum += line.antiguedadDias;
        ageN += 1;
      }
      const cat = line.categoria ?? SIN_CATEGORIA;
      const catRow = catMap.get(cat) ?? {
        categoria: cat,
        lineas: 0,
        cantidad: 0,
        valorizado: null,
        sinValorizar: 0,
      };
      catRow.lineas += 1;
      if (line.cantidad != null) catRow.cantidad += line.cantidad;
      if (line.valor == null) catRow.sinValorizar += 1;
      else catRow.valorizado = roundMoney((catRow.valorizado ?? 0) + line.valor);
      catMap.set(cat, catRow);

      if (line.antiguedadBucket) {
        const ageRow = ageMap.get(line.antiguedadBucket);
        if (ageRow) {
          ageRow.lineas += 1;
          if (line.cantidad != null) ageRow.cantidad += line.cantidad;
          if (line.valor == null) ageRow.sinValorizar += 1;
          else {
            ageRow.valorizado = roundMoney((ageRow.valorizado ?? 0) + line.valor);
          }
        }
      }

      if (line.valor != null) {
        const top = topMap.get(line.codigo) ?? {
          descripcion: line.descripcion,
          categoria: line.categoria,
          lineas: 0,
          cantidad: 0,
          valorizado: 0,
        };
        top.lineas += 1;
        if (line.cantidad != null) top.cantidad += line.cantidad;
        top.valorizado = roundMoney(top.valorizado + line.valor);
        if (!top.descripcion && line.descripcion) top.descripcion = line.descripcion;
        topMap.set(line.codigo, top);
      }
    }
  }

  const mensual = [...mensualMap.values()]
    .sort((a, b) => a.mes.localeCompare(b.mes))
    .map((row) => ({
      ...row,
      avanceLineas: avancePct(row.devueltoLineas, row.pendienteLineas),
      avanceCantidad: avancePct(row.devueltoCantidad, row.pendienteCantidad),
    }));

  const estadoPorMes: EstadoPorMes[] = mensual.map((row) => {
    const inner = estadoMesMap.get(row.mes) ?? new Map();
    const estados = ESTADOS_NORM.map((estadoNorm) => {
      const found = inner.get(estadoNorm);
      return {
        estado: etiquetaEstado(estadoNorm),
        estadoNorm,
        lineas: found?.lineas ?? 0,
      };
    });
    return { mes: row.mes, estados };
  });

  const pendientePorCategoria = [...catMap.values()].sort((a, b) => {
    const va = a.valorizado ?? -1;
    const vb = b.valorizado ?? -1;
    if (vb !== va) return vb - va;
    return b.lineas - a.lineas;
  });

  const top10Pendiente = [...topMap.entries()]
    .map(([codigo, row]) => ({ codigo, ...row }))
    .sort((a, b) => b.valorizado - a.valorizado)
    .slice(0, 10);

  return {
    fechaCorte: now.toISOString(),
    excluidasVendido,
    kpis: {
      avanceLineas: avancePct(cubos.devuelto.lineas, cubos.pendiente.lineas),
      avanceCantidad: avancePct(
        cubos.devuelto.cantidad,
        cubos.pendiente.cantidad
      ),
      valorizadoPendiente: cubos.pendiente.valorizado,
      valorizadoDevuelto: cubos.devuelto.valorizado,
      valorizadoNoRetornable: cubos.no_retornable.valorizado,
      lineasPendientes: cubos.pendiente.lineas,
      otsPendientes: otPendiente.size,
      antiguedadPromedioPendiente:
        ageN > 0 ? Math.round((ageSum / ageN) * 10) / 10 : null,
      cubos,
      noRetornableDetalle,
    },
    mensual,
    estadoPorMes,
    pendientePorCategoria,
    antiguedadPendiente: ANTIGUEDAD_BUCKETS.map((bucket) => ageMap.get(bucket)!),
    top10Pendiente,
    calidad: { sinValorizar, sinCategoria, otroEstado },
  };
}

export function isCuboInversa(value: string): value is CuboInversa {
  return (CUBOS as readonly string[]).includes(value);
}

export function isEstadoNorm(value: string): value is EstadoNorm {
  return parseEstadoNormFiltro(value) != null;
}

export function parseEstadoNormFiltro(value: string): EstadoNorm | null {
  const key = normalizeEstadoKey(value);
  if (key === "AVERIADO") return "AVERIADO";
  if (key === "PENDIENTE") return "PENDIENTE";
  if (key === "CONSUMIBLE" || key === "NO RETORNABLE") return "NO RETORNABLE";
  if (key === "SIN DEVOLUCION" || key === "NO DEVUELTO") return "NO DEVUELTO";
  if (key === "OTRO") return "OTRO";
  return null;
}

export function isAntiguedadBucket(value: string): value is AntiguedadBucket {
  return (ANTIGUEDAD_BUCKETS as readonly string[]).includes(value);
}

export function isCalidadFiltro(value: string): value is CalidadFiltro {
  return (CALIDAD_FILTROS as readonly string[]).includes(value);
}

export function parseDetalleSearchParams(
  params: URLSearchParams
): InversaDetalleFiltros | { error: string } {
  const filtros: InversaDetalleFiltros = {};
  const mes = params.get("mes")?.trim() ?? "";
  if (mes) {
    if (mes !== "Sin fecha" && !/^\d{4}-\d{2}$/.test(mes)) {
      return { error: "mes debe ser YYYY-MM." };
    }
    filtros.mes = mes;
  }
  const cubo = params.get("cubo")?.trim() ?? "";
  if (cubo) {
    if (!isCuboInversa(cubo)) return { error: "cubo no válido." };
    filtros.cubo = cubo;
  }
  const estado = params.get("estado")?.trim() ?? "";
  if (estado) {
    const parsedEstado = parseEstadoNormFiltro(estado);
    if (!parsedEstado) return { error: "estado no válido." };
    filtros.estado = parsedEstado;
  }
  const categoria = params.get("categoria")?.trim() ?? "";
  if (categoria) filtros.categoria = categoria;
  const antiguedad = params.get("antiguedad")?.trim() ?? "";
  if (antiguedad) {
    if (!isAntiguedadBucket(antiguedad)) {
      return { error: "antiguedad no válida." };
    }
    filtros.antiguedad = antiguedad;
  }
  const codigo = params.get("codigo")?.trim() ?? "";
  if (codigo) filtros.codigo = codigo;
  const calidad = params.get("calidad")?.trim() ?? "";
  if (calidad) {
    if (!isCalidadFiltro(calidad)) return { error: "calidad no válida." };
    filtros.calidad = calidad;
  }
  const grupo = params.get("grupo")?.trim() ?? "";
  if (grupo) {
    if (grupo !== "avance") return { error: "grupo no válido." };
    filtros.grupo = "avance";
  }
  return filtros;
}
