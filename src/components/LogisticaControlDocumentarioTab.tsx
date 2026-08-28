"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Eye,
  FileSpreadsheet,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import * as XLSX from "xlsx";
import DocumentoDetalleModal, {
  type DocumentoAdjunto,
  type DocumentoDetalle,
} from "@/components/control-documentario/DocumentoDetalleModal";
import { usePermisos } from "@/lib/auth/usePermisos";

const INPUT_CLASS =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-foreground outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";
const ICON_BTN =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border p-1 transition disabled:cursor-not-allowed disabled:opacity-60";
const PAGE_SIZE = 50;
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10_485_760;
const EMPRESA_DEFAULT = "Nexo Motor S.A.C.";
const AUTORIZA_DEFAULT = "Jefe de Logística";
const TIPOS_PAGO = ["Caja Chica", "Programado", "Otros"] as const;
const TIPOS_DOCUMENTO = ["Factura", "Boleta", "Otros"] as const;
const RAZONES_DELIVERY = ["INDRIVE", "OTRO"] as const;
const TEXTO_SIN_OC = "Sin OC";
const MIME_OK = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/xml",
  "text/xml",
  "application/zip",
  "application/x-zip-compressed",
  "text/html",
]);
const ADJUNTO_EXT_OK = new Set([
  "pdf",
  "doc",
  "docx",
  "xml",
  "zip",
  "html",
  "htm",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "heic",
  "heif",
]);

type DocumentoListItem = {
  id: string;
  es_delivery: boolean;
  numero_oc: string | null;
  tipo_pago: string;
  empresa: string;
  autoriza: string;
  fecha_emision: string;
  tipo_documento: string;
  numero_documento: string | null;
  ruc: string | null;
  razon_social: string | null;
  placa: string | null;
  descripcion: string | null;
  valor_sin_igv: number | string | null;
  valor_con_igv: number | string | null;
  observaciones: string | null;
  confirmado: boolean;
  confirmado_at: string | null;
  adjuntos_count?: number;
};

type LineaDisponible = {
  sigma_id: number;
  numero_oc: string;
  linea_orden: number;
  codigo_repuesto: string;
  descripcion_repuesto: string | null;
  cantidad: number | string | null;
  precio_total_con_igv_soles: number | string | null;
  ya_en_documento?: boolean;
};

type OcOption = {
  sigma_id: number;
  numero_oc: string;
  proveedor: string | null;
  nro_document: string | null;
};

