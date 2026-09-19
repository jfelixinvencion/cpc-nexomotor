"use client";

import { X } from "lucide-react";

export type DashboardModalRow = {
  codigo: string;
  descripcion: string | null;
  tipo_sku?: string | null;
  categoria: string | null;
  sub_categoria: string | null;
  valor: number;
  stock: number;
};

function formatSoles(value: number) {
  return `S/ ${value.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function DashboardModal({
  title,
  rows,
  onClose,
}: {
  title: string;
  rows: DashboardModalRow[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dashboard-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl shadow-slate-900/20">
        <div className="flex items-center justify-between border-b border-border bg-slate-50 px-5 py-4">
          <div>
            <h3
              id="dashboard-modal-title"
              className="text-base font-bold text-foreground"
            >
              {title}
            </h3>
            <p className="text-xs text-muted">{rows.length} registro{rows.length === 1 ? "" : "s"}</p>
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
        <div className="overflow-auto">
          <table className="min-w-[720px] w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Descripción</th>
                <th className="px-3 py-2">Tipo SKU</th>
                <th className="px-3 py-2">Categoría</th>
                <th className="px-3 py-2">Sub Categoría</th>
                <th className="px-3 py-2 text-right">Valorizado</th>
                <th className="px-3 py-2 text-right">Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted">
                    No hay registros para mostrar.
                  </td>
                </tr>
              ) : (
                [...rows]
                  .sort((a, b) => b.valor - a.valor)
                  .map((row, index) => (
                  <tr key={`${row.codigo}:${index}`} className="hover:bg-slate-50">
                    <td className="px-3 py-1.5 font-semibold text-accent">
                      {row.codigo}
                    </td>
                    <td className="px-3 py-1.5">{row.descripcion || "-"}</td>
                    <td className="px-3 py-1.5">{row.tipo_sku || "-"}</td>
                    <td className="px-3 py-1.5">{row.categoria || "-"}</td>
                    <td className="px-3 py-1.5">{row.sub_categoria || "-"}</td>
                    <td className="px-3 py-1.5 text-right font-medium">
                      {formatSoles(row.valor)}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {row.stock.toLocaleString("es-PE")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
