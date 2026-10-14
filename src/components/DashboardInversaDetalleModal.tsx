"use client";

import { useMemo, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import * as XLSX from "xlsx";
import {
  SIN_CATEGORIA,
  SIN_VALORIZAR,
  VALOR_SIN_IGV_LABEL,
  type InversaDetalleRow,
} from "@/lib/dashboard-inversa";

function formatSoles(value: number) {
  return `S/ ${value.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatFecha(value: string | null | undefined) {
  if (!value) return "—";
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return value;
}

function formatCantidad(value: number | null) {
  if (value == null) return "—";
  if (Number.isInteger(value)) return String(value);
  return String(value);
}

function todayYmdLocal() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

export default function DashboardInversaDetalleModal({
  title,
  rows,
  loading,
  error,
  onClose,
}: {
  title: string;
  rows: InversaDetalleRow[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const showMotivo = rows.some((row) => row.estadoNorm === "NO DEVUELTO");

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      [
        row.ot,
        row.placa,
        row.codigo,
        row.descripcion,
        row.categoria,
        row.estado,
        row.motivo,
      ]
        .map((v) => (v ?? "").toLowerCase())
        .some((v) => v.includes(query))
    );
  }, [rows, q]);

  function exportExcel() {
    if (filtered.length === 0) return;
    const sheetRows = filtered.map((row) => {
      const base: Record<string, string | number> = {
        OT: row.ot ?? "",
        Placa: row.placa ?? "",
        Código: row.codigo,
        Descripción: row.descripcion ?? "",
        Cantidad: row.cantidad ?? "",
        "Fecha entrega": formatFecha(row.fechaEntrega),
        [`Valorizado (${VALOR_SIN_IGV_LABEL})`]:
          row.valorizado == null ? SIN_VALORIZAR : row.valorizado,
        Categoría: row.categoria ?? SIN_CATEGORIA,
        Estado: row.estado,
      };
      if (showMotivo) base.Motivo = row.motivo ?? "";
      return base;
    });
    const worksheet = XLSX.utils.json_to_sheet(sheetRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Log. Inversa");
    XLSX.writeFile(workbook, `dashboard_log_inversa_${todayYmdLocal()}.xlsx`);
  }

  const colSpan = showMotivo ? 9 : 8;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dashboard-inversa-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl shadow-slate-900/20">
        <div className="flex items-start justify-between gap-3 border-b border-border bg-slate-50 px-5 py-4">
          <div>
            <h3
              id="dashboard-inversa-modal-title"
              className="text-base font-bold text-foreground"
            >
              {title}
            </h3>
            <p className="text-xs text-muted">
              {loading
                ? "Cargando detalle…"
                : `${filtered.length} registro${filtered.length === 1 ? "" : "s"}`}
              {q.trim() && !loading ? ` de ${rows.length}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white hover:text-slate-800"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <label className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar OT, placa, código, descripción…"
              className="w-full rounded-lg border border-border bg-white py-1.5 pl-8 pr-3 text-xs text-foreground outline-none focus:border-teal-600"
            />
          </label>
          <button
            type="button"
            onClick={exportExcel}
            disabled={loading || Boolean(error) || filtered.length === 0}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Exportar Excel
          </button>
        </div>

        <div className="overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin text-teal-600" />
              Cargando detalle…
            </div>
          ) : error ? (
            <div className="px-5 py-10 text-center text-sm text-red-700">
              {error}
            </div>
          ) : (
            <table className="min-w-[880px] w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">OT</th>
                  <th className="px-3 py-2">Placa</th>
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Descripción</th>
                  <th className="px-3 py-2 text-right">Cantidad</th>
                  <th className="px-3 py-2">Fecha entrega</th>
                  <th className="px-3 py-2 text-right">{VALOR_SIN_IGV_LABEL}</th>
                  <th className="px-3 py-2">Categoría</th>
                  <th className="px-3 py-2">Estado</th>
                  {showMotivo ? <th className="px-3 py-2">Motivo</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-white">
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={colSpan}
                      className="px-4 py-10 text-center text-muted"
                    >
                      No hay registros para mostrar.
                    </td>
                  </tr>
                ) : (
                  filtered.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-3 py-1.5 font-semibold text-slate-800">
                        {row.ot || "—"}
                      </td>
                      <td className="px-3 py-1.5">{row.placa || "—"}</td>
                      <td className="px-3 py-1.5 font-semibold text-accent">
                        {row.codigo}
                      </td>
                      <td className="px-3 py-1.5">{row.descripcion || "—"}</td>
                      <td className="px-3 py-1.5 text-right">
                        {formatCantidad(row.cantidad)}
                      </td>
                      <td className="px-3 py-1.5">
                        {formatFecha(row.fechaEntrega)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-medium">
                        {row.valorizado == null
                          ? SIN_VALORIZAR
                          : formatSoles(row.valorizado)}
                      </td>
                      <td className="px-3 py-1.5">
                        {row.categoria ?? SIN_CATEGORIA}
                      </td>
                      <td className="px-3 py-1.5">{row.estado}</td>
                      {showMotivo ? (
                        <td className="max-w-[220px] px-3 py-1.5 text-slate-600">
                          {row.motivo || "—"}
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
