"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CheckCircle2,
  ClipboardList,
  FileSpreadsheet,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Recycle,
  RotateCcw,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase/client";
import LogisticaComprasTab from "@/components/LogisticaComprasTab";

const INVERSA_PAGE_SIZE = 200;
const INVERSA_ROW_HEIGHT = 48;
const ICON_BTN =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border p-1 transition disabled:cursor-not-allowed disabled:opacity-60";
const MODAL_INPUT_CLASS =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-foreground outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";

export type DetalleOtPendiente = {
  ot_numero: string | number | null;
  vehiculo_modelo: string | null;
  vehiculo_placa: string | null;
  linea_codigo: string | null;
  linea_descripcion: string | null;
  linea_cantidad: number | string | null;
  linea_precio_unitario_pen: number | string | null;
  linea_fecha_entrega: string | null;
  ot_tipo_operacion: string | null;
  ot_status: string | null;
  linea_estado: string | null;
  linea_tipo: string | null;
};

export type LogisticaInversaRow = {
  id: string;
  ot_id: number | null;
  ot_numero: string | number | null;
  placa: string | null;
  cliente_nombre: string | null;
  linea_codigo: string | null;
  linea_descripcion: string | null;
  linea_cantidad: number | string | null;
  linea_fecha_entrega: string | null;
  responsable_entrega: string | null;
  estado_repuesto: string | null;
  observaciones: string | null;
  fecha_registro_retorno: string | null;
  certificado_at: string | null;
  vendido_chatarrero_at: string | null;
};

export type LogisticaInversaPendienteRow = {
  id: string;
  ot_numero: string | number | null;
  placa: string | null;
  linea_codigo: string | null;
  linea_descripcion: string | null;
  linea_cantidad: number | string | null;
  created_at: string | null;
  responsable_recepcion: string | null;
  estado_repuesto: string | null;
  observaciones: string | null;
};

type PlanillaPersona = {
  id: string;
  nombres: string;
  apellido_paterno: string;
  apellido_materno: string | null;
};

type InversaEditForm = {
  fecha_registro_retorno: string;
  responsable_entrega: string;
  estado_repuesto: string;
  observaciones: string;
};

type PendienteForm = {
  ot_numero: string;
  placa: string;
  linea_codigo: string;
  linea_descripcion: string;
  linea_cantidad: string;
  responsable_recepcion: string;
  estado_repuesto: string;
  observaciones: string;
};

type LogisticaTab = "control-ot" | "inversa" | "compras";
type InversaSubTab = "historial" | "pendientes";
type GestionEstadoFiltro = "vendido" | "certificado" | "pendiente" | "vacios";

const GESTION_ESTADO_OPTIONS: { value: GestionEstadoFiltro; label: string }[] = [
  { value: "vendido", label: "Vendido a Chatarra" },
  { value: "certificado", label: "Certificado" },
  { value: "pendiente", label: "Pendiente de Certificar" },
  { value: "vacios", label: "Vacíos" },
];