type ApiList = {
  success: boolean;
  error?: string;
  items?: DocumentoListItem[];
  total?: number;
  page?: number;
  page_size?: number;
  has_more?: boolean;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatFecha(value: string | null | undefined) {
  if (!value) return "-";
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatFechaHora(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return `${formatFecha(value)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatSoles(value: number | string | null | undefined) {
  if (value == null || value === "") return "-";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "-";
  return `S/ ${n.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function toMoney(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function fileExt(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function isAllowedAdjuntoFile(file: File) {
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  if (MIME_OK.has(mime)) return true;
  return ADJUNTO_EXT_OK.has(fileExt(file.name));
}

function lineKey(item: { sigma_id: number; linea_orden: number }) {
  return `${item.sigma_id}:${item.linea_orden}`;
}

function resumenRepuestos(lineas: LineaDisponible[]) {
  return lineas
    .map((l) => {
      const cant = l.cantidad == null || l.cantidad === "" ? "1" : String(l.cantidad);
      const desc = (l.descripcion_repuesto ?? "").trim();
      return `${cant}x ${l.codigo_repuesto}${desc ? ` ${desc}` : ""}`;
    })
    .join(", ");
}

function formatBytes(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function ocLabel(item: DocumentoListItem) {
  const oc = (item.numero_oc ?? "").trim();
  if (item.es_delivery && (!oc || oc === TEXTO_SIN_OC)) return "Delivery";
  if (oc) return oc;
  return "-";
}

function TruncCell({ value }: { value: string }) {
  return (
    <span className="block max-w-[220px] truncate" title={value}>
      {value}
    </span>
  );
}

export default function LogisticaControlDocumentarioTab() {
  const { puede } = usePermisos();
  const canCrear = puede("logistica", "control_documentario", "crear");
  const canEditar = puede("logistica", "control_documentario", "editar");
  const canEliminar = puede("logistica", "control_documentario", "eliminar");
  const canConfirmar = puede("logistica", "control_documentario", "confirmar");
  const canExportar = puede("logistica", "control_documentario", "exportar");
  const canSubirAdjuntos = puede(
    "logistica",
    "control_documentario",
    "adjuntos_subir"
  );
  const canEliminarAdjuntos = puede(
    "logistica",
    "control_documentario",
    "adjuntos_eliminar"
  );
  const canDescargarAdjuntos = puede(
    "logistica",
    "control_documentario",
    "adjuntos_descargar"
  );
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [items, setItems] = useState<DocumentoListItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<DocumentoListItem | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchPage = useCallback(
    async (nextPage: number, append: boolean) => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (fechaDesde) params.set("fecha_desde", fechaDesde);
      if (fechaHasta) params.set("fecha_hasta", fechaHasta);
      params.set("page", String(nextPage));
      params.set("page_size", String(PAGE_SIZE));
      const res = await fetch(`/api/control-documentario?${params.toString()}`);
      const json = (await res.json()) as ApiList;
      if (!res.ok || json.success === false) {
        throw new Error(json.error || "Error al cargar documentos");
      }
      const rows = json.items ?? [];
      setItems((prev) => (append ? [...prev, ...rows] : rows));
      setHasMore(Boolean(json.has_more));
      setPage(nextPage);
    },
    [search, fechaDesde, fechaHasta]
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await fetchPage(1, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar");
      setItems([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function flash(type: "success" | "error", text: string) {
    if (msgTimer.current) clearTimeout(msgTimer.current);
    setMessage({ type, text });
    msgTimer.current = setTimeout(() => setMessage(null), 4000);
  }

  function openDetail(id: string) {
    setDetailId(id);
  }

  async function handleDelete(item: DocumentoListItem) {
    if (item.confirmado) return;
    if (!window.confirm("¿Eliminar este documento? Esta acción no se puede deshacer.")) {
      return;
    }
    setDeletingId(item.id);
    try {
      const res = await fetch(`/api/control-documentario/${item.id}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error || "No se pudo eliminar");
      flash("success", "Documento eliminado.");
      await reload();
    } catch (err) {
      flash("error", err instanceof Error ? err.message : "Error al eliminar");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleConfirm() {
    if (!confirmTarget || confirming) return;
    setConfirming(true);
    try {
      const res = await fetch(
        `/api/control-documentario/${confirmTarget.id}/confirmar`,
        { method: "POST" }
      );
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error || "No se pudo confirmar");
      flash("success", "Documento confirmado.");
      setConfirmTarget(null);
      await reload();
    } catch (err) {
      flash("error", err instanceof Error ? err.message : "Error al confirmar");
    } finally {
      setConfirming(false);
    }
  }

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      const all: DocumentoListItem[] = [];
      let next = 1;
      for (;;) {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        if (fechaDesde) params.set("fecha_desde", fechaDesde);
        if (fechaHasta) params.set("fecha_hasta", fechaHasta);
        params.set("page", String(next));
        params.set("page_size", "100");
        const res = await fetch(`/api/control-documentario?${params.toString()}`);
        const json = (await res.json()) as ApiList;
        if (!res.ok || json.success === false) {
          throw new Error(json.error || "Error al exportar");
        }
        all.push(...(json.items ?? []));
        if (!json.has_more) break;
        next += 1;
      }
      if (all.length === 0) {
        flash("error", "No hay resultados para los filtros actuales.");
        return;
      }
      const rows = all.map((item) => ({
        OC: ocLabel(item),
        "Tipo Pago": item.tipo_pago,
        Empresa: item.empresa,
        Autoriza: item.autoriza,
        "Fecha Emisión": formatFecha(item.fecha_emision),
        "Tipo Doc.": item.tipo_documento,
        "N° Documento": item.numero_documento ?? "",
        RUC: item.ruc ?? "",
        "Razón Social": item.razon_social ?? "",
        Placa: item.placa ?? "",
        Descripción: item.descripcion ?? "",
        "Valor Sin IGV": toMoney(item.valor_sin_igv),
        "Valor Con IGV": toMoney(item.valor_con_igv),
        Adjuntos: item.adjuntos_count ?? 0,
        Estado: item.confirmado
          ? `Confirmado ${formatFechaHora(item.confirmado_at)}`
          : "Borrador",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Control Documentario");
      XLSX.writeFile(wb, `control_documentario_${todayYmd()}.xlsx`);
    } catch (err) {
      flash("error", err instanceof Error ? err.message : "Error al exportar");
    } finally {
      setExporting(false);
    }
  }

  const fechaInvalid = Boolean(fechaDesde && fechaHasta && fechaDesde > fechaHasta);

  return (
    <div role="tabpanel" className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-3">
        <label className="block min-w-0 flex-1">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Buscar
          </span>
          <div className="relative">
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar OC, documento, RUC, razón social..."
              className="w-full rounded-xl border border-border bg-white py-2.5 pl-3 pr-9 text-sm outline-none transition placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            {searchInput ? (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </label>
        <div className="flex items-end gap-1.5">
          <label className="block w-[150px]">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Desde
            </span>
            <input
              type="date"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
              className={`w-full rounded-xl border bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 ${
                fechaInvalid
                  ? "border-red-400 focus:ring-red-500/20"
                  : "border-border focus:border-accent focus:ring-accent/20"
              }`}
            />
          </label>
          <label className="block w-[150px]">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Hasta
            </span>
            <input
              type="date"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
              className={`w-full rounded-xl border bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 ${
                fechaInvalid
                  ? "border-red-400 focus:ring-red-500/20"
                  : "border-border focus:border-accent focus:ring-accent/20"
              }`}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setFechaDesde("");
              setFechaHasta("");
            }}
            disabled={!fechaDesde && !fechaHasta}
            className="mb-0.5 rounded-lg border border-border bg-white px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Limpiar
          </button>
        </div>
        <div className="flex shrink-0 gap-1">
          {canCrear ? (
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setEditorOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent/20"
          >
            <Plus className="h-3.5 w-3.5" />
            Nuevo Registro
          </button>
          ) : null}
          {canExportar ? (
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting || loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-3.5 w-3.5" />
            )}
            {exporting ? "Exportando..." : "Exportar Excel"}
          </button>
          ) : null}
        </div>
      </div>

      {message ? (
        <p
          className={`text-right text-[11px] ${
            message.type === "success" ? "text-emerald-700" : "text-red-600"
          }`}
        >
          {message.text}
        </p>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="w-full overflow-x-auto" style={{ maxHeight: "calc(100vh - 240px)" }}>
          <table className="min-w-[1480px] w-full divide-y divide-border text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="sticky left-0 z-20 bg-slate-50 px-1.5 py-2">Acciones</th>
                <th className="px-1.5 py-2">OC</th>
                <th className="px-1.5 py-2">Tipo Pago</th>
                <th className="px-1.5 py-2">Empresa</th>
                <th className="px-1.5 py-2">Autoriza</th>
                <th className="px-1.5 py-2">Fecha Emisión</th>
                <th className="px-1.5 py-2">Tipo Doc.</th>
                <th className="px-1.5 py-2">N° Documento</th>
                <th className="px-1.5 py-2">RUC</th>
                <th className="px-1.5 py-2">Razón Social</th>
                <th className="px-1.5 py-2">Placa</th>
                <th className="px-1.5 py-2">Descripción</th>
                <th className="px-1.5 py-2 text-right">Valor Sin IGV</th>
                <th className="px-1.5 py-2 text-right">Valor Con IGV</th>
                <th className="px-1.5 py-2">Adjuntos</th>
                <th className="px-1.5 py-2">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white">
              {loading ? (
                <tr>
                  <td colSpan={16} className="px-4 py-12 text-center text-muted">
                    <span className="inline-flex items-center gap-2 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin text-accent" />
                      Cargando documentos…
                    </span>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={16} className="px-4 py-12 text-center text-muted">
                    No hay documentos para los filtros actuales.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-accent/5">
                    <td className="sticky left-0 bg-white px-1.5 py-1.5">
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          title="Ver detalle"
                          className={`${ICON_BTN} border-gray-200 bg-white text-slate-600 hover:bg-slate-50`}
                          onClick={() => openDetail(item.id)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        {!item.confirmado ? (
                          <>
                            {canEditar ? (
                            <button
                              type="button"
                              title="Editar"
                              className={`${ICON_BTN} border-gray-200 bg-white text-slate-600 hover:bg-slate-50`}
                              onClick={() => {
                                setEditingId(item.id);
                                setEditorOpen(true);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            ) : null}
                            {canEliminar ? (
                            <button
                              type="button"
                              title="Eliminar"
                              disabled={deletingId === item.id}
                              className={`${ICON_BTN} border-red-200 bg-red-50 text-red-500 hover:bg-red-100`}
                              onClick={() => void handleDelete(item)}
                            >
                              {deletingId === item.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </button>
                            ) : null}
                            {canConfirmar ? (
                            <button
                              type="button"
                              title="Confirmar"
                              className={`${ICON_BTN} border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100`}
                              onClick={() => setConfirmTarget(item)}
                            >
                              <Unlock className="h-3.5 w-3.5" />
                            </button>
                            ) : null}
                          </>
                        ) : (
                          <span
                            className={`${ICON_BTN} cursor-default border-emerald-200 bg-emerald-50 text-emerald-700`}
                            title={`Confirmado ${formatFechaHora(item.confirmado_at)}`}
                          >
                            <Lock className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-1.5 py-1.5 font-semibold text-accent">
                      {ocLabel(item)}
                    </td>
                    <td className="px-1.5 py-1.5">{item.tipo_pago}</td>
                    <td className="px-1.5 py-1.5">
                      <TruncCell value={item.empresa || "-"} />
                    </td>
                    <td className="px-1.5 py-1.5">
                      <TruncCell value={item.autoriza || "-"} />
                    </td>
                    <td className="px-1.5 py-1.5">{formatFecha(item.fecha_emision)}</td>
                    <td className="px-1.5 py-1.5">{item.tipo_documento}</td>
                    <td className="px-1.5 py-1.5">{item.numero_documento || "-"}</td>
                    <td className="px-1.5 py-1.5">{item.ruc || "-"}</td>
                    <td className="px-1.5 py-1.5">
                      <TruncCell value={item.razon_social || "-"} />
                    </td>
                    <td className="px-1.5 py-1.5">{item.placa || "-"}</td>
                    <td className="px-1.5 py-1.5">
                      <TruncCell value={item.descripcion || "-"} />
                    </td>
                    <td className="px-1.5 py-1.5 text-right">
                      {formatSoles(item.valor_sin_igv)}
                    </td>
                    <td className="px-1.5 py-1.5 text-right font-medium">
                      {formatSoles(item.valor_con_igv)}
                    </td>
                    <td className="px-1.5 py-1.5">
                      <button
                        type="button"
                        onClick={() => openDetail(item.id)}
                        className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                      >
                        📎 {item.adjuntos_count ?? 0}
                      </button>
                    </td>
                    <td className="px-1.5 py-1.5">
                      {item.confirmado ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          <Lock className="h-3 w-3" />
                          {formatFechaHora(item.confirmado_at)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                          <Unlock className="h-3 w-3" />
                          Borrador
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && hasMore ? (
          <div className="border-t border-border bg-slate-50 px-4 py-2 text-center">
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => {
                setLoadingMore(true);
                void fetchPage(page + 1, true).finally(() => setLoadingMore(false));
              }}
              className="text-xs font-medium text-accent hover:underline"
            >
              {loadingMore ? "Cargando..." : "Cargar más"}
            </button>
          </div>
        ) : null}
      </div>

      {detailId ? (
        <DocumentoDetalleModal
          documentoId={detailId}
          canDescargarAdjuntos={canDescargarAdjuntos}
          onClose={() => setDetailId(null)}
        />
      ) : null}

      {editorOpen ? (
        <EditorModal
          documentoId={editingId}
          canSubirAdjuntos={canSubirAdjuntos}
          canEliminarAdjuntos={canEliminarAdjuntos}
          onClose={() => {
            setEditorOpen(false);
            setEditingId(null);
          }}
          onSaved={() => {
            setEditorOpen(false);
            setEditingId(null);
            flash("success", editingId ? "Documento actualizado." : "Documento creado.");
            void reload();
          }}
        />
      ) : null}

      {confirmTarget ? (
        <DialogShell
          title="Confirmar documento"
          onClose={() => !confirming && setConfirmTarget(null)}
        >
          <p className="text-sm text-slate-700">
            ¿Estás seguro de confirmar este documento? Una vez confirmado no podrá ser editado ni eliminado.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              disabled={confirming}
              onClick={() => setConfirmTarget(null)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={confirming}
              onClick={() => void handleConfirm()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Confirmar
            </button>
          </div>
        </DialogShell>
      ) : null}
    </div>
  );
}

function DialogShell({
  title,
  onClose,
  wide,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
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
      <button type="button" aria-label="Cerrar" className="absolute inset-0" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-xl bg-white p-4 shadow-xl sm:p-6 ${
          wide ? "max-w-4xl" : "max-w-2xl"
        }`}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className={`${ICON_BTN} border-gray-200 bg-white text-gray-500 hover:bg-gray-50`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EditorModal({
  documentoId,
  canSubirAdjuntos,
  canEliminarAdjuntos,
  onClose,
  onSaved,
}: {
  documentoId: string | null;
  canSubirAdjuntos: boolean;
  canEliminarAdjuntos: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(Boolean(documentoId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [esDelivery, setEsDelivery] = useState(false);
  const [sinOc, setSinOc] = useState(false);
  const [numeroOc, setNumeroOc] = useState("");
  const [ocQuery, setOcQuery] = useState("");
  const [ocOptions, setOcOptions] = useState<OcOption[]>([]);
  const [ocOpen, setOcOpen] = useState(false);
  const [tipoPago, setTipoPago] = useState<string>("Caja Chica");
  const [empresa, setEmpresa] = useState(EMPRESA_DEFAULT);
  const [autoriza, setAutoriza] = useState(AUTORIZA_DEFAULT);
  const [fechaEmision, setFechaEmision] = useState(todayYmd());
  const [tipoDocumento, setTipoDocumento] = useState<string>("Factura");
  const [numeroDocumento, setNumeroDocumento] = useState("");
  const [ruc, setRuc] = useState("");
  const [razonSocial, setRazonSocial] = useState("");
  const [placa, setPlaca] = useState("");
  const [descripcion, setDescripcion] = useState("DELIVERY");
  const [valorConIgvInput, setValorConIgvInput] = useState("");
  const [montoManual, setMontoManual] = useState(false);
  const [observaciones, setObservaciones] = useState("");
  const [lineas, setLineas] = useState<LineaDisponible[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lineasLoading, setLineasLoading] = useState(false);
  const [existingAdjuntos, setExistingAdjuntos] = useState<DocumentoAdjunto[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const ocTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedLineas = useMemo(
    () => lineas.filter((l) => selected.has(lineKey(l))),
    [lineas, selected]
  );

  const autoValorConIgv = round2(
    selectedLineas.reduce(
      (sum, l) => sum + toMoney(l.precio_total_con_igv_soles),
      0
    )
  );
  const valorConIgv = toMoney(valorConIgvInput.replace(",", "."));
  const valorSinIgv = round2(valorConIgv / 1.18);

  useEffect(() => {
    if (loading || esDelivery || montoManual) return;
    setValorConIgvInput(autoValorConIgv.toFixed(2));
  }, [loading, esDelivery, montoManual, autoValorConIgv]);

  useEffect(() => {
    if (!documentoId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/control-documentario/${documentoId}`);
        const json = (await res.json()) as {
          success: boolean;
          error?: string;
          data?: DocumentoDetalle;
        };
        if (!res.ok || !json.success || !json.data) {
          throw new Error(json.error || "No se pudo cargar el documento");
        }
        if (cancelled) return;
        const d = json.data;
        setEsDelivery(Boolean(d.es_delivery));
        const oc = (d.numero_oc ?? "").trim();
        setNumeroOc(oc);
        setSinOc(Boolean(d.es_delivery && oc === TEXTO_SIN_OC));
        setOcQuery(oc === TEXTO_SIN_OC ? "" : oc);
        setTipoPago(d.tipo_pago || "Caja Chica");
        setEmpresa(d.empresa || EMPRESA_DEFAULT);
        setAutoriza(d.autoriza || AUTORIZA_DEFAULT);
        setFechaEmision(d.fecha_emision?.slice(0, 10) || todayYmd());
        setTipoDocumento(d.tipo_documento || "Factura");
        setNumeroDocumento(d.numero_documento ?? "");
        setRuc(d.ruc ?? "");
        setRazonSocial(d.razon_social ?? "");
        setPlaca(d.placa ?? "");
        setDescripcion(d.descripcion || (d.es_delivery ? "DELIVERY" : ""));
        setValorConIgvInput(toMoney(d.valor_con_igv).toFixed(2));
        setMontoManual(false);
        setObservaciones(d.observaciones ?? "");
        setExistingAdjuntos(d.adjuntos ?? []);
        if (!d.es_delivery && oc) {
          await loadLineas(oc, documentoId, d.items ?? [], {
            savedValorConIgv: toMoney(d.valor_con_igv),
          });
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentoId]);

  useEffect(() => {
    if (ocTimer.current) clearTimeout(ocTimer.current);
    ocTimer.current = setTimeout(() => {
      void searchOcs(ocQuery);
    }, 250);
    return () => {
      if (ocTimer.current) clearTimeout(ocTimer.current);
    };
  }, [ocQuery]);

  async function searchOcs(q: string) {
    const params = new URLSearchParams();
    if (q.trim()) params.set("search", q.trim());
    const res = await fetch(`/api/control-documentario/ocs?${params.toString()}`);
    const json = (await res.json()) as {
      success: boolean;
      items?: OcOption[];
    };
    if (res.ok && json.success) setOcOptions(json.items ?? []);
  }

  async function loadLineas(
    oc: string,
    docId?: string | null,
    preselected?: LineaDisponible[],
    opts?: { savedValorConIgv?: number }
  ) {
    setLineasLoading(true);
    try {
      const params = new URLSearchParams({ numero_oc: oc });
      if (docId) params.set("documento_id", docId);
      const res = await fetch(
        `/api/control-documentario/lineas-disponibles?${params.toString()}`
      );
      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        proveedor?: string | null;
        nro_document?: string | null;
        items?: LineaDisponible[];
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error || "No se pudieron cargar las líneas");
      }
      setLineas(json.items ?? []);
      if (json.proveedor) setRazonSocial(json.proveedor);
      if (json.nro_document) setRuc(json.nro_document);
      const next = new Set<string>();
      const preset = preselected ?? [];
      if (preset.length > 0) {
        for (const item of preset) next.add(lineKey(item));
      } else {
        for (const item of json.items ?? []) {
          if (item.ya_en_documento) next.add(lineKey(item));
        }
      }
      setSelected(next);
      if (opts?.savedValorConIgv != null) {
        const autoSum = round2(
          (json.items ?? [])
            .filter((item) => next.has(lineKey(item)))
            .reduce(
              (sum, l) => sum + toMoney(l.precio_total_con_igv_soles),
              0
            )
        );
        if (Math.abs(autoSum - opts.savedValorConIgv) > 0.009) {
          setMontoManual(true);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar líneas");
      setLineas([]);
    } finally {
      setLineasLoading(false);
    }
  }

  function pickOc(opt: OcOption) {
    setNumeroOc(opt.numero_oc);
    setOcQuery(opt.numero_oc);
    setOcOpen(false);
    setSinOc(false);
    if (esDelivery) {
      setRazonSocial("");
      setRuc("");
    } else {
      setRazonSocial(opt.proveedor ?? "");
      setRuc(opt.nro_document ?? "");
      setMontoManual(false);
      void loadLineas(opt.numero_oc, documentoId);
    }
  }

  function onFiles(list: FileList | null) {
    if (!list) return;
    const next = [...pendingFiles];
    for (const file of Array.from(list)) {
      if (existingAdjuntos.length + next.length >= MAX_FILES) {
        setError("Este registro admite como máximo 5 archivos adjuntos.");
        break;
      }
      if (file.size > MAX_FILE_BYTES) {
        setError(`El archivo “${file.name}” supera el máximo de 10 MB.`);
        continue;
      }
      if (!isAllowedAdjuntoFile(file)) {
        setError(`El archivo “${file.name}” tiene un tipo no permitido.`);
        continue;
      }
      if (!file.name.trim()) continue;
      next.push(file);
    }
    setPendingFiles(next);
  }

  async function removeExistingAdjunto(adjuntoId: string) {
    if (!documentoId) return;
    const res = await fetch(
      `/api/control-documentario/${documentoId}/adjuntos/${adjuntoId}`,
      { method: "DELETE" }
    );
    const json = (await res.json()) as { success: boolean; error?: string };
    if (!res.ok || !json.success) {
      setError(json.error || "No se pudo quitar el adjunto");
      return;
    }
    setExistingAdjuntos((prev) => prev.filter((a) => a.id !== adjuntoId));
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const parsedValor = toMoney(valorConIgvInput.replace(",", "."));
      if (!Number.isFinite(parsedValor) || parsedValor < 0) {
        throw new Error("Valor Con IGV debe ser un número positivo.");
      }
      const ocValue = esDelivery && sinOc ? TEXTO_SIN_OC : numeroOc.trim();
      const payload = {
        es_delivery: esDelivery,
        numero_oc: ocValue,
        tipo_pago: tipoPago,
        empresa: empresa.trim(),
        autoriza: autoriza.trim(),
        fecha_emision: fechaEmision,
        tipo_documento: tipoDocumento,
        numero_documento: numeroDocumento.trim() || null,
        ruc: esDelivery ? null : ruc.trim(),
        razon_social: esDelivery ? razonSocial : razonSocial.trim(),
        placa: placa.trim() || null,
        descripcion: esDelivery ? descripcion.trim() : resumenRepuestos(selectedLineas),
        valor_con_igv: parsedValor,
        observaciones: observaciones.trim() || null,
        items: esDelivery
          ? []
          : selectedLineas.map((l) => ({
              sigma_id: l.sigma_id,
              numero_oc: l.numero_oc,
              linea_orden: l.linea_orden,
              codigo_repuesto: l.codigo_repuesto,
              descripcion_repuesto: l.descripcion_repuesto,
              cantidad: l.cantidad == null ? null : Number(l.cantidad),
              precio_total_con_igv_soles:
                l.precio_total_con_igv_soles == null
                  ? null
                  : Number(l.precio_total_con_igv_soles),
            })),
      };

      const url = documentoId
        ? `/api/control-documentario/${documentoId}`
        : "/api/control-documentario";
      const res = await fetch(url, {
        method: documentoId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: { id?: string };
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error || "No se pudo guardar");
      }
      const id = documentoId || json.data?.id;
      if (id && pendingFiles.length > 0) {
        const form = new FormData();
        for (const file of pendingFiles) form.append("files", file);
        const up = await fetch(`/api/control-documentario/${id}/adjuntos`, {
          method: "POST",
          body: form,
        });
        const upJson = (await up.json()) as { success: boolean; error?: string };
        if (!up.ok || !upJson.success) {
          throw new Error(
            upJson.error ||
              "El documento se guardó, pero falló la subida de archivos."
          );
        }
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  const allSelected =
    lineas.length > 0 && lineas.every((l) => selected.has(lineKey(l)));

  return (
    <DialogShell
      title={documentoId ? "Editar registro" : "Nuevo registro"}
      onClose={onClose}
      wide
    >
      {loading ? (
        <div className="py-10 text-center text-sm text-muted">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-accent" />
        </div>
      ) : (
        <div className="space-y-4">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <label className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
            <input
              type="checkbox"
              checked={esDelivery}
              onChange={(e) => {
                const on = e.target.checked;
                setEsDelivery(on);
                if (on) {
                  setLineas([]);
                  setSelected(new Set());
                  setRuc("");
                  setMontoManual(false);
                  if (!descripcion) setDescripcion("DELIVERY");
                  setDescripcion((d) => d || "DELIVERY");
                } else {
                  setMontoManual(false);
                  if (numeroOc && numeroOc !== TEXTO_SIN_OC) {
                    void loadLineas(numeroOc, documentoId);
                  }
                }
              }}
            />
            ¿Es Delivery / Gasto sin repuestos?
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                OC
              </span>
              {esDelivery ? (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={sinOc}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setSinOc(on);
                        if (on) {
                          setNumeroOc(TEXTO_SIN_OC);
                          setOcQuery("");
                        }
                      }}
                    />
                    Sin OC
                  </label>
                  {!sinOc ? (
                    <OcSearch
                      query={ocQuery}
                      options={ocOptions}
                      open={ocOpen}
                      onQuery={(v) => {
                        setOcQuery(v);
                        setOcOpen(true);
                        setNumeroOc(v);
                      }}
                      onOpen={setOcOpen}
                      onPick={pickOc}
                    />
                  ) : (
                    <input className={INPUT_CLASS} value={TEXTO_SIN_OC} disabled />
                  )}
                </div>
              ) : (
                <OcSearch
                  query={ocQuery}
                  options={ocOptions}
                  open={ocOpen}
                  onQuery={(v) => {
                    setOcQuery(v);
                    setOcOpen(true);
                    setNumeroOc(v);
                  }}
                  onOpen={setOcOpen}
                  onPick={pickOc}
                />
              )}
            </label>

            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Tipo de Pago
              </span>
              <select className={INPUT_CLASS} value={tipoPago} onChange={(e) => setTipoPago(e.target.value)}>
                {TIPOS_PAGO.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Empresa
              </span>
              <input className={INPUT_CLASS} value={empresa} onChange={(e) => setEmpresa(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Autoriza
              </span>
              <input className={INPUT_CLASS} value={autoriza} onChange={(e) => setAutoriza(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Fecha de Emisión
              </span>
              <input type="date" className={INPUT_CLASS} value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Tipo de Documento
              </span>
              <select className={INPUT_CLASS} value={tipoDocumento} onChange={(e) => setTipoDocumento(e.target.value)}>
                {TIPOS_DOCUMENTO.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                N° Documento
              </span>
              <input className={INPUT_CLASS} value={numeroDocumento} onChange={(e) => setNumeroDocumento(e.target.value)} placeholder="F001-000123" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                RUC
              </span>
              <input
                className={INPUT_CLASS}
                value={esDelivery ? "" : ruc}
                disabled={esDelivery}
                onChange={(e) => setRuc(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Razón Social
              </span>
              {esDelivery ? (
                <select className={INPUT_CLASS} value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)}>
                  <option value="">Seleccione</option>
                  {RAZONES_DELIVERY.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              ) : (
                <input className={INPUT_CLASS} value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} />
              )}
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Placa
              </span>
              <input className={INPUT_CLASS} value={placa} onChange={(e) => setPlaca(e.target.value)} />
            </label>
            <div className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Valor Con IGV
              </span>
              <input
                className={INPUT_CLASS}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={valorConIgvInput}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") {
                    setValorConIgvInput("");
                    return;
                  }
                  const n = Number(raw.replace(",", "."));
                  if (!Number.isFinite(n) || n < 0) return;
                  setValorConIgvInput(raw);
                }}
              />
              {!esDelivery ? (
                <label className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={montoManual}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setMontoManual(on);
                      if (!on) {
                        setValorConIgvInput(autoValorConIgv.toFixed(2));
                      }
                    }}
                  />
                  Monto manual
                </label>
              ) : null}
            </div>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Valor Sin IGV
              </span>
              <input className={INPUT_CLASS} readOnly value={valorSinIgv.toFixed(2)} />
            </label>
          </div>

          {esDelivery ? (
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Descripción
              </span>
              <textarea
                className={INPUT_CLASS}
                rows={2}
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
              />
            </label>
          ) : (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Repuestos de la OC
                </span>
                {lineas.length > 0 ? (
                  <label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelected(new Set(lineas.map(lineKey)));
                        } else {
                          setSelected(new Set());
                        }
                      }}
                    />
                    Seleccionar todos
                  </label>
                ) : null}
              </div>
              {lineasLoading ? (
                <p className="text-sm text-muted">Cargando líneas…</p>
              ) : !numeroOc ? (
                <p className="text-sm text-muted">Seleccione una OC para ver los repuestos disponibles.</p>
              ) : lineas.length === 0 ? (
                <p className="text-sm text-muted">No hay líneas disponibles para esta OC.</p>
              ) : (
                <div className="max-h-48 overflow-auto rounded-lg border border-gray-200">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                      <tr>
                        <th className="px-2 py-1.5" />
                        <th className="px-2 py-1.5 text-left">Código</th>
                        <th className="px-2 py-1.5 text-left">Descripción</th>
                        <th className="px-2 py-1.5 text-right">Cant.</th>
                        <th className="px-2 py-1.5 text-right">P. Total IGV</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineas.map((l) => {
                        const key = lineKey(l);
                        return (
                          <tr key={key} className="border-t border-gray-100">
                            <td className="px-2 py-1.5">
                              <input
                                type="checkbox"
                                checked={selected.has(key)}
                                onChange={(e) => {
                                  const next = new Set(selected);
                                  if (e.target.checked) next.add(key);
                                  else next.delete(key);
                                  setSelected(next);
                                }}
                              />
                            </td>
                            <td className="px-2 py-1.5 font-mono">{l.codigo_repuesto}</td>
                            <td className="px-2 py-1.5">{l.descripcion_repuesto || "-"}</td>
                            <td className="px-2 py-1.5 text-right">{l.cantidad ?? "-"}</td>
                            <td className="px-2 py-1.5 text-right">
                              {formatSoles(l.precio_total_con_igv_soles)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-2 text-xs text-slate-500">
                Descripción: {selectedLineas.length ? resumenRepuestos(selectedLineas) : "—"}
              </p>
            </div>
          )}

          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Observaciones
            </span>
            <textarea className={INPUT_CLASS} rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
          </label>

          <div>
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Archivos / fotos (máx. 5, 10 MB c/u)
            </span>
            {canSubirAdjuntos ? (
            <input
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.xml,.zip,.html"
              className="block w-full text-sm"
              onChange={(e) => {
                onFiles(e.target.files);
                e.target.value = "";
              }}
            />
            ) : (
              <p className="text-xs text-slate-500">
                No tienes permiso para subir adjuntos.
              </p>
            )}
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {existingAdjuntos.map((a) => (
                <li key={a.id} className="flex items-center justify-between rounded border border-gray-100 px-2 py-1">
                  <span>{a.nombre_archivo} · {formatBytes(a.tamano_bytes)}</span>
                  {canEliminarAdjuntos ? (
                  <button type="button" className="text-red-500" onClick={() => void removeExistingAdjunto(a.id)}>
                    Quitar
                  </button>
                  ) : null}
                </li>
              ))}
              {pendingFiles.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between rounded border border-gray-100 px-2 py-1">
                  <span>{f.name} · {formatBytes(f.size)}</span>
                  <button
                    type="button"
                    className="text-red-500"
                    onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm">
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Guardar
            </button>
          </div>
        </div>
      )}
    </DialogShell>
  );
}

function OcSearch({
  query,
  options,
  open,
  onQuery,
  onOpen,
  onPick,
}: {
  query: string;
  options: OcOption[];
  open: boolean;
  onQuery: (v: string) => void;
  onOpen: (v: boolean) => void;
  onPick: (opt: OcOption) => void;
}) {
  return (
    <div className="relative">
      <input
        className={INPUT_CLASS}
        value={query}
        placeholder="Buscar número de OC..."
        onChange={(e) => onQuery(e.target.value)}
        onFocus={() => onOpen(true)}
      />
      {open && options.length > 0 ? (
        <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {options.map((opt) => (
            <li key={opt.numero_oc}>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                onClick={() => onPick(opt)}
              >
                <span className="font-medium">{opt.numero_oc}</span>
                {opt.proveedor ? (
                  <span className="ml-2 text-xs text-slate-500">{opt.proveedor}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

