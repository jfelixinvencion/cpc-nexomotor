"use client";

import { useEffect, useState } from "react";
import { Download, FileText, Loader2, Lock, X } from "lucide-react";

export type DocumentoDetalleItem = {
  sigma_id: number;
  numero_oc: string;
  linea_orden: number;
  codigo_repuesto: string;
  descripcion_repuesto: string | null;
  cantidad: number | string | null;
  precio_total_con_igv_soles: number | string | null;
};

export type DocumentoAdjunto = {
  id: string;
  nombre_archivo: string;
  mime_type: string | null;
  tamano_bytes: number | null;
  created_at: string | null;
  signed_url: string;
};

export type DocumentoDetalle = {
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
  items: DocumentoDetalleItem[];
  adjuntos: DocumentoAdjunto[];
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
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
  if (Number.isNaN(d.getTime())) return formatFecha(value);
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

function formatBytes(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageMime(mime: string | null | undefined) {
  return Boolean(mime && mime.toLowerCase().startsWith("image/"));
}

function ocLabel(doc: Pick<DocumentoDetalle, "es_delivery" | "numero_oc">) {
  const oc = (doc.numero_oc ?? "").trim();
  if (doc.es_delivery && (!oc || oc === "Sin OC")) return "Delivery";
  return oc || "-";
}

export default function DocumentoDetalleModal({
  documentoId,
  onClose,
  modoSoloLectura = false,
}: {
  documentoId: string;
  onClose: () => void;
  modoSoloLectura?: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<DocumentoDetalle | null>(null);
  const [preview, setPreview] = useState<DocumentoAdjunto | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/control-documentario/${documentoId}`);
        const json = (await res.json()) as {
          success: boolean;
          error?: string;
          data?: DocumentoDetalle;
        };
        if (!res.ok || !json.success || !json.data) {
          throw new Error(json.error || "No se pudo abrir el documento");
        }
        if (!cancelled) setDoc(json.data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Error al cargar");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentoId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  void modoSoloLectura;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
        <button type="button" aria-label="Cerrar" className="absolute inset-0" onClick={onClose} />
        <div
          role="dialog"
          aria-modal="true"
          className="relative z-10 max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white p-4 shadow-xl sm:p-6"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 className="text-base font-semibold text-gray-900">Detalle de documento</h2>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {loading ? (
            <div className="py-12 text-center text-sm text-muted">
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-accent" />
            </div>
          ) : error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : doc ? (
            <DetalleBody doc={doc} onPreview={setPreview} />
          ) : null}
        </div>
      </div>
      {preview ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Cerrar"
            onClick={() => setPreview(null)}
          />
          <div className="relative z-10 max-h-full max-w-5xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.signed_url}
              alt={preview.nombre_archivo}
              className="max-h-[85vh] rounded-lg object-contain"
            />
            <div className="mt-2 flex justify-end gap-2">
              <a
                href={preview.signed_url}
                download={preview.nombre_archivo}
                className="rounded bg-white px-3 py-1 text-sm"
              >
                Descargar
              </a>
              <button
                type="button"
                className="rounded bg-white px-3 py-1 text-sm"
                onClick={() => setPreview(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function DetalleBody({
  doc,
  onPreview,
}: {
  doc: DocumentoDetalle;
  onPreview: (adjunto: DocumentoAdjunto) => void;
}) {
  return (
    <>
      {doc.confirmado ? (
        <p className="mb-3 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
          <Lock className="h-3.5 w-3.5" />
          Confirmado el {formatFechaHora(doc.confirmado_at)}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="OC" value={ocLabel(doc)} />
        <Field label="Tipo Pago" value={doc.tipo_pago} />
        <Field label="Empresa" value={doc.empresa} />
        <Field label="Autoriza" value={doc.autoriza} />
        <Field label="Fecha Emisión" value={formatFecha(doc.fecha_emision)} />
        <Field label="Tipo Doc." value={doc.tipo_documento} />
        <Field label="N° Documento" value={doc.numero_documento || "-"} />
        <Field label="RUC" value={doc.ruc || "-"} />
        <Field label="Razón Social" value={doc.razon_social || "-"} />
        <Field label="Placa" value={doc.placa || "-"} />
        <Field label="Valor Sin IGV" value={formatSoles(doc.valor_sin_igv)} />
        <Field label="Valor Con IGV" value={formatSoles(doc.valor_con_igv)} />
        <div className="sm:col-span-2">
          <Field label="Descripción" value={doc.descripcion || "-"} />
        </div>
        <div className="sm:col-span-2">
          <Field label="Observaciones" value={doc.observaciones || "-"} />
        </div>
      </div>

      {doc.items?.length ? (
        <div className="mt-4">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Repuestos
          </p>
          <div className="overflow-auto rounded-lg border border-gray-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-1.5 text-left">Código</th>
                  <th className="px-2 py-1.5 text-left">Descripción</th>
                  <th className="px-2 py-1.5 text-right">Cant.</th>
                  <th className="px-2 py-1.5 text-right">P. Total IGV</th>
                </tr>
              </thead>
              <tbody>
                {doc.items.map((l) => (
                  <tr
                    key={`${l.sigma_id}:${l.linea_orden}`}
                    className="border-t border-gray-100"
                  >
                    <td className="px-2 py-1.5 font-mono">{l.codigo_repuesto}</td>
                    <td className="px-2 py-1.5">{l.descripcion_repuesto || "-"}</td>
                    <td className="px-2 py-1.5 text-right">{l.cantidad ?? "-"}</td>
                    <td className="px-2 py-1.5 text-right">
                      {formatSoles(l.precio_total_con_igv_soles)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Archivos adjuntos
        </p>
        {!doc.adjuntos?.length ? (
          <p className="text-sm text-muted">Sin archivos.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {doc.adjuntos.map((a) =>
              isImageMime(a.mime_type) ? (
                <button
                  key={a.id}
                  type="button"
                  className="overflow-hidden rounded-lg border border-gray-200 text-left hover:border-accent"
                  onClick={() => onPreview(a)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.signed_url}
                    alt={a.nombre_archivo}
                    className="h-32 w-full object-cover"
                  />
                  <div className="flex items-center justify-between px-2 py-1 text-[11px]">
                    <span className="truncate">{a.nombre_archivo}</span>
                    <a
                      href={a.signed_url}
                      download={a.nombre_archivo}
                      onClick={(e) => e.stopPropagation()}
                      className="text-accent"
                    >
                      Descargar
                    </a>
                  </div>
                </button>
              ) : (
                <div
                  key={a.id}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 p-3"
                >
                  <FileText className="h-8 w-8 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{a.nombre_archivo}</p>
                    <p className="text-[11px] text-slate-500">{formatBytes(a.tamano_bytes)}</p>
                  </div>
                  <a
                    href={a.signed_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-medium text-accent"
                  >
                    Ver
                  </a>
                  <a
                    href={a.signed_url}
                    download={a.nombre_archivo}
                    className="text-xs font-medium text-slate-600"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-800">{value}</p>
    </div>
  );
}

