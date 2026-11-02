-- Concurrencia de retiros y devoluciones de herramientas.
-- Revisar este archivo completo antes de ejecutarlo. No forma parte de un deploy automático.
--
-- No agrega CHECK de estado ni de tipo_movimiento: los valores ya guardados no están
-- versionados en el repositorio y un CHECK podría rechazar filas históricas.
-- No revoca INSERT/UPDATE/DELETE de anon ni authenticated sobre las tablas.
-- No modifica la publicación supabase_realtime.
-- No usa DROP, DELETE ni TRUNCATE.

-- =============================================================================
-- 0. Preconsultas (solo lectura). Interpretarlas antes del bloque de cambios.
-- Si la consulta de triggers devuelve alguna fila cuyo nombre o definición
-- indique que ya modifica herramientas.cantidad, detenerse: las funciones de
-- abajo también mueven esa columna y el stock quedaría duplicado.
-- =============================================================================

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'herramientas',
    'prestamos_herramientas',
    'historial_movimientos_herramientas'
  )
ORDER BY table_name, ordinal_position;

SELECT estado, count(*) AS filas
FROM public.prestamos_herramientas
GROUP BY estado
ORDER BY estado;

SELECT tipo_movimiento, count(*) AS filas
FROM public.historial_movimientos_herramientas
GROUP BY tipo_movimiento
ORDER BY tipo_movimiento;

SELECT ubicacion, count(*) AS filas
FROM public.herramientas
GROUP BY ubicacion
ORDER BY filas DESC, ubicacion;

SELECT id, cantidad
FROM public.herramientas
WHERE cantidad IS NULL OR cantidad < 0
ORDER BY id;

SELECT id, cantidad_prestada, cantidad_devuelta, estado
FROM public.prestamos_herramientas
WHERE cantidad_prestada IS NULL
   OR cantidad_prestada <= 0
   OR cantidad_devuelta IS NULL
   OR cantidad_devuelta < 0
   OR cantidad_devuelta > cantidad_prestada
ORDER BY id;

SELECT event_object_table, trigger_name, action_timing, event_manipulation, action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table IN (
    'herramientas',
    'prestamos_herramientas',
    'historial_movimientos_herramientas'
  )
ORDER BY event_object_table, trigger_name;

SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'herramientas',
    'prestamos_herramientas',
    'historial_movimientos_herramientas'
  )
ORDER BY tablename, policyname;

SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'herramientas',
    'prestamos_herramientas',
    'historial_movimientos_herramientas'
  )
  AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
ORDER BY table_name, grantee, privilege_type;

SELECT pubname, schemaname, tablename
FROM pg_publication_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'herramientas',
    'prestamos_herramientas',
    'historial_movimientos_herramientas'
  )
ORDER BY pubname, tablename;

-- =============================================================================
-- 1. Esquema mínimo: clave de idempotencia.
-- Varios NULL siguen permitidos (movimientos anteriores). Una clave no nula
-- solo puede existir una vez.
-- =============================================================================

ALTER TABLE public.historial_movimientos_herramientas
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

COMMENT ON COLUMN public.historial_movimientos_herramientas.idempotency_key IS
  'UUID de una solicitud de retiro o devolución. Reintentos con la misma clave no vuelven a mover stock.';

CREATE UNIQUE INDEX IF NOT EXISTS historial_movimientos_herramientas_idempotency_key_uidx
  ON public.historial_movimientos_herramientas (idempotency_key);

