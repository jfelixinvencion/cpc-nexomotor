"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export type VentaTallerRow = {
  id: number;
  seccion: string | null;
  ot: string | null;
  fecha_ingreso: string | null;
  tipo_ot: string | null;
  estado: string | null;
  estado_vehiculo: string | null;
  placa: string | null;
  vin: string | null;
  motor: string | null;
  marca: string | null;
  modelo_tecnico: string | null;
  anio_modelo: string | null;
  tipo: string | null;
  codigo: string | null;
  descripcion: string | null;
  cant_solicitada: number | string | null;
  precio_total_soles: number | string | null;
  costo_unitario_soles: number | string | null;
  costo_total_soles: number | string | null;
  margen_total_soles: number | string | null;
  observaciones: string | null;
};

function asText(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function displayDash(value: unknown) {
  const text = asText(value);
  return text === "" ? "—" : text;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatFecha(value: string | null | undefined) {
  if (value == null || value.trim() === "") return "—";
  const raw = value.trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatCantidad(value: number | string | null | undefined) {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return displayDash(value);
  return String(n);
}

function formatSoles(value: number | string | null | undefined) {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return `S/ ${n.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function VentaTallerDetalleModal({
  row,
  onClose,
}: {
  row: VentaTallerRow;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const fields: { label: string; value: string }[] = [
    { label: "Sección", value: displayDash(row.seccion) },
    { label: "OT", value: displayDash(row.ot) },
    { label: "Fecha ingreso", value: formatFecha(row.fecha_ingreso) },
    { label: "Tipo OT", value: displayDash(row.tipo_ot) },
    { label: "Estado", value: displayDash(row.estado) },
    { label: "Estado vehículo", value: displayDash(row.estado_vehiculo) },
    { label: "Placa", value: displayDash(row.placa) },
    { label: "VIN", value: displayDash(row.vin) },
    { label: "Motor", value: displayDash(row.motor) },
    { label: "Marca", value: displayDash(row.marca) },
    { label: "Modelo tecnico", value: displayDash(row.modelo_tecnico) },
    { label: "Año modelo", value: displayDash(row.anio_modelo) },
    { label: "Tipo", value: displayDash(row.tipo) },
    { label: "Código", value: displayDash(row.codigo) },
    { label: "Descripcion", value: displayDash(row.descripcion) },
    { label: "Cant solicitada", value: formatCantidad(row.cant_solicitada) },
    { label: "Precio total (S/)", value: formatSoles(row.precio_total_soles) },
    {
      label: "Costo unitario (S/)",
      value: formatSoles(row.costo_unitario_soles),
    },
    { label: "Costo total (S/)", value: formatSoles(row.costo_total_soles) },
    { label: "Margen total (S/)", value: formatSoles(row.margen_total_soles) },
    { label: "Observaciones", value: displayDash(row.observaciones) },
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ventas-taller-detalle-title"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl shadow-slate-900/20"
      >
        <div className="flex items-center justify-between border-b border-border bg-slate-50 px-5 py-4">
          <div>
            <h3
              id="ventas-taller-detalle-title"
              className="text-base font-bold text-foreground"
            >
              Detalle de venta de taller
            </h3>
            <p className="text-xs text-muted">
              OT {displayDash(row.ot)}
              {row.placa ? ` · ${displayDash(row.placa)}` : ""}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            title="Cerrar"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {fields.map((field) => (
              <div
                key={field.label}
                className={
                  field.label === "Observaciones" ||
                  field.label === "Descripcion"
                    ? "sm:col-span-2"
                    : ""
                }
              >
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {field.label}
                </dt>
                <dd className="mt-0.5 break-words text-sm text-foreground">
                  {field.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
