CREATE TABLE IF NOT EXISTS public.ventas_taller (
  -- Identidad / control
  id bigserial PRIMARY KEY,
  last_sync_at timestamptz NOT NULL,

  -- Cabecera de la OT
  empresa text,
  local text,
  seccion text,
  ot text NOT NULL,
  seguro text,
  asesor text,
  tecnicos text,
  fecha_ingreso date,
  fecha_anulacion date,
  fecha_entrega date,
  fecha_facturacion date,
  tipo_ot text,
  estado text,
  centro_costos text,
  estado_vehiculo text,
  tc_ot numeric(18, 6),
  kilometraje numeric(18, 2),

  -- Vehículo
  placa text,
  vin text,
  motor text,
  marca text,
  modelo_tecnico text,
  color text,
  anio_fabricacion text,
  anio_modelo text,

  -- Cliente
  tipo_doc text,
  documento text,
  cliente text,
  celular text,
  correo text,
  direccion text,
  ubigeo text,

  -- Comprobante
  tc_comprobante numeric(18, 6),
  moneda text,
  fecha_comprobante date,
  comprobante text,

  -- Línea del repuesto
  tipo text,
  marca_repuesto text,
  codigo text,
  descripcion text,
  cant_solicitada numeric(18, 4),

  -- Montos en SOLES (primer bloque del Excel)
  precio_soles numeric(18, 4),
  dscto_marca_soles numeric(18, 4),
  dscto_dealer_soles numeric(18, 4),
  dscto_total_soles numeric(18, 4),
  precio_total_soles numeric(18, 4),
  costo_unitario_soles numeric(18, 4),
  costo_total_soles numeric(18, 4),
  margen_total_soles numeric(18, 4),

  -- Montos en DÓLARES (segundo bloque del Excel)
  precio_dolares numeric(18, 4),
  dscto_marca_dolares numeric(18, 4),
  dscto_dealer_dolares numeric(18, 4),
  dscto_total_dolares numeric(18, 4),
  precio_total_dolares numeric(18, 4),
  costo_unitario_dolares numeric(18, 4),
  costo_total_dolares numeric(18, 4),
  margen_total_dolares numeric(18, 4),

  -- Cierre
  observaciones text
);

CREATE INDEX IF NOT EXISTS idx_ventas_taller_ot
  ON public.ventas_taller (ot);
