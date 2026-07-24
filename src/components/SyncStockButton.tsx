"use client";

/**
 * El endpoint POST /api/sync-stock exige el header x-sync-secret
 * (SYNC_TRIGGER_SECRET solo en servidor). No se puede enviar desde el
 * navegador sin exponer el secreto (NEXT_PUBLIC_ o hardcode).
 * La sincronización se dispara manualmente desde GitHub Actions.
 */
export default function SyncStockButton() {
  return (
    <p className="text-sm text-muted">
      Las sincronizaciones se ejecutan manualmente desde GitHub Actions.
    </p>
  );
}