-- =============================================================================
-- 2. Ubicación Almacén, alineada con isUbicacionAlmacen del cliente:
-- trim, minúsculas, NFD y sin marcas combinantes.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.herramienta_ubicacion_es_almacen(p_ubicacion text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT regexp_replace(
    normalize(lower(btrim(coalesce(p_ubicacion, ''))), NFD),
    U&'[\0300-\036F]',
    '',
    'g'
  ) = 'almacen';
$$;

COMMENT ON FUNCTION public.herramienta_ubicacion_es_almacen(text) IS
  'True si la ubicación normalizada es almacen. No escribe datos.';

-- =============================================================================
-- 3. Retiro atómico.
-- Descuenta con aritmética solo si la fila sigue en Almacén y el saldo alcanza.
-- Si no, no inserta préstamo ni movimiento.
-- La misma clave UUID devuelve el movimiento ya grabado.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.retirar_herramienta(
  p_idempotency_key uuid,
  p_herramienta_id bigint,
  p_cantidad integer,
  p_responsable text,
  p_destino text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_existente public.historial_movimientos_herramientas%ROWTYPE;
  v_herramienta public.herramientas%ROWTYPE;
  v_codigo text;
  v_nombre text;
  v_descripcion text;
  v_responsable text;
  v_destino text;
  v_nueva_cantidad integer;
  v_prestamo_id bigint;
  v_movimiento_id bigint;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RETURN jsonb_build_object(
      'resultado', 'validacion',
      'codigo', 'IDEMPOTENCY_KEY_REQUERIDA'
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));

  SELECT *
  INTO v_existente
  FROM public.historial_movimientos_herramientas
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existente.tipo_movimiento = 'RETIRO' THEN
      RETURN jsonb_build_object(
        'resultado', 'replay',
        'codigo', 'REPLAY',
        'prestamo_id', v_existente.prestamo_id,
        'movimiento_id', v_existente.id,
        'herramienta_id', v_existente.herramienta_id,
        'cantidad', v_existente.cantidad,
        'tipo_movimiento', v_existente.tipo_movimiento
      );
    END IF;
    RETURN jsonb_build_object(
      'resultado', 'conflicto',
      'codigo', 'IDEMPOTENCY_KEY_USADA'
    );
  END IF;

  IF p_herramienta_id IS NULL OR p_herramienta_id <= 0 THEN
    RETURN jsonb_build_object(
      'resultado', 'validacion',
      'codigo', 'HERRAMIENTA_INVALIDA'
    );
  END IF;

  v_responsable := btrim(coalesce(p_responsable, ''));
  IF v_responsable = '' THEN
    RETURN jsonb_build_object(
      'resultado', 'validacion',
      'codigo', 'RESPONSABLE_REQUERIDO'
    );
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RETURN jsonb_build_object(
      'resultado', 'validacion',
      'codigo', 'CANTIDAD_INVALIDA'
    );
  END IF;

  v_destino := btrim(coalesce(p_destino, ''));
  IF v_destino = '' THEN
    v_destino := 'Taller';
  END IF;

  BEGIN
    UPDATE public.herramientas
    SET cantidad = cantidad - p_cantidad
    WHERE id = p_herramienta_id
      AND cantidad >= p_cantidad
      AND public.herramienta_ubicacion_es_almacen(ubicacion)
    RETURNING codigo, descripcion, cantidad
    INTO v_codigo, v_nombre, v_nueva_cantidad;

    IF NOT FOUND THEN
      SELECT *
      INTO v_herramienta
      FROM public.herramientas
      WHERE id = p_herramienta_id;

      IF NOT FOUND OR NOT public.herramienta_ubicacion_es_almacen(v_herramienta.ubicacion) THEN
        RETURN jsonb_build_object(
          'resultado', 'conflicto',
          'codigo', 'HERRAMIENTA_NO_DISPONIBLE'
        );
      END IF;

      RETURN jsonb_build_object(
        'resultado', 'conflicto',
        'codigo', 'STOCK_INSUFICIENTE'
      );
    END IF;

    v_codigo := btrim(coalesce(v_codigo, ''));
    v_nombre := btrim(coalesce(v_nombre, ''));
    IF v_codigo <> '' AND v_nombre <> '' THEN
      v_descripcion := v_codigo || ' — ' || v_nombre;
    ELSIF v_nombre <> '' THEN
      v_descripcion := v_nombre;
    ELSIF v_codigo <> '' THEN
      v_descripcion := v_codigo;
    ELSE
      v_descripcion := '—';
    END IF;

    INSERT INTO public.prestamos_herramientas (
      herramienta_id,
      descripcion_herramienta,
      cantidad_prestada,
      cantidad_devuelta,
      responsable,
      destino,
      estado,
      fecha_hora_retiro
    ) VALUES (
      p_herramienta_id,
      v_descripcion,
      p_cantidad,
      0,
      v_responsable,
      v_destino,
      'PENDIENTE',
      now()
    )
    RETURNING id INTO v_prestamo_id;

    INSERT INTO public.historial_movimientos_herramientas (
      tipo_movimiento,
      prestamo_id,
      herramienta_id,
      descripcion_herramienta,
      cantidad,
      responsable,
      destino,
      fecha_hora,
      idempotency_key
    ) VALUES (
      'RETIRO',
      v_prestamo_id,
      p_herramienta_id,
      v_descripcion,
      p_cantidad,
      v_responsable,
      v_destino,
      now(),
      p_idempotency_key
    )
    RETURNING id INTO v_movimiento_id;

    RETURN jsonb_build_object(
      'resultado', 'ok',
      'codigo', 'OK',
      'prestamo_id', v_prestamo_id,
      'movimiento_id', v_movimiento_id,
      'herramienta_id', p_herramienta_id,
      'cantidad', p_cantidad,
      'tipo_movimiento', 'RETIRO',
      'cantidad_devuelta', 0,
      'estado', 'PENDIENTE',
      'stock_cantidad', v_nueva_cantidad
    );
  EXCEPTION
    WHEN unique_violation THEN
      SELECT *
      INTO v_existente
      FROM public.historial_movimientos_herramientas
      WHERE idempotency_key = p_idempotency_key;

      IF FOUND AND v_existente.tipo_movimiento = 'RETIRO' THEN
        RETURN jsonb_build_object(
          'resultado', 'replay',
          'codigo', 'REPLAY',
          'prestamo_id', v_existente.prestamo_id,
          'movimiento_id', v_existente.id,
          'herramienta_id', v_existente.herramienta_id,
          'cantidad', v_existente.cantidad,
          'tipo_movimiento', v_existente.tipo_movimiento
        );
      END IF;
      RAISE;
  END;
END;
$$;

COMMENT ON FUNCTION public.retirar_herramienta(uuid, bigint, integer, text, text) IS
  'Retiro atómico: descuenta stock, inserta préstamo PENDIENTE y movimiento RETIRO, o informa conflicto sin escribir.';

-- =============================================================================
-- 4. Devolución atómica.
-- Solo actualiza el préstamo si cantidad_devuelta sigue igual al valor que vio
-- la tablet y el saldo abierto alcanza. Después suma el delta al stock.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.devolver_herramienta(
  p_idempotency_key uuid,
  p_prestamo_id bigint,
  p_cantidad integer,
  p_cantidad_devuelta_esperada integer
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_existente public.historial_movimientos_herramientas%ROWTYPE;
  v_prestamo public.prestamos_herramientas%ROWTYPE;
  v_visto public.prestamos_herramientas%ROWTYPE;
  v_nueva_cantidad integer;
  v_movimiento_id bigint;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RETURN jsonb_build_object(
      'resultado', 'validacion',
      'codigo', 'IDEMPOTENCY_KEY_REQUERIDA'
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));

  SELECT *
  INTO v_existente
  FROM public.historial_movimientos_herramientas
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existente.tipo_movimiento = 'DEVOLUCION' THEN
      RETURN jsonb_build_object(
        'resultado', 'replay',
        'codigo', 'REPLAY',
        'prestamo_id', v_existente.prestamo_id,
        'movimiento_id', v_existente.id,
        'herramienta_id', v_existente.herramienta_id,
        'cantidad', v_existente.cantidad,
        'tipo_movimiento', v_existente.tipo_movimiento
      );
    END IF;
    RETURN jsonb_build_object(
      'resultado', 'conflicto',
      'codigo', 'IDEMPOTENCY_KEY_USADA'
    );
  END IF;

  IF p_prestamo_id IS NULL OR p_prestamo_id <= 0 THEN
    RETURN jsonb_build_object(
      'resultado', 'validacion',
      'codigo', 'PRESTAMO_INVALIDO'
    );
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RETURN jsonb_build_object(
      'resultado', 'validacion',
      'codigo', 'CANTIDAD_INVALIDA'
    );
  END IF;

  IF p_cantidad_devuelta_esperada IS NULL OR p_cantidad_devuelta_esperada < 0 THEN
    RETURN jsonb_build_object(
      'resultado', 'validacion',
      'codigo', 'CANTIDAD_DEVUELTA_ESPERADA_INVALIDA'
    );
  END IF;

  BEGIN
    UPDATE public.prestamos_herramientas
    SET
      cantidad_devuelta = cantidad_devuelta + p_cantidad,
      estado = CASE
        WHEN cantidad_devuelta + p_cantidad >= cantidad_prestada THEN 'DEVUELTO'
        ELSE 'PARCIAL'
      END,
      fecha_hora_devolucion_final = CASE
        WHEN cantidad_devuelta + p_cantidad >= cantidad_prestada THEN now()
        ELSE fecha_hora_devolucion_final
      END
    WHERE id = p_prestamo_id
      AND cantidad_devuelta = p_cantidad_devuelta_esperada
      AND cantidad_devuelta < cantidad_prestada
      AND cantidad_devuelta + p_cantidad <= cantidad_prestada
    RETURNING *
    INTO v_prestamo;

    IF NOT FOUND THEN
      SELECT *
      INTO v_visto
      FROM public.prestamos_herramientas
      WHERE id = p_prestamo_id;

      IF NOT FOUND THEN
        RETURN jsonb_build_object(
          'resultado', 'conflicto',
          'codigo', 'PRESTAMO_NO_ENCONTRADO'
        );
      END IF;

      IF v_visto.cantidad_devuelta = p_cantidad_devuelta_esperada
         AND v_visto.cantidad_devuelta < v_visto.cantidad_prestada
         AND v_visto.cantidad_devuelta + p_cantidad > v_visto.cantidad_prestada THEN
        RETURN jsonb_build_object(
          'resultado', 'validacion',
          'codigo', 'CANTIDAD_EXCEDE'
        );
      END IF;

      RETURN jsonb_build_object(
        'resultado', 'conflicto',
        'codigo', 'PRESTAMO_CAMBIO'
      );
    END IF;

    v_nueva_cantidad := NULL;
    IF v_prestamo.herramienta_id IS NOT NULL THEN
      UPDATE public.herramientas
      SET cantidad = coalesce(cantidad, 0) + p_cantidad
      WHERE id = v_prestamo.herramienta_id
      RETURNING cantidad
      INTO v_nueva_cantidad;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'HERRAMIENTA_NO_DISPONIBLE'
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    INSERT INTO public.historial_movimientos_herramientas (
      tipo_movimiento,
      prestamo_id,
      herramienta_id,
      descripcion_herramienta,
      cantidad,
      responsable,
      destino,
      fecha_hora,
      idempotency_key
    ) VALUES (
      'DEVOLUCION',
      v_prestamo.id,
      v_prestamo.herramienta_id,
      v_prestamo.descripcion_herramienta,
      p_cantidad,
      v_prestamo.responsable,
      v_prestamo.destino,
      now(),
      p_idempotency_key
    )
    RETURNING id INTO v_movimiento_id;

    RETURN jsonb_build_object(
      'resultado', 'ok',
      'codigo', 'OK',
      'prestamo_id', v_prestamo.id,
      'movimiento_id', v_movimiento_id,
      'herramienta_id', v_prestamo.herramienta_id,
      'cantidad', p_cantidad,
      'tipo_movimiento', 'DEVOLUCION',
      'cantidad_devuelta', v_prestamo.cantidad_devuelta,
      'estado', v_prestamo.estado,
      'stock_cantidad', v_nueva_cantidad
    );
  EXCEPTION
    WHEN unique_violation THEN
      SELECT *
      INTO v_existente
      FROM public.historial_movimientos_herramientas
      WHERE idempotency_key = p_idempotency_key;

      IF FOUND AND v_existente.tipo_movimiento = 'DEVOLUCION' THEN
        RETURN jsonb_build_object(
          'resultado', 'replay',
          'codigo', 'REPLAY',
          'prestamo_id', v_existente.prestamo_id,
          'movimiento_id', v_existente.id,
          'herramienta_id', v_existente.herramienta_id,
          'cantidad', v_existente.cantidad,
          'tipo_movimiento', v_existente.tipo_movimiento
        );
      END IF;
      RAISE;
  END;
END;
$$;

COMMENT ON FUNCTION public.devolver_herramienta(uuid, bigint, integer, integer) IS
  'Devolución atómica condicionada a cantidad_devuelta esperada. Suma el delta al stock y registra DEVOLUCION, o informa conflicto sin escribir.';

-- =============================================================================
-- 5. Ejecución solo para service_role (cliente de servidor).
-- No cambia privilegios de tabla. anon y authenticated no deben poder llamar
-- estas funciones por PostgREST y saltarse los permisos prestar/devolver.
-- El propietario de la función conserva EXECUTE.
-- =============================================================================

REVOKE ALL ON FUNCTION public.herramienta_ubicacion_es_almacen(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.retirar_herramienta(uuid, bigint, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.devolver_herramienta(uuid, bigint, integer, integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.herramienta_ubicacion_es_almacen(text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.retirar_herramienta(uuid, bigint, integer, text, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.devolver_herramienta(uuid, bigint, integer, integer) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.herramienta_ubicacion_es_almacen(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.retirar_herramienta(uuid, bigint, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.devolver_herramienta(uuid, bigint, integer, integer) TO service_role;

-- =============================================================================
-- 6. Comprobaciones posteriores (solo lectura).
-- Se espera:
--   * columna idempotency_key uuid;
--   * índice único historial_movimientos_herramientas_idempotency_key_uidx;
--   * tres funciones en public;
--   * EXECUTE de service_role;
--   * sin EXECUTE de anon, authenticated ni PUBLIC.
-- El propietario puede seguir apareciendo como ejecutor.
-- =============================================================================

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'historial_movimientos_herramientas'
  AND column_name = 'idempotency_key';

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'historial_movimientos_herramientas_idempotency_key_uidx';

SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN (
    'herramienta_ubicacion_es_almacen',
    'retirar_herramienta',
    'devolver_herramienta'
  )
ORDER BY proname;

SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN (
    'herramienta_ubicacion_es_almacen',
    'retirar_herramienta',
    'devolver_herramienta'
  )
ORDER BY routine_name, grantee, privilege_type;

-- =============================================================================
-- 7. Reversión. NO está activa: va comentada para no deshacer el alta si se
-- ejecuta el archivo completo.
--
-- Esto sí se puede deshacer sin DROP, DELETE ni TRUNCATE, y deja las funciones
-- sin ejecución para service_role (el propietario aún podría ejecutarlas):
--
--   REVOKE EXECUTE ON FUNCTION public.herramienta_ubicacion_es_almacen(text) FROM service_role;
--   REVOKE EXECUTE ON FUNCTION public.retirar_herramienta(uuid, bigint, integer, text, text) FROM service_role;
--   REVOKE EXECUTE ON FUNCTION public.devolver_herramienta(uuid, bigint, integer, integer) FROM service_role;
--
-- Quitar las funciones, el índice o la columna exige DROP FUNCTION, DROP INDEX
-- o DROP COLUMN. No se incluye. Hace falta confirmación aparte porque el
-- enunciado pide no usar DROP salvo que sea imprescindible y se pida antes.
-- La columna idempotency_key puede quedarse en NULL sin afectar los movimientos
-- viejos; el código anterior no la lee.
-- =============================================================================