const OT_STATUS_LABELS: Record<string, string> = {
  WAITING_FOR_ASSIGNMENT: "Espera asignación",
  WAITING_FOR_REPAIR: "Espera reparación",
  WAITING_FOR_VALUATION: "Espera valuación",
  IN_REPAIR: "En reparación",
  PARALYZED: "Paralizado",
  STOPPED: "Paralizado",
  QUALITY_CONTROL: "Control calidad",
  VEHICLE_READY: "Vehículo listo",
  LIQUIDATED: "Liquidado",
  SETTLED: "Liquidado",
  BILLED: "Facturado (P)",
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

function uniqueSorted(values: (string | null | undefined)[]) {
  return Array.from(
    new Set(
      values
        .map((v) => v?.trim())
        .filter((v): v is string => Boolean(v))
    )
  ).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
}

function formatCantidad(value: number | string | null | undefined) {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return asText(value) || "—";
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

function formatPrecioPen(value: number | string | null | undefined) {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return `S/ ${n.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatFechaEntrega(value: string | null | undefined) {
  if (value == null || value.trim() === "") return "-";
  const raw = value.trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "-";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function excelFecha(value: string | null | undefined) {
  const formatted = formatFechaEntrega(value);
  return formatted === "-" ? "" : formatted;
}

function excelFechaHora(value: string | null | undefined) {
  if (value == null || value.trim() === "") return "";
  const d = new Date(value.trim());
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function todayYmdLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isoToDateInput(value: string | null | undefined): string {
  if (!value) return todayYmdLocal();
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return todayYmdLocal();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function dateInputToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function planillaOptionLabel(p: PlanillaPersona) {
  return [p.nombres, p.apellido_paterno]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function cellDash(value: string | null | undefined) {
  const t = asText(value);
  return t || "-";
}

function labelOtStatus(code: string) {
  return OT_STATUS_LABELS[code] ?? code;
}

function hasFechaEntrega(value: string | null | undefined) {
  if (value == null) return false;
  const trimmed = value.trim();
  return trimmed !== "" && trimmed !== "-";
}

function rowHighlightClass(item: DetalleOtPendiente) {
  if (hasFechaEntrega(item.linea_fecha_entrega)) {
    return "bg-green-50 transition hover:bg-green-100/70";
  }
  if (item.ot_status === "VEHICLE_READY") {
    return "bg-red-50 transition hover:bg-red-100/70";
  }
  return "transition hover:bg-accent/5";
}

function matchesTextAndTipo(
  item: DetalleOtPendiente,
  textQuery: string,
  filterTipoOperacion: string
) {
  if (textQuery) {
    const estadoTraducido = item.ot_status
      ? labelOtStatus(item.ot_status)
      : "";
    const haystack = normalize(
      [
        item.vehiculo_placa ?? "",
        item.linea_codigo ?? "",
        item.linea_descripcion ?? "",
        estadoTraducido,
      ].join(" ")
    );
    if (!haystack.includes(textQuery)) return false;
  }

  if (
    filterTipoOperacion &&
    item.ot_tipo_operacion !== filterTipoOperacion
  ) {
    return false;
  }

  return true;
}

function mapDetalleRow(row: Record<string, unknown>): DetalleOtPendiente {
  return {
    ot_numero: (row.ot_numero as string | number | null) ?? null,
    vehiculo_modelo: asText(row.vehiculo_modelo) || null,
    vehiculo_placa: asText(row.vehiculo_placa) || null,
    linea_codigo: asText(row.linea_codigo) || null,
    linea_descripcion: asText(row.linea_descripcion) || null,
    linea_cantidad:
      row.linea_cantidad == null
        ? null
        : (row.linea_cantidad as number | string),
    linea_precio_unitario_pen:
      row.linea_precio_unitario_pen == null
        ? null
        : (row.linea_precio_unitario_pen as number | string),
    linea_fecha_entrega: asText(row.linea_fecha_entrega) || null,
    ot_tipo_operacion: asText(row.ot_tipo_operacion) || null,
    ot_status: asText(row.ot_status) || null,
    linea_estado: asText(row.linea_estado) || null,
    linea_tipo: asText(row.linea_tipo) || null,
  };
}

function mapInversaRow(row: Record<string, unknown>): LogisticaInversaRow {
  return {
    // UUID string — never coerce with Number() (produces NaN).
    id: String(row.id ?? ""),
    ot_id:
      row.ot_id == null || !Number.isFinite(Number(row.ot_id))
        ? null
        : Number(row.ot_id),
    ot_numero: (row.ot_numero as string | number | null) ?? null,
    placa: asText(row.placa) || null,
    cliente_nombre: asText(row.cliente_nombre) || null,
    linea_codigo: asText(row.linea_codigo) || null,
    linea_descripcion: asText(row.linea_descripcion) || null,
    linea_cantidad:
      row.linea_cantidad == null
        ? null
        : (row.linea_cantidad as number | string),
    linea_fecha_entrega: asText(row.linea_fecha_entrega) || null,
    responsable_entrega: asText(row.responsable_entrega) || null,
    estado_repuesto: asText(row.estado_repuesto) || null,
    observaciones: asText(row.observaciones) || null,
    fecha_registro_retorno: asText(row.fecha_registro_retorno) || null,
    certificado_at: asText(row.certificado_at) || null,
    vendido_chatarrero_at: asText(row.vendido_chatarrero_at) || null,
  };
}

function mapPendienteRow(
  row: Record<string, unknown>
): LogisticaInversaPendienteRow {
  return {
    id: String(row.id ?? ""),
    ot_numero: (row.ot_numero as string | number | null) ?? null,
    placa: asText(row.placa) || null,
    linea_codigo: asText(row.linea_codigo) || null,
    linea_descripcion: asText(row.linea_descripcion) || null,
    linea_cantidad:
      row.linea_cantidad == null
        ? null
        : (row.linea_cantidad as number | string),
    created_at: asText(row.created_at) || null,
    responsable_recepcion: asText(row.responsable_recepcion) || null,
    estado_repuesto: asText(row.estado_repuesto) || null,
    observaciones: asText(row.observaciones) || null,
  };
}

function mapPlanillaPersona(row: Record<string, unknown>): PlanillaPersona {
  return {
    id: String(row.id ?? ""),
    nombres: asText(row.nombres),
    apellido_paterno: asText(row.apellido_paterno),
    apellido_materno: asText(row.apellido_materno) || null,
  };
}

function rowKey(item: DetalleOtPendiente, index: number) {
  return [
    item.ot_numero ?? "",
    item.linea_codigo ?? "",
    item.linea_descripcion ?? "",
    item.linea_estado ?? "",
    index,
  ].join("|");
}

function sortOtNumeros(values: string[]) {
  return values.sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b, "es", { numeric: true });
  });
}

function emptyInversaEditForm(): InversaEditForm {
  return {
    fecha_registro_retorno: todayYmdLocal(),
    responsable_entrega: "",
    estado_repuesto: "",
    observaciones: "",
  };
}

function emptyPendienteForm(): PendienteForm {
  return {
    ot_numero: "",
    placa: "",
    linea_codigo: "",
    linea_descripcion: "",
    linea_cantidad: "1",
    responsable_recepcion: "",
    estado_repuesto: "",
    observaciones: "",
  };
}

function pendienteToForm(item: LogisticaInversaPendienteRow): PendienteForm {
  return {
    ot_numero: item.ot_numero != null ? String(item.ot_numero) : "",
    placa: item.placa ?? "",
    linea_codigo: item.linea_codigo ?? "",
    linea_descripcion: item.linea_descripcion ?? "",
    linea_cantidad:
      item.linea_cantidad == null || item.linea_cantidad === ""
        ? "1"
        : String(item.linea_cantidad),
    responsable_recepcion: item.responsable_recepcion ?? "",
    estado_repuesto: item.estado_repuesto ?? "",
    observaciones: item.observaciones ?? "",
  };
}

function pendienteFormPayload(form: PendienteForm) {
  const codigo = form.linea_codigo.trim();
  const descripcion = form.linea_descripcion.trim();
  const qtyRaw = form.linea_cantidad.trim();
  const qty = qtyRaw === "" ? 1 : Number(qtyRaw);
  return {
    ot_numero: form.ot_numero.trim() || null,
    placa: form.placa.trim() || null,
    linea_codigo: codigo,
    linea_descripcion: descripcion,
    linea_cantidad: Number.isFinite(qty) ? qty : 1,
    responsable_recepcion: form.responsable_recepcion.trim() || null,
    estado_repuesto: form.estado_repuesto.trim() || null,
    observaciones: form.observaciones.trim() || null,
  };
}

export default function LogisticaDashboard() {
  const [tab, setTab] = useState<LogisticaTab>("control-ot");

  // --- Control OT ---
  const [items, setItems] = useState<DetalleOtPendiente[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterOtNumero, setFilterOtNumero] = useState("");
  const [filterTexto, setFilterTexto] = useState("");
  const [filterTipoOperacion, setFilterTipoOperacion] = useState("");
  const [hideGreenRows, setHideGreenRows] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const syncMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Logística Inversa ---
  const [inversaItems, setInversaItems] = useState<LogisticaInversaRow[]>([]);
  const [inversaLoading, setInversaLoading] = useState(false);
  const [inversaLoadingMore, setInversaLoadingMore] = useState(false);
  const [inversaHasMore, setInversaHasMore] = useState(true);
  const [inversaError, setInversaError] = useState<string | null>(null);
  const [inversaFilterTexto, setInversaFilterTexto] = useState("");
  const [inversaSubTab, setInversaSubTab] = useState<InversaSubTab>("historial");
  const [gestionEstadoFiltros, setGestionEstadoFiltros] = useState<
    GestionEstadoFiltro[]
  >([]);
  const [estadoRepuestoFiltros, setEstadoRepuestoFiltros] = useState<string[]>(
    []
  );
  const [inversaSyncing, setInversaSyncing] = useState(false);
  const [inversaSyncMessage, setInversaSyncMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [planillaOptions, setPlanillaOptions] = useState<PlanillaPersona[]>(
    []
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<InversaEditForm>(
    emptyInversaEditForm
  );
  const [editSaving, setEditSaving] = useState(false);
  const [certifyingId, setCertifyingId] = useState<string | null>(null);
  const [sellingId, setSellingId] = useState<string | null>(null);
  const [clearingId, setClearingId] = useState<string | null>(null);
  const [pendientesItems, setPendientesItems] = useState<
    LogisticaInversaPendienteRow[]
  >([]);
  const [pendientesLoading, setPendientesLoading] = useState(false);
  const [pendientesError, setPendientesError] = useState<string | null>(null);
  const [pendientesFilterTexto, setPendientesFilterTexto] = useState("");
  const [addingPendiente, setAddingPendiente] = useState(false);
  const [addPendienteForm, setAddPendienteForm] = useState<PendienteForm>(
    emptyPendienteForm
  );
  const [addPendienteSaving, setAddPendienteSaving] = useState(false);
  const [editingPendienteId, setEditingPendienteId] = useState<string | null>(
    null
  );
  const [editPendienteForm, setEditPendienteForm] = useState<PendienteForm>(
    emptyPendienteForm
  );
  const [editPendienteSaving, setEditPendienteSaving] = useState(false);
  const [deletingPendienteId, setDeletingPendienteId] = useState<string | null>(
    null
  );
  const [editError, setEditError] = useState<string | null>(null);
  const [inversaSaveToast, setInversaSaveToast] = useState<string | null>(null);
  const inversaSyncMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const inversaSaveToastTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const inversaScrollRef = useRef<HTMLDivElement | null>(null);
  const inversaLoadedCountRef = useRef(0);
  const inversaFetchingMoreRef = useRef(false);
  const planillaLoadedRef = useRef(false);

  // TODO: restringir Certificar a user.role === 'almacenero' cuando exista roles en contexto.
  const canCertify = true;

  const fetchDetalle = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/logistica/control-ot");
      const json = (await res.json()) as {
        data?: Record<string, unknown>[];
        error?: string;
      };

      if (!res.ok) {
        throw new Error(json.error || "Error al cargar datos");
      }

      const mapped = (json.data ?? []).map(mapDetalleRow);
      setItems(mapped);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error al cargar datos";
      console.error("Error al cargar Detalle_OT_Pendientes:", err);
      setError(message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPlanillaOptions = useCallback(async () => {
    const planillaRes = await supabase
      .from("planilla")
      .select("id, nombres, apellido_paterno, apellido_materno")
      .order("nombres", { ascending: true });

    if (planillaRes.error) {
      console.error(
        "[logistica-inversa] planilla fetch:",
        planillaRes.error.message
      );
      setPlanillaOptions([]);
      return;
    }

    setPlanillaOptions(
      ((planillaRes.data as Record<string, unknown>[]) ?? []).map(
        mapPlanillaPersona
      )
    );
    planillaLoadedRef.current = true;
  }, []);

  const fetchInversaPage = useCallback(
    async (from: number, append: boolean) => {
      const to = from + INVERSA_PAGE_SIZE - 1;
      const inversaRes = await supabase
        .from("logistica_inversa")
        .select("*")
        .order("linea_fecha_entrega", { ascending: false })
        .range(from, to);

      console.log("[logistica-inversa] supabase page:", {
        from,
        to,
        append,
        error: inversaRes.error,
        count: Array.isArray(inversaRes.data) ? inversaRes.data.length : null,
      });

      if (inversaRes.error) {
        throw new Error(inversaRes.error.message);
      }

      const rawRows =
        (inversaRes.data as Record<string, unknown>[] | null) ?? [];
      const mapped = rawRows.map(mapInversaRow);

      setInversaItems((prev) => {
        if (!append) return mapped;
        const seen = new Set(prev.map((r) => r.id));
        const merged = [...prev];
        for (const row of mapped) {
          if (!seen.has(row.id)) merged.push(row);
        }
        return merged;
      });

      inversaLoadedCountRef.current = append
        ? inversaLoadedCountRef.current + mapped.length
        : mapped.length;
      setInversaHasMore(mapped.length >= INVERSA_PAGE_SIZE);
      return mapped.length;
    },
    []
  );

  const fetchInversa = useCallback(async () => {
    setInversaLoading(true);
    setInversaError(null);
    setInversaHasMore(true);
    inversaLoadedCountRef.current = 0;

    try {
      await fetchInversaPage(0, false);
      if (!planillaLoadedRef.current) {
        await fetchPlanillaOptions();
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error desconocido";
      console.error("[logistica-inversa] unexpected error:", err);
      setInversaError(`Error al cargar datos: ${message}`);
      setInversaItems([]);
      setInversaHasMore(false);
    } finally {
      setInversaLoading(false);
    }
  }, [fetchInversaPage, fetchPlanillaOptions]);

  const fetchPendientes = useCallback(async () => {
    setPendientesLoading(true);
    setPendientesError(null);

    try {
      const pendientesRes = await supabase
        .from("logistica_inversa_pendientes")
        .select("*")
        .order("created_at", { ascending: false });

      if (pendientesRes.error) {
        throw new Error(pendientesRes.error.message);
      }

      const mapped = (
        (pendientesRes.data as Record<string, unknown>[] | null) ?? []
      ).map(mapPendienteRow);
      setPendientesItems(mapped);

      if (!planillaLoadedRef.current) {
        await fetchPlanillaOptions();
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error desconocido";
      console.error("[logistica-inversa] pendientes fetch:", err);
      setPendientesError(`Error al cargar pendientes: ${message}`);
      setPendientesItems([]);
    } finally {
      setPendientesLoading(false);
    }
  }, [fetchPlanillaOptions]);

  const loadMoreInversa = useCallback(async () => {
    if (
      !inversaHasMore ||
      inversaLoading ||
      inversaLoadingMore ||
      inversaFetchingMoreRef.current
    ) {
      return;
    }

    inversaFetchingMoreRef.current = true;
    setInversaLoadingMore(true);
    try {
      await fetchInversaPage(inversaLoadedCountRef.current, true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error desconocido";
      console.error("[logistica-inversa] load more error:", err);
      setInversaError(`Error al cargar más datos: ${message}`);
    } finally {
      setInversaLoadingMore(false);
      inversaFetchingMoreRef.current = false;
    }
  }, [
    fetchInversaPage,
    inversaHasMore,
    inversaLoading,
    inversaLoadingMore,
  ]);

  useEffect(() => {
    void fetchDetalle();
  }, [fetchDetalle]);

  // Recargar siempre al entrar a la pestaña Logística Inversa.
  useEffect(() => {
    if (tab === "inversa") {
      void fetchInversa();
    }
  }, [tab, fetchInversa]);

  useEffect(() => {
    if (tab === "inversa" && inversaSubTab === "pendientes") {
      void fetchPendientes();
    }
  }, [tab, inversaSubTab, fetchPendientes]);

  useEffect(() => {
    return () => {
      if (syncMessageTimer.current) {
        clearTimeout(syncMessageTimer.current);
      }
      if (inversaSyncMessageTimer.current) {
        clearTimeout(inversaSyncMessageTimer.current);
      }
      if (inversaSaveToastTimer.current) {
        clearTimeout(inversaSaveToastTimer.current);
      }
    };
  }, []);

  function showSyncMessage(type: "success" | "error", text: string) {
    if (syncMessageTimer.current) {
      clearTimeout(syncMessageTimer.current);
    }
    setSyncMessage({ type, text });
    syncMessageTimer.current = setTimeout(() => {
      setSyncMessage(null);
      syncMessageTimer.current = null;
    }, 4000);
  }

  function showInversaSyncMessage(type: "success" | "error", text: string) {
    if (inversaSyncMessageTimer.current) {
      clearTimeout(inversaSyncMessageTimer.current);
    }
    setInversaSyncMessage({ type, text });
    inversaSyncMessageTimer.current = setTimeout(() => {
      setInversaSyncMessage(null);
      inversaSyncMessageTimer.current = null;
    }, 4000);
  }

  function showInversaSaveToast(text: string) {
    if (inversaSaveToastTimer.current) {
      clearTimeout(inversaSaveToastTimer.current);
    }
    setInversaSaveToast(text);
    inversaSaveToastTimer.current = setTimeout(() => {
      setInversaSaveToast(null);
      inversaSaveToastTimer.current = null;
    }, 2500);
  }

  async function handleSyncOt() {
    if (syncing) return;
    setSyncing(true);
    setSyncMessage(null);

    try {
      const res = await fetch("/api/logistica/trigger-sync", {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        errors?: unknown;
      };

      if (!res.ok || json.success === false) {
        const detail =
          json.error ||
          (Array.isArray(json.errors) && json.errors.length > 0
            ? String(json.errors[0])
            : null) ||
          `Error HTTP ${res.status}`;
        throw new Error(detail);
      }

      await fetchDetalle();
      showSyncMessage("success", "✅ Sincronización completada");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error al sincronizar";
      await fetchDetalle();
      showSyncMessage("error", message);
    } finally {
      setSyncing(false);
    }
  }

  async function handleSyncInversa() {
    if (inversaSyncing) return;
    setInversaSyncing(true);
    setInversaSyncMessage(null);

    try {
      const res = await fetch("/api/logistica/trigger-sync?target=inversa", {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        errors?: unknown;
      };

      if (!res.ok || json.success === false) {
        const detail =
          json.error ||
          (Array.isArray(json.errors) && json.errors.length > 0
            ? typeof json.errors[0] === "object" &&
              json.errors[0] !== null &&
              "error" in json.errors[0]
              ? String(
                  (json.errors[0] as { error?: unknown }).error ??
                    json.errors[0]
                )
              : String(json.errors[0])
            : null) ||
          `Error HTTP ${res.status}`;
        throw new Error(detail);
      }

      await fetchInversa();
      showInversaSyncMessage("success", "✅ Historial sincronizado");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error al sincronizar";
      await fetchInversa();
      showInversaSyncMessage("error", message);
    } finally {
      setInversaSyncing(false);
    }
  }

  function handleExportInversaExcel() {
    const rows = filteredInversa.map((item) => ({
      "Fecha Ent. Rep. Nuevo": excelFecha(item.linea_fecha_entrega),
      Cliente: asText(item.cliente_nombre),
      OT: asText(item.ot_numero),
      Placa: asText(item.placa),
      Código: asText(item.linea_codigo),
      Descripción: asText(item.linea_descripcion),
      "Cant.":
        item.linea_cantidad == null || item.linea_cantidad === ""
          ? ""
          : formatCantidad(item.linea_cantidad),
      "Fecha Ent. Rep. Viejo": excelFecha(item.fecha_registro_retorno),
      "Resp. Entrega": asText(item.responsable_entrega),
      "Estado Repuesto": asText(item.estado_repuesto),
      Observaciones: asText(item.observaciones),
      Certificado: item.certificado_at ? "SÍ" : "NO",
      "Vendido Chatarrero": item.vendido_chatarrero_at ? "SÍ" : "NO",
      "FECHA VENTA CHATARRERO": excelFechaHora(item.vendido_chatarrero_at),
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Logística Inversa");
    XLSX.writeFile(
      workbook,
      `Reporte_Logistica_Inversa_${todayYmdLocal()}.xlsx`
    );
  }

  function startEditInversa(item: LogisticaInversaRow) {
    if (item.certificado_at) return;
    setEditError(null);
    setEditingId(String(item.id));
    setEditForm({
      fecha_registro_retorno: item.fecha_registro_retorno
        ? isoToDateInput(item.fecha_registro_retorno)
        : todayYmdLocal(),
      responsable_entrega: item.responsable_entrega ?? "",
      estado_repuesto: item.estado_repuesto ?? "",
      observaciones: item.observaciones ?? "",
    });
  }

  function cancelEditInversa() {
    setEditingId(null);
    setEditError(null);
    setEditForm(emptyInversaEditForm());
  }

  async function handleSaveInversaEdit(id: string) {
    if (editSaving) return;
    setEditSaving(true);
    setEditError(null);

    const fechaIso = dateInputToIso(editForm.fecha_registro_retorno);
    if (!fechaIso) {
      setEditError("Fecha de entrega inválida.");
      alert("Fecha de entrega inválida.");
      setEditSaving(false);
      return;
    }

    // Column names must match public.logistica_inversa exactly.
    const updatedFields = {
      fecha_registro_retorno: fechaIso,
      responsable_entrega: editForm.responsable_entrega.trim() || null,
      estado_repuesto: editForm.estado_repuesto.trim() || null,
      observaciones: editForm.observaciones.trim() || null,
    };

    const { data, error } = await supabase
      .from("logistica_inversa")
      .update(updatedFields)
      .eq("id", id)
      .select(
        "id, fecha_registro_retorno, responsable_entrega, estado_repuesto, observaciones, certificado_at"
      )
      .maybeSingle();

    if (error) {
      console.error("Error al guardar:", error);
      setEditError(`Error al guardar: ${error.message}`);
      alert("No se pudo guardar en la base de datos.");
      setEditSaving(false);
      return;
    }

    // RLS can "succeed" with 0 rows updated — treat missing row as failure.
    if (!data) {
      console.error(
        "Error al guardar: update no devolvió fila (¿RLS bloqueó el UPDATE?)",
        { id, updatedFields }
      );
      setEditError(
        "No se pudo guardar en la base de datos (sin permiso o fila no encontrada)."
      );
      alert("No se pudo guardar en la base de datos.");
      setEditSaving(false);
      return;
    }

    setEditingId(null);
    setEditForm(emptyInversaEditForm());
    setEditSaving(false);
    showInversaSaveToast("Guardado");
    // Recargar desde Supabase para confirmar persistencia real.
    await fetchInversa();
  }

  /** Certificar desde fila colapsada: solo setea certificado_at. */
  async function handleCertificar(id: string) {
    if (!canCertify || certifyingId != null) return;

    const ok = window.confirm(
      "¿Confirma que recibió el repuesto? Esta acción no se puede deshacer."
    );
    if (!ok) return;

    setCertifyingId(id);
    setEditError(null);

    const certificadoAt = new Date().toISOString();
    const { data, error } = await supabase
      .from("logistica_inversa")
      .update({ certificado_at: certificadoAt })
      .eq("id", id)
      .select("id, certificado_at")
      .maybeSingle();

    if (error) {
      console.error("Error al certificar:", error);
      setEditError(`Error al certificar: ${error.message}`);
      alert("No se pudo certificar en la base de datos.");
      setCertifyingId(null);
      return;
    }

    if (!data) {
      console.error(
        "Error al certificar: update no devolvió fila (¿RLS bloqueó el UPDATE?)",
        { id }
      );
      setEditError(
        "No se pudo certificar (sin permiso o fila no encontrada)."
      );
      alert("No se pudo certificar en la base de datos.");
      setCertifyingId(null);
      return;
    }

    if (editingId === id) {
      setEditingId(null);
      setEditForm(emptyInversaEditForm());
    }
    setCertifyingId(null);
    showInversaSaveToast("Certificado");
    await fetchInversa();
  }

  async function handleVenderChatarrero(id: string) {
    if (sellingId != null) return;
    const item = inversaItems.find((r) => r.id === id);
    if (!item?.certificado_at || item.vendido_chatarrero_at) return;

    const ok = window.confirm(
      "¿Confirma que este repuesto fue vendido al chatarrero? No se puede deshacer."
    );
    if (!ok) return;

    setSellingId(id);
    setEditError(null);

    const updateData = {
      vendido_chatarrero_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("logistica_inversa")
      .update(updateData)
      .eq("id", id)
      .select("id, vendido_chatarrero_at")
      .maybeSingle();

    if (error) {
      console.error("Error al marcar vendido:", error);
      setEditError(`Error al marcar vendido: ${error.message}`);
      alert("No se pudo registrar la venta al chatarrero.");
      setSellingId(null);
      return;
    }

    if (!data) {
      console.error(
        "Error al marcar vendido: update no devolvió fila (¿RLS bloqueó el UPDATE?)",
        { id }
      );
      setEditError(
        "No se pudo registrar la venta (sin permiso o fila no encontrada)."
      );
      alert("No se pudo registrar la venta al chatarrero.");
      setSellingId(null);
      return;
    }

    setInversaItems((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              vendido_chatarrero_at:
                asText(data.vendido_chatarrero_at) ||
                updateData.vendido_chatarrero_at,
            }
          : row
      )
    );
    setSellingId(null);
    showInversaSaveToast("Vendido al chatarrero");
  }

  async function handleLimpiarInversa(id: string) {
    if (clearingId != null) return;

    const ok = window.confirm(
      "¿Desea limpiar el registro? Se borrarán los datos ingresados manualmente."
    );
    if (!ok) return;

    setClearingId(id);
    setEditError(null);

    const { data, error } = await supabase
      .from("logistica_inversa")
      .update({
        fecha_registro_retorno: null,
        responsable_entrega: null,
        estado_repuesto: null,
        observaciones: null,
      })
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("Error al limpiar:", error);
      setEditError(`Error al limpiar: ${error.message}`);
      alert(`No se pudo limpiar el registro: ${error.message}`);
      setClearingId(null);
      return;
    }

    if (!data) {
      console.error(
        "Error al limpiar: update no devolvió fila (¿RLS bloqueó el UPDATE?)",
        { id }
      );
      setEditError("No se pudo limpiar (sin permiso o fila no encontrada).");
      alert("No se pudo limpiar el registro.");
      setClearingId(null);
      return;
    }

    if (editingId === id) {
      setEditingId(null);
      setEditForm(emptyInversaEditForm());
    }
    setClearingId(null);
    showInversaSaveToast("Limpiado");
    await fetchInversa();
  }

  function startAddPendiente() {
    setPendientesError(null);
    setAddingPendiente(true);
    setAddPendienteForm(emptyPendienteForm());
    setEditingPendienteId(null);
  }

  function cancelAddPendiente() {
    setAddingPendiente(false);
    setAddPendienteForm(emptyPendienteForm());
  }

  function startEditPendiente(item: LogisticaInversaPendienteRow) {
    setPendientesError(null);
    setAddingPendiente(false);
    setEditingPendienteId(item.id);
    setEditPendienteForm(pendienteToForm(item));
  }

  function cancelEditPendiente() {
    setEditingPendienteId(null);
    setEditPendienteForm(emptyPendienteForm());
  }

  async function handleSaveNewPendiente() {
    if (addPendienteSaving) return;
    const payload = pendienteFormPayload(addPendienteForm);
    if (!payload.linea_codigo || !payload.linea_descripcion) {
      setPendientesError("Código y Descripción son obligatorios.");
      alert("Código y Descripción son obligatorios.");
      return;
    }

    setAddPendienteSaving(true);
    setPendientesError(null);

    const { data, error } = await supabase
      .from("logistica_inversa_pendientes")
      .insert(payload)
      .select("*")
      .maybeSingle();

    if (error || !data) {
      const message = error?.message || "No se pudo guardar el pendiente.";
      console.error("Error al agregar pendiente:", error);
      setPendientesError(`Error al agregar pendiente: ${message}`);
      alert("No se pudo guardar el pendiente.");
      setAddPendienteSaving(false);
      return;
    }

    setPendientesItems((prev) => [mapPendienteRow(data), ...prev]);
    setAddPendienteSaving(false);
    setAddingPendiente(false);
    setAddPendienteForm(emptyPendienteForm());
    showInversaSaveToast("Pendiente agregado");
  }

  async function handleSavePendienteEdit(id: string) {
    if (editPendienteSaving) return;
    const payload = pendienteFormPayload(editPendienteForm);
    if (!payload.linea_codigo || !payload.linea_descripcion) {
      setPendientesError("Código y Descripción son obligatorios.");
      alert("Código y Descripción son obligatorios.");
      return;
    }

    setEditPendienteSaving(true);
    setPendientesError(null);

    const { data, error } = await supabase
      .from("logistica_inversa_pendientes")
      .update(payload)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error || !data) {
      const message = error?.message || "No se pudo guardar el pendiente.";
      console.error("Error al editar pendiente:", error);
      setPendientesError(`Error al guardar pendiente: ${message}`);
      alert("No se pudo guardar el pendiente.");
      setEditPendienteSaving(false);
      return;
    }

    setPendientesItems((prev) =>
      prev.map((row) => (row.id === id ? mapPendienteRow(data) : row))
    );
    setEditPendienteSaving(false);
    setEditingPendienteId(null);
    setEditPendienteForm(emptyPendienteForm());
    showInversaSaveToast("Pendiente guardado");
  }

  async function handleDeletePendiente(id: string) {
    if (deletingPendienteId != null) return;
    const ok = window.confirm("¿Eliminar este pendiente?");
    if (!ok) return;

    setDeletingPendienteId(id);
    setPendientesError(null);

    const { error } = await supabase
      .from("logistica_inversa_pendientes")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Error al eliminar pendiente:", error);
      setPendientesError(`Error al eliminar pendiente: ${error.message}`);
      alert("No se pudo eliminar el pendiente.");
      setDeletingPendienteId(null);
      return;
    }

    setPendientesItems((prev) => prev.filter((row) => row.id !== id));
    if (editingPendienteId === id) {
      cancelEditPendiente();
    }
    setDeletingPendienteId(null);
    showInversaSaveToast("Pendiente eliminado");
  }

  const tipoOperacionOptions = useMemo(
    () => uniqueSorted(items.map((i) => i.ot_tipo_operacion)),
    [items]
  );

  const rowsForOtOptions = useMemo(() => {
    const textQuery = normalize(filterTexto);
    return items.filter((item) => {
      if (!matchesTextAndTipo(item, textQuery, filterTipoOperacion)) {
        return false;
      }
      if (hideGreenRows && hasFechaEntrega(item.linea_fecha_entrega)) {
        return false;
      }
      return true;
    });
  }, [items, filterTexto, filterTipoOperacion, hideGreenRows]);

  const otNumeroOptions = useMemo(() => {
    const unique = Array.from(
      new Set(
        rowsForOtOptions
          .map((i) => (i.ot_numero != null ? String(i.ot_numero).trim() : ""))
          .filter((v) => v !== "")
      )
    );
    return sortOtNumeros(unique);
  }, [rowsForOtOptions]);

  useEffect(() => {
    if (filterOtNumero && !otNumeroOptions.includes(filterOtNumero)) {
      setFilterOtNumero("");
    }
  }, [filterOtNumero, otNumeroOptions]);

  const filtered = useMemo(() => {
    const textQuery = normalize(filterTexto);

    return items.filter((item) => {
      if (filterOtNumero) {
        const ot = item.ot_numero != null ? String(item.ot_numero) : "";
        if (ot !== filterOtNumero) return false;
      }

      if (!matchesTextAndTipo(item, textQuery, filterTipoOperacion)) {
        return false;
      }

      if (hideGreenRows && hasFechaEntrega(item.linea_fecha_entrega)) {
        return false;
      }

      return true;
    });
  }, [
    items,
    filterOtNumero,
    filterTexto,
    filterTipoOperacion,
    hideGreenRows,
  ]);

  const estadoRepuestoOptions = useMemo(
    () =>
      uniqueSorted([
        ...inversaItems.map((i) => i.estado_repuesto),
        ...pendientesItems.map((i) => i.estado_repuesto),
      ]),
    [inversaItems, pendientesItems]
  );

  const historialEstadoRepuestoOptions = useMemo(
    () => uniqueSorted(inversaItems.map((i) => i.estado_repuesto)),
    [inversaItems]
  );

  const filteredInversa = useMemo(() => {
    const textQuery = normalize(inversaFilterTexto);
    const estadoRepuestoNorm = new Set(
      estadoRepuestoFiltros.map((v) => normalize(v))
    );

    return inversaItems.filter((item) => {
      const estaCertificado = Boolean(item.certificado_at?.trim());
      const estaVendido = Boolean(item.vendido_chatarrero_at?.trim());
      const tieneFechaEntViejo =
        formatFechaEntrega(item.fecha_registro_retorno) !== "-";

      if (textQuery) {
        const haystack = normalize(
          [
            item.ot_numero != null ? String(item.ot_numero) : "",
            item.placa ?? "",
            item.cliente_nombre ?? "",
            item.linea_codigo ?? "",
            item.linea_descripcion ?? "",
          ].join(" ")
        );
        if (!haystack.includes(textQuery)) return false;
      }

      if (gestionEstadoFiltros.length > 0) {
        const matchesGestion = gestionEstadoFiltros.some((key) => {
          if (key === "vendido") return estaVendido;
          if (key === "certificado") return estaCertificado && !estaVendido;
          if (key === "pendiente") return !estaCertificado && tieneFechaEntViejo;
          return !tieneFechaEntViejo;
        });
        if (!matchesGestion) return false;
      }

      if (estadoRepuestoNorm.size > 0) {
        const rowEstado = normalize(item.estado_repuesto ?? "");
        if (!rowEstado || !estadoRepuestoNorm.has(rowEstado)) return false;
      }

      return true;
    });
  }, [
    inversaItems,
    inversaFilterTexto,
    gestionEstadoFiltros,
    estadoRepuestoFiltros,
  ]);

  const filteredPendientes = useMemo(() => {
    const textQuery = normalize(pendientesFilterTexto);
    if (!textQuery) return pendientesItems;
    return pendientesItems.filter((item) => {
      const haystack = normalize(
        [
          item.ot_numero != null ? String(item.ot_numero) : "",
          item.placa ?? "",
          item.linea_codigo ?? "",
          item.linea_descripcion ?? "",
        ].join(" ")
      );
      return haystack.includes(textQuery);
    });
  }, [pendientesItems, pendientesFilterTexto]);

  const editingInversaItem = useMemo(
    () => inversaItems.find((row) => row.id === editingId) ?? null,
    [inversaItems, editingId]
  );

  const editingPendienteItem = useMemo(
    () =>
      pendientesItems.find((row) => row.id === editingPendienteId) ?? null,
    [pendientesItems, editingPendienteId]
  );

  const inversaVirtualizer = useVirtualizer({
    count: filteredInversa.length,
    getScrollElement: () => inversaScrollRef.current,
    estimateSize: () => INVERSA_ROW_HEIGHT,
    overscan: 10,
  });

  useEffect(() => {
    inversaVirtualizer.measure();
  }, [filteredInversa.length]); // eslint-disable-line react-hooks/exhaustive-deps -- measure on layout-affecting changes

  const inversaVirtualItems = inversaVirtualizer.getVirtualItems();
  const lastVirtualIndex =
    inversaVirtualItems[inversaVirtualItems.length - 1]?.index ?? -1;

  // Infinite scroll: load next Supabase page near the end of the virtual list.
  useEffect(() => {
    if (
      tab !== "inversa" ||
      inversaSubTab !== "historial" ||
      !inversaHasMore ||
      inversaLoading
    )
      return;
    if (filteredInversa.length === 0 && inversaItems.length > 0) {
      // Filters hid everything loaded — prefetch more from server.
      void loadMoreInversa();
      return;
    }
    if (lastVirtualIndex < 0 || filteredInversa.length === 0) return;
    if (lastVirtualIndex >= Math.floor(filteredInversa.length * 0.8)) {
      void loadMoreInversa();
    }
  }, [
    tab,
    inversaSubTab,
    lastVirtualIndex,
    filteredInversa.length,
    inversaItems.length,
    inversaHasMore,
    inversaLoading,
    loadMoreInversa,
  ]);

  const tabButtonClass = (active: boolean) =>
    active
      ? "relative flex flex-1 items-center justify-center gap-2 bg-surface px-3 py-2.5 text-sm font-semibold text-accent sm:px-5"
      : "relative flex flex-1 items-center justify-center gap-2 bg-transparent px-3 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-white/60 hover:text-slate-700 sm:px-5";

  const inversaColSpan = 10;
  const inversaPaddingTop = inversaVirtualItems[0]?.start ?? 0;
  const inversaPaddingBottom =
    inversaVirtualizer.getTotalSize() -
    (inversaVirtualItems[inversaVirtualItems.length - 1]?.end ?? 0);

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Secciones de logística"
        className="flex overflow-hidden rounded-xl border border-border/80 bg-slate-50/80"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "control-ot"}
          onClick={() => setTab("control-ot")}
          className={tabButtonClass(tab === "control-ot")}
        >
          <ClipboardList className="h-4 w-4" aria-hidden />
          <span className="truncate">Control OT</span>
          {tab === "control-ot" ? (
            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "inversa"}
          onClick={() => setTab("inversa")}
          className={tabButtonClass(tab === "inversa")}
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          <span className="truncate">Logística Inversa</span>
          {tab === "inversa" ? (
            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "compras"}
          onClick={() => setTab("compras")}
          className={tabButtonClass(tab === "compras")}
        >
          <ShoppingCart className="h-4 w-4" aria-hidden />
          <span className="truncate">Compras</span>
          {tab === "compras" ? (
            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />
          ) : null}
        </button>
      </div>

      {tab === "control-ot" ? (
        <div role="tabpanel" className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-3">
            <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  OT
                </span>
                <select
                  value={filterOtNumero}
                  onChange={(e) => setFilterOtNumero(e.target.value)}
                  className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                >
                  <option value="">Todas las OT</option>
                  {otNumeroOptions.map((ot) => (
                    <option key={ot} value={ot}>
                      {ot}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Buscar
                </span>
                <div className="relative">
                  <input
                    type="search"
                    value={filterTexto}
                    onChange={(e) => setFilterTexto(e.target.value)}
                    placeholder="Buscar por Placa, Código o Descripción..."
                    className="w-full rounded-xl border border-border bg-white py-2.5 pl-3 pr-9 text-sm text-foreground outline-none transition placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                  {filterTexto ? (
                    <button
                      type="button"
                      onClick={() => setFilterTexto("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 transition hover:text-slate-700"
                      aria-label="Limpiar búsqueda"
                      title="Limpiar"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                      <span className="sr-only">✕</span>
                    </button>
                  ) : null}
                </div>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Tipo Operación
                </span>
                <select
                  value={filterTipoOperacion}
                  onChange={(e) => setFilterTipoOperacion(e.target.value)}
                  className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                >
                  <option value="">Todos</option>
                  {tipoOperacionOptions.map((tipo) => (
                    <option key={tipo} value={tipo}>
                      {tipo}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex shrink-0 flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:justify-end lg:pb-0.5">
              <button
                type="button"
                onClick={() => setHideGreenRows((prev) => !prev)}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
              >
                {hideGreenRows
                  ? "⚪ Mostrar con fecha"
                  : "🟢 Ocultar con fecha"}
              </button>
              <button
                type="button"
                onClick={() => void handleSyncOt()}
                disabled={syncing}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {syncing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    Sincronizando...
                  </>
                ) : (
                  "🔄 Sincronizar OT"
                )}
              </button>
            </div>
          </div>

          {syncMessage ? (
            <p
              role="status"
              className={`text-right text-[11px] ${
                syncMessage.type === "success"
                  ? "text-emerald-700"
                  : "text-red-600"
              }`}
            >
              {syncMessage.text}
            </p>
          ) : null}

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
                    <th className="px-4 py-3">OT</th>
                    <th className="px-4 py-3">Estado OT</th>
                    <th className="px-4 py-3">Modelo</th>
                    <th className="px-4 py-3">Placa</th>
                    <th className="px-4 py-3">Codigo</th>
                    <th className="px-4 py-3">Descripcion</th>
                    <th className="px-4 py-3">Cantidad</th>
                    <th className="px-4 py-3">Precio Unit</th>
                    <th className="px-4 py-3">Fecha Entrega</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-white">
                  {loading ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-4 py-12 text-center text-muted"
                      >
                        <span className="inline-flex items-center gap-2 text-sm">
                          <Loader2 className="h-4 w-4 animate-spin text-accent" />
                          Cargando Control OT…
                        </span>
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-4 py-12 text-center text-muted"
                      >
                        No se encontraron registros
                      </td>
                    </tr>
                  ) : (
                    filtered.map((item, index) => (
                      <tr
                        key={rowKey(item, index)}
                        className={rowHighlightClass(item)}
                      >
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-accent">
                          {item.ot_numero != null && item.ot_numero !== ""
                            ? String(item.ot_numero)
                            : "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                          {item.ot_status
                            ? labelOtStatus(item.ot_status)
                            : "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                          {item.vehiculo_modelo || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-foreground">
                          {item.vehiculo_placa || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-700">
                          {item.linea_codigo || "—"}
                        </td>
                        <td className="max-w-xs px-4 py-3 text-slate-700">
                          {item.linea_descripcion || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                          {formatCantidad(item.linea_cantidad)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700">
                          {formatPrecioPen(item.linea_precio_unitario_pen)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                          {formatFechaEntrega(item.linea_fecha_entrega)}
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
        </div>
      ) : null}

      {tab === "inversa" ? (
        <div role="tabpanel" className="space-y-4">
          <div
            role="tablist"
            aria-label="Secciones de logística inversa"
            className="mb-4 flex w-fit items-center gap-1 rounded-lg border border-gray-200 bg-gray-50/80 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={inversaSubTab === "historial"}
              onClick={() => setInversaSubTab("historial")}
              className={
                inversaSubTab === "historial"
                  ? "flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-blue-600 shadow-sm"
                  : "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700"
              }
            >
              <span aria-hidden>📋</span>
              Historial
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inversaSubTab === "pendientes"}
              onClick={() => setInversaSubTab("pendientes")}
              className={
                inversaSubTab === "pendientes"
                  ? "flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-blue-600 shadow-sm"
                  : "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700"
              }
            >
              <span aria-hidden>⏳</span>
              Pendientes
            </button>
          </div>

          {inversaSubTab === "historial" ? (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-end">
              <label className="block min-w-0 flex-1">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Buscar
                </span>
                <div className="relative">
                  <input
                    type="search"
                    value={inversaFilterTexto}
                    onChange={(e) => setInversaFilterTexto(e.target.value)}
                    placeholder="OT, Cliente, Placa, Código o Descripción..."
                    className="w-full rounded-xl border border-border bg-white py-2.5 pl-3 pr-9 text-sm text-foreground outline-none transition placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                  {inversaFilterTexto ? (
                    <button
                      type="button"
                      onClick={() => setInversaFilterTexto("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 transition hover:text-slate-700"
                      aria-label="Limpiar búsqueda"
                      title="Limpiar"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                      <span className="sr-only">✕</span>
                    </button>
                  ) : null}
                </div>
              </label>

              <MultiSelectDropdown
                label="Estado"
                options={GESTION_ESTADO_OPTIONS}
                selected={gestionEstadoFiltros}
                onChange={setGestionEstadoFiltros}
              />
              <MultiSelectDropdown
                label="Estado Repuesto"
                options={historialEstadoRepuestoOptions.map((value) => ({
                  value,
                  label: value,
                }))}
                selected={estadoRepuestoFiltros}
                onChange={setEstadoRepuestoFiltros}
              />
            </div>

            <div className="flex shrink-0 flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:justify-end lg:pb-0.5">
              <button
                type="button"
                onClick={handleExportInversaExcel}
                disabled={filteredInversa.length === 0}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 shadow-sm transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FileSpreadsheet
                  className="h-3.5 w-3.5 text-emerald-600"
                  aria-hidden
                />
                Exportar Excel
              </button>
              <button
                type="button"
                onClick={() => void handleSyncInversa()}
                disabled={inversaSyncing}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {inversaSyncing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    Sincronizando...
                  </>
                ) : (
                  "🔄 Sincronizar Historial"
                )}
              </button>
            </div>
          </div>
          ) : (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-3">
            <label className="block min-w-0 flex-1">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Buscar
              </span>
              <div className="relative">
                <input
                  type="search"
                  value={pendientesFilterTexto}
                  onChange={(e) => setPendientesFilterTexto(e.target.value)}
                  placeholder="OT, Placa, Código o Descripción..."
                  className="w-full rounded-xl border border-border bg-white py-2.5 pl-3 pr-9 text-sm text-foreground outline-none transition placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
                {pendientesFilterTexto ? (
                  <button
                    type="button"
                    onClick={() => setPendientesFilterTexto("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 transition hover:text-slate-700"
                    aria-label="Limpiar búsqueda"
                    title="Limpiar"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                    <span className="sr-only">✕</span>
                  </button>
                ) : null}
              </div>
            </label>
            <button
              type="button"
              onClick={startAddPendiente}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-xs font-medium text-accent shadow-sm transition hover:bg-accent/20"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Agregar Pendiente
            </button>
          </div>
          )}

          {inversaSubTab === "historial" && inversaSyncMessage ? (
            <p
              role="status"
              className={`text-right text-[11px] ${
                inversaSyncMessage.type === "success"
                  ? "text-emerald-700"
                  : "text-red-600"
              }`}
            >
              {inversaSyncMessage.text}
            </p>
          ) : null}

          {inversaSubTab === "historial" && inversaError ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {inversaError}
            </div>
          ) : null}

          {inversaSubTab === "historial" && editError ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {editError}
            </div>
          ) : null}

          {inversaSubTab === "pendientes" && pendientesError ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {pendientesError}
            </div>
          ) : null}

          {inversaSaveToast ? (
            <p role="status" className="text-right text-[11px] text-emerald-700">
              {inversaSaveToast}
            </p>
          ) : null}

          {inversaSubTab === "historial" ? (
          <div className="overflow-hidden rounded-xl border border-border">
            <div
              ref={inversaScrollRef}
              className="w-full overflow-y-auto overflow-x-hidden"
              style={{ height: "calc(100vh - 220px)" }}
            >
              <table className="w-full table-fixed divide-y divide-border text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-[72px] px-1.5 py-2">Fecha Ent. Nuevo</th>
                    <th className="w-[130px] px-1.5 py-2">Cliente</th>
                    <th className="w-[56px] px-1.5 py-2">OT</th>
                    <th className="w-[70px] px-1.5 py-2">Placa</th>
                    <th className="w-[100px] px-1.5 py-2">Código</th>
                    <th className="min-w-0 px-1.5 py-2">Descripción</th>
                    <th className="w-10 px-1.5 py-2">Cant.</th>
                    <th className="w-[96px] px-1.5 py-2">Estado Repuesto</th>
                    <th className="w-[72px] px-1.5 py-2">Fecha Ent. Viejo</th>
                    <th className="w-36 px-1.5 py-2">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-white">
                  {inversaLoading ? (
                    <tr>
                      <td
                        colSpan={inversaColSpan}
                        className="px-4 py-12 text-center text-muted"
                      >
                        <span className="inline-flex items-center gap-2 text-sm">
                          <Loader2 className="h-4 w-4 animate-spin text-accent" />
                          Cargando Logística Inversa…
                        </span>
                      </td>
                    </tr>
                  ) : filteredInversa.length === 0 ? (
                    <tr>
                      <td
                        colSpan={inversaColSpan}
                        className="px-4 py-12 text-center text-muted"
                      >
                        {inversaItems.length === 0 &&
                        !inversaFilterTexto &&
                        gestionEstadoFiltros.length === 0 &&
                        estadoRepuestoFiltros.length === 0
                          ? "No hay registros en la base de datos. Si en Supabase sí hay filas, revisa las políticas RLS (SELECT) de public.logistica_inversa."
                          : "No se encontraron registros"}
                      </td>
                    </tr>
                  ) : (
                    <>
                      {inversaPaddingTop > 0 ? (
                        <tr aria-hidden>
                          <td
                            colSpan={inversaColSpan}
                            style={{
                              height: inversaPaddingTop,
                              padding: 0,
                              border: "none",
                            }}
                          />
                        </tr>
                      ) : null}
                      {inversaVirtualItems.map((virtualRow) => {
                        const item = filteredInversa[virtualRow.index];
                        if (!item) return null;
                        const rowId = String(item.id);
                        const isSealed = Boolean(item.certificado_at);
                        const isCertifying = certifyingId === rowId;
                        const isClearing = clearingId === rowId;

                        return (
                          <FragmentRow
                            key={rowId}
                            item={item}
                            isSealed={isSealed}
                            isCertifying={isCertifying}
                            isClearing={isClearing}
                            isSelling={sellingId === rowId}
                            canCertify={canCertify}
                            onStartEdit={() => startEditInversa(item)}
                            onLimpiar={() => void handleLimpiarInversa(rowId)}
                            onCertificar={() => void handleCertificar(rowId)}
                            onVenderChatarrero={() =>
                              void handleVenderChatarrero(rowId)
                            }
                          />
                        );
                      })}
                      {inversaPaddingBottom > 0 ? (
                        <tr aria-hidden>
                          <td
                            colSpan={inversaColSpan}
                            style={{
                              height: inversaPaddingBottom,
                              padding: 0,
                              border: "none",
                            }}
                          />
                        </tr>
                      ) : null}
                      {inversaLoadingMore ? (
                        <tr>
                          <td
                            colSpan={inversaColSpan}
                            className="px-4 py-3 text-center text-muted"
                          >
                            <span className="inline-flex items-center gap-2 text-xs">
                              <Loader2
                                className="h-3.5 w-3.5 animate-spin text-accent"
                                aria-hidden
                              />
                              Cargando más registros…
                            </span>
                          </td>
                        </tr>
                      ) : null}
                    </>
                  )}
                </tbody>
              </table>
            </div>
            {!inversaLoading ? (
              <div className="border-t border-border bg-slate-50/80 px-4 py-2.5 text-xs text-muted">
                {filteredInversa.length} de {inversaItems.length} registro
                {inversaItems.length === 1 ? "" : "s"}
                {inversaHasMore ? " · hay más en servidor" : ""}
              </div>
            ) : null}
          </div>
          ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="w-full overflow-x-auto">
              <table className="w-full table-fixed divide-y divide-border text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-[60px] px-1.5 py-2">OT</th>
                    <th className="w-20 px-1.5 py-2">Placa</th>
                    <th className="w-[90px] px-1.5 py-2">Código</th>
                    <th className="min-w-[300px] max-w-[450px] px-1.5 py-2">
                      Descripción
                    </th>
                    <th className="w-10 px-1.5 py-2">Cant.</th>
                    <th className="w-20 px-1.5 py-2">Fecha Ingreso</th>
                    <th className="w-[120px] px-1.5 py-2">Resp. Recepción</th>
                    <th className="w-20 px-1.5 py-2">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-white">
                  {pendientesLoading ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-12 text-center text-muted"
                      >
                        <span className="inline-flex items-center gap-2 text-sm">
                          <Loader2 className="h-4 w-4 animate-spin text-accent" />
                          Cargando pendientes…
                        </span>
                      </td>
                    </tr>
                  ) : filteredPendientes.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-12 text-center text-muted"
                      >
                        {pendientesItems.length === 0 && !pendientesFilterTexto
                          ? "No hay pendientes. Usa Agregar Pendiente para crear uno."
                          : "No se encontraron registros"}
                      </td>
                    </tr>
                  ) : (
                    filteredPendientes.map((item) => (
                      <PendienteRow
                        key={item.id}
                        item={item}
                        isDeleting={deletingPendienteId === item.id}
                        onStartEdit={() => startEditPendiente(item)}
                        onDelete={() => void handleDeletePendiente(item.id)}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {!pendientesLoading ? (
              <div className="border-t border-border bg-slate-50/80 px-4 py-2.5 text-xs text-muted">
                {filteredPendientes.length} de {pendientesItems.length} registro
                {pendientesItems.length === 1 ? "" : "s"}
              </div>
            ) : null}
          </div>
          )}

          {editingInversaItem && !editingInversaItem.certificado_at ? (
            <InversaEditModal
              item={editingInversaItem}
              form={editForm}
              onChange={setEditForm}
              planillaOptions={planillaOptions}
              estadoRepuestoOptions={estadoRepuestoOptions}
              saving={editSaving}
              onSave={() => void handleSaveInversaEdit(editingInversaItem.id)}
              onCancel={cancelEditInversa}
            />
          ) : null}

          {addingPendiente ? (
            <PendienteModal
              title="Nuevo pendiente"
              form={addPendienteForm}
              onChange={setAddPendienteForm}
              planillaOptions={planillaOptions}
              estadoRepuestoOptions={estadoRepuestoOptions}
              saving={addPendienteSaving}
              onSave={() => void handleSaveNewPendiente()}
              onCancel={cancelAddPendiente}
            />
          ) : null}

          {editingPendienteItem ? (
            <PendienteModal
              title="Editar pendiente"
              form={editPendienteForm}
              onChange={setEditPendienteForm}
              planillaOptions={planillaOptions}
              estadoRepuestoOptions={estadoRepuestoOptions}
              saving={editPendienteSaving}
              createdAt={editingPendienteItem.created_at}
              onSave={() => void handleSavePendienteEdit(editingPendienteItem.id)}
              onCancel={cancelEditPendiente}
            />
          ) : null}
        </div>
      ) : null}

      {tab === "compras" ? <LogisticaComprasTab /> : null}
    </div>
  );
}

function TruncCell({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  return (
    <span className={`block truncate ${className}`} title={value}>
      {value}
    </span>
  );
}

function MultiSelectDropdown<T extends string>({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  selected: T[];
  onChange: (next: T[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  function toggle(value: T) {
    if (selectedSet.has(value)) {
      onChange(selected.filter((item) => item !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  const count = selected.length;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm shadow-sm transition ${
          count > 0
            ? "border-accent/40 bg-accent/10 text-accent"
            : "border-gray-300 bg-white text-slate-700 hover:bg-slate-50"
        }`}
      >
        {count > 0 ? `${label} (${count})` : label} ▾
      </button>
      {open ? (
        <div
          role="listbox"
          aria-multiselectable
          className="absolute left-0 z-30 mt-1 min-w-[240px] rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        >
          <div className="flex items-center justify-end border-b border-gray-100 px-2 pb-1">
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={count === 0}
              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 disabled:opacity-40"
            >
              Limpiar
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {options.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-400">Sin opciones</p>
            ) : (
              options.map((opt) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedSet.has(opt.value)}
                    onChange={() => toggle(opt.value)}
                    className="h-3.5 w-3.5 rounded border-gray-300"
                  />
                  <span className="truncate" title={opt.label}>
                    {opt.label}
                  </span>
                </label>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FragmentRow({
  item,
  isSealed,
  isCertifying,
  isClearing,
  isSelling,
  canCertify,
  onStartEdit,
  onLimpiar,
  onCertificar,
  onVenderChatarrero,
}: {
  item: LogisticaInversaRow;
  isSealed: boolean;
  isCertifying: boolean;
  isClearing: boolean;
  isSelling: boolean;
  canCertify: boolean;
  onStartEdit: () => void;
  onLimpiar: () => void;
  onCertificar: () => void;
  onVenderChatarrero: () => void;
}) {
  const desc = cellDash(item.linea_descripcion);
  const cliente = cellDash(item.cliente_nombre);
  const sold = Boolean(item.vendido_chatarrero_at);

  return (
    <>
      <tr
        className={
          isSealed
            ? "bg-slate-50/70 transition"
            : "transition hover:bg-accent/5"
        }
      >
        <td className="w-[72px] px-1.5 py-2 text-slate-700">
          <TruncCell value={formatFechaEntrega(item.linea_fecha_entrega)} />
        </td>
        <td className="w-[130px] px-1.5 py-2 text-slate-700">
          <TruncCell value={cliente} />
        </td>
        <td className="w-[56px] px-1.5 py-2 font-mono text-[11px] font-semibold text-accent">
          <TruncCell
            value={
              item.ot_numero != null && item.ot_numero !== ""
                ? String(item.ot_numero)
                : "-"
            }
          />
        </td>
        <td className="w-[70px] px-1.5 py-2 font-medium text-foreground">
          <TruncCell value={cellDash(item.placa)} />
        </td>
        <td className="w-[100px] px-1.5 py-2 font-mono text-[11px] text-slate-700">
          <TruncCell value={cellDash(item.linea_codigo)} />
        </td>
        <td className="min-w-0 px-1.5 py-2 text-slate-700">
          <TruncCell value={desc} />
        </td>
        <td className="w-10 px-1.5 py-2 text-center text-slate-700">
          {item.linea_cantidad == null || item.linea_cantidad === ""
            ? "-"
            : formatCantidad(item.linea_cantidad)}
        </td>
        <td className="w-[96px] px-1.5 py-2 text-slate-700">
          <TruncCell value={cellDash(item.estado_repuesto)} />
        </td>
        <td className="w-[72px] px-1.5 py-2 text-slate-700">
          <TruncCell
            value={
              item.fecha_registro_retorno
                ? formatFechaEntrega(item.fecha_registro_retorno)
                : "-"
            }
          />
        </td>
        <td className="w-36 px-1.5 py-2">
          <div className="flex items-center gap-1">
            {sold ? (
              <span
                className={`${ICON_BTN} cursor-default border-gray-200 bg-gray-50 text-gray-400`}
                title={`Vendido al chatarrero ${formatFechaEntrega(item.vendido_chatarrero_at)}`}
              >
                <Recycle className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only">
                  Vendido al chatarrero{" "}
                  {formatFechaEntrega(item.vendido_chatarrero_at)}
                </span>
              </span>
            ) : isSealed ? (
              <>
                <span
                  className={`${ICON_BTN} cursor-default border-gray-200 bg-gray-50 text-gray-400`}
                  title="Certificado"
                >
                  <Lock className="h-3.5 w-3.5" aria-hidden />
                  <span className="sr-only">Certificado</span>
                </span>
                <button
                  type="button"
                  onClick={onVenderChatarrero}
                  disabled={isSelling}
                  title="Vendido al chatarrero"
                  aria-label="Vendido al chatarrero"
                  className={`${ICON_BTN} border-green-800/30 bg-green-50 text-green-800 hover:bg-green-100`}
                >
                  {isSelling ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Recycle className="h-3.5 w-3.5" aria-hidden />
                  )}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onStartEdit}
                  title="Editar"
                  aria-label="Editar"
                  className={`${ICON_BTN} border-gray-200 bg-white text-slate-600 hover:bg-slate-50`}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={onLimpiar}
                  disabled={isClearing || isCertifying}
                  title="Limpiar"
                  aria-label="Limpiar"
                  className={`${ICON_BTN} border-red-200 bg-red-50 text-red-500 hover:bg-red-100`}
                >
                  {isClearing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  )}
                </button>
                {canCertify ? (
                  <button
                    type="button"
                    onClick={onCertificar}
                    disabled={isCertifying || isClearing}
                    title="Certificar"
                    aria-label="Certificar"
                    className={`${ICON_BTN} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
                  >
                    {isCertifying ? (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin"
                        aria-hidden
                      />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    )}
                  </button>
                ) : null}
              </>
            )}
          </div>
        </td>
      </tr>
    </>
  );
}

function DialogShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-4 shadow-xl sm:p-6"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className={`${ICON_BTN} border-gray-200 bg-white text-gray-500 hover:bg-gray-50`}
            aria-label="Cerrar"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ReadonlyField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-800">
        {value}
      </p>
    </div>
  );
}

function InversaEditModal({
  item,
  form,
  onChange,
  planillaOptions,
  estadoRepuestoOptions,
  saving,
  onSave,
  onCancel,
}: {
  item: LogisticaInversaRow;
  form: InversaEditForm;
  onChange: (
    updater: InversaEditForm | ((prev: InversaEditForm) => InversaEditForm)
  ) => void;
  planillaOptions: PlanillaPersona[];
  estadoRepuestoOptions: string[];
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <DialogShell title="Editar registro" onClose={onCancel}>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <ReadonlyField
          label="OT"
          value={
            item.ot_numero != null && item.ot_numero !== ""
              ? String(item.ot_numero)
              : "-"
          }
        />
        <ReadonlyField label="Código" value={cellDash(item.linea_codigo)} />
        <ReadonlyField
          label="Descripción"
          value={cellDash(item.linea_descripcion)}
        />
        <ReadonlyField
          label="Cantidad"
          value={
            item.linea_cantidad == null || item.linea_cantidad === ""
              ? "-"
              : formatCantidad(item.linea_cantidad)
          }
        />
        <ReadonlyField label="Placa" value={cellDash(item.placa)} />
        <ReadonlyField label="Cliente" value={cellDash(item.cliente_nombre)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Fecha Entrega Viejo
          </span>
          <input
            type="date"
            value={form.fecha_registro_retorno}
            onChange={(e) =>
              onChange((prev) => ({
                ...prev,
                fecha_registro_retorno: e.target.value,
              }))
            }
            className={MODAL_INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Responsable Entrega
          </span>
          <select
            value={form.responsable_entrega}
            onChange={(e) =>
              onChange((prev) => ({
                ...prev,
                responsable_entrega: e.target.value,
              }))
            }
            className={MODAL_INPUT_CLASS}
          >
            <option value="">Seleccionar responsable…</option>
            {planillaOptions.map((p) => {
              const name = planillaOptionLabel(p);
              return (
                <option key={String(p.id)} value={name}>
                  {name}
                </option>
              );
            })}
            {form.responsable_entrega &&
            !planillaOptions.some(
              (p) => planillaOptionLabel(p) === form.responsable_entrega
            ) ? (
              <option value={form.responsable_entrega}>
                {form.responsable_entrega}
              </option>
            ) : null}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Estado Repuesto
          </span>
          <input
            type="text"
            list="estados-repuesto-modal-historial"
            value={form.estado_repuesto}
            onChange={(e) =>
              onChange((prev) => ({
                ...prev,
                estado_repuesto: e.target.value,
              }))
            }
            placeholder="Escribir o elegir…"
            className={MODAL_INPUT_CLASS}
          />
          <datalist id="estados-repuesto-modal-historial">
            {estadoRepuestoOptions.map((opt) => (
              <option key={opt} value={opt} />
            ))}
          </datalist>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Observaciones
          </span>
          <textarea
            value={form.observaciones}
            onChange={(e) =>
              onChange((prev) => ({
                ...prev,
                observaciones: e.target.value,
              }))
            }
            rows={3}
            placeholder="Opcional"
            className={MODAL_INPUT_CLASS}
          />
        </label>
      </div>

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-200 disabled:opacity-60"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : null}
          Guardar
        </button>
      </div>
    </DialogShell>
  );
}

function PendienteModal({
  title,
  form,
  onChange,
  planillaOptions,
  estadoRepuestoOptions,
  saving,
  createdAt,
  onSave,
  onCancel,
}: {
  title: string;
  form: PendienteForm;
  onChange: (
    updater: PendienteForm | ((prev: PendienteForm) => PendienteForm)
  ) => void;
  planillaOptions: PlanillaPersona[];
  estadoRepuestoOptions: string[];
  saving: boolean;
  createdAt?: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <DialogShell title={title} onClose={onCancel}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            OT
          </span>
          <input
            type="text"
            value={form.ot_numero}
            onChange={(e) =>
              onChange((prev) => ({ ...prev, ot_numero: e.target.value }))
            }
            className={MODAL_INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Placa
          </span>
          <input
            type="text"
            value={form.placa}
            onChange={(e) =>
              onChange((prev) => ({ ...prev, placa: e.target.value }))
            }
            className={MODAL_INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Código *
          </span>
          <input
            type="text"
            value={form.linea_codigo}
            onChange={(e) =>
              onChange((prev) => ({ ...prev, linea_codigo: e.target.value }))
            }
            className={MODAL_INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Descripción *
          </span>
          <input
            type="text"
            value={form.linea_descripcion}
            onChange={(e) =>
              onChange((prev) => ({
                ...prev,
                linea_descripcion: e.target.value,
              }))
            }
            className={MODAL_INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Cant.
          </span>
          <input
            type="number"
            min={1}
            value={form.linea_cantidad}
            onChange={(e) =>
              onChange((prev) => ({ ...prev, linea_cantidad: e.target.value }))
            }
            className={MODAL_INPUT_CLASS}
          />
        </label>
        {createdAt ? (
          <ReadonlyField
            label="Fecha Ingreso"
            value={formatFechaEntrega(createdAt)}
          />
        ) : null}
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Resp. Recepción
          </span>
          <select
            value={form.responsable_recepcion}
            onChange={(e) =>
              onChange((prev) => ({
                ...prev,
                responsable_recepcion: e.target.value,
              }))
            }
            className={MODAL_INPUT_CLASS}
          >
            <option value="">Seleccionar responsable…</option>
            {planillaOptions.map((p) => {
              const name = planillaOptionLabel(p);
              return (
                <option key={String(p.id)} value={name}>
                  {name}
                </option>
              );
            })}
            {form.responsable_recepcion &&
            !planillaOptions.some(
              (p) => planillaOptionLabel(p) === form.responsable_recepcion
            ) ? (
              <option value={form.responsable_recepcion}>
                {form.responsable_recepcion}
              </option>
            ) : null}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Estado Repuesto
          </span>
          <input
            type="text"
            list="estados-repuesto-modal-pendiente"
            value={form.estado_repuesto}
            onChange={(e) =>
              onChange((prev) => ({ ...prev, estado_repuesto: e.target.value }))
            }
            placeholder="Escribir o elegir…"
            className={MODAL_INPUT_CLASS}
          />
          <datalist id="estados-repuesto-modal-pendiente">
            {estadoRepuestoOptions.map((opt) => (
              <option key={opt} value={opt} />
            ))}
          </datalist>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Observaciones
          </span>
          <textarea
            value={form.observaciones}
            onChange={(e) =>
              onChange((prev) => ({ ...prev, observaciones: e.target.value }))
            }
            rows={3}
            className={MODAL_INPUT_CLASS}
          />
        </label>
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-200 disabled:opacity-60"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : null}
          Guardar
        </button>
      </div>
    </DialogShell>
  );
}

function PendienteRow({
  item,
  isDeleting,
  onStartEdit,
  onDelete,
}: {
  item: LogisticaInversaPendienteRow;
  isDeleting: boolean;
  onStartEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <tr className="transition hover:bg-accent/5">
      <td className="w-[60px] px-1.5 py-2 font-mono text-[11px] font-semibold text-accent">
        <TruncCell
          value={
            item.ot_numero != null && item.ot_numero !== ""
              ? String(item.ot_numero)
              : "-"
          }
        />
      </td>
      <td className="w-20 px-1.5 py-2 font-medium text-foreground">
        <TruncCell value={cellDash(item.placa)} />
      </td>
      <td className="w-[90px] px-1.5 py-2 font-mono text-[11px] text-slate-700">
        <TruncCell value={cellDash(item.linea_codigo)} />
      </td>
      <td className="min-w-[300px] max-w-[450px] px-1.5 py-2 text-slate-700">
        <TruncCell
          value={cellDash(item.linea_descripcion)}
          className="max-w-[450px]"
        />
      </td>
      <td className="w-10 px-1.5 py-2 text-center text-slate-700">
        {item.linea_cantidad == null || item.linea_cantidad === ""
          ? "-"
          : formatCantidad(item.linea_cantidad)}
      </td>
      <td className="w-20 px-1.5 py-2 text-slate-700">
        <TruncCell value={formatFechaEntrega(item.created_at)} />
      </td>
      <td className="w-[120px] px-1.5 py-2 text-slate-700">
        <TruncCell value={cellDash(item.responsable_recepcion)} />
      </td>
      <td className="w-20 px-1.5 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onStartEdit}
            title="Editar"
            aria-label="Editar"
            className={`${ICON_BTN} border-gray-200 bg-white text-slate-600 hover:bg-slate-50`}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={isDeleting}
            title="Eliminar"
            aria-label="Eliminar"
            className={`${ICON_BTN} border-red-200 bg-red-50 text-red-500 hover:bg-red-100`}
          >
            {isDeleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
        </div>
      </td>
    </tr>
  );
}
