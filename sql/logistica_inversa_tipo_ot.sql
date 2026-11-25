-- Tipo de OT en logística inversa.
-- Re-ejecutable: no borra datos ni exige un valor.
-- Ejecutar en el SQL editor de Supabase antes (o justo después) del deploy
-- que escribe tipo_ot. Si el deploy llega primero, el sync sigue y omite la columna.

ALTER TABLE public.logistica_inversa
  ADD COLUMN IF NOT EXISTS tipo_ot text;

COMMENT ON COLUMN public.logistica_inversa.tipo_ot IS
  'Tipo de OT normalizado desde Sigma. Valores esperados: Correctivo, Garantia, Reclamo, Siniestro, Preventivo. NULL = fila aún no clasificada.';

-- Verificación:
-- SELECT tipo_ot, count(*)
-- FROM public.logistica_inversa
-- GROUP BY tipo_ot
-- ORDER BY tipo_ot NULLS FIRST;

-- Reversión:
-- ALTER TABLE public.logistica_inversa DROP COLUMN IF EXISTS tipo_ot;
