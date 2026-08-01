# Sincronización de Órdenes de Trabajo (OT) desde SIGMA

Sincroniza `work_orders` desde el API DMS de SIGMA hacia Supabase.

Hay dos destinos según el modo:

| Modo | Tabla | Comportamiento |
|---|---|---|
| `recent` | `public.ordenes_trabajo_raw` | Upsert incremental por listado (compatibilidad) |
| `full` | `public.ordenes_trabajo_detalle` | Full-refresh: `TRUNCATE` + detalle por ID (`ON_REQUEST` + `UNATTENDED`) |

## Archivos

| Archivo | Rol |
|---|---|
| `sql/create_table_ordenes_trabajo_raw.sql` | DDL raw + índice único por `source_id` |
| `sql/create_table_ordenes_trabajo_detalle.sql` | DDL detalle + RPC `truncate_ordenes_trabajo_detalle()` |
| `src/app/api/sync-work-orders/route.ts` | API route `POST /api/sync-work-orders` |
| `.github/workflows/sync-work-orders.yml` | Disparo manual con confirmación `SINCRONIZAR` |

## 1. Crear las tablas en Supabase

Ejecutar en el SQL Editor (o `psql`), en este orden:

1. `sql/create_table_ordenes_trabajo_raw.sql` (si aún no existe)
2. `sql/create_table_ordenes_trabajo_detalle.sql`

Verifica detalle:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'ordenes_trabajo_detalle';
```

## 2. Variables de entorno (host de la app)

Configurar en el entorno donde corre Next.js (p. ej. Vercel), **no** solo en GitHub Actions:

| Variable | Requerida | Descripción |
|---|---|---|
| `SIGMA_LOGIN_URL` | Sí | URL completa de login |
| `SIGMA_TENANT_ID` | Sí | Header `x-tenant-id` |
| `SIGMA_USERNAME` | Sí | Usuario API |
| `SIGMA_PASSWORD` | Sí | Contraseña API |
| `SIGMA_OT_ENDPOINT` | Sí | Endpoint listado OT, p. ej. `…/work-order-spare/requests` |
| `SIGMA_OT_PER_PAGE` | No | Default `50` |
| `SIGMA_OT_MAX_PAGES` | No | Tope de páginas por listado; default `100` |
| `SIGMA_DETAIL_CONCURRENCY` | No | Detalles en paralelo (`mode=full`); default `4` |
| `SIGMA_DETAIL_BATCH_DELAY_MS` | No | Delay entre lotes de detalle; default `0` |
| `STORE_ID` o `SIGMA_STORE_ID` | No | Valor de `store_ids[]`; default `1` |
| `SYNC_TRIGGER_SECRET` | Sí | Debe coincidir con el header `x-sync-secret` |
| `NEXT_PUBLIC_SUPABASE_URL` | Sí | Proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Sí | Service role |

Secrets de GitHub Actions:

| Secret | Uso |
|---|---|
| `APP_SYNC_URL` | Origin de la app, sin path final |
| `SYNC_TRIGGER_SECRET` | Mismo valor que en el host |

## 3. Despliegue

1. Merge del PR y deploy de la app.
2. Aplicar el SQL de `ordenes_trabajo_detalle` si aún no existe.
3. Confirmar env vars en el host.
4. GitHub → Actions → **Sincronizar Órdenes de Trabajo Sigma**:
   - `mode`: `recent` o `full`
   - `confirmar`: exactamente `SINCRONIZAR`

```http
POST {APP_SYNC_URL}/api/sync-work-orders?mode={mode}
x-sync-secret: {SYNC_TRIGGER_SECRET}
```

## 4. Modos

### `full` — detalle (`ordenes_trabajo_detalle`)

1. `TRUNCATE` vía RPC `truncate_ordenes_trabajo_detalle()` (fallback: delete all).
2. Lista OT con `request_status=ON_REQUEST` y `request_status=UNATTENDED` (paginado).
3. Recoge `work_orders[].id` (no `number`).
4. Por cada id: `GET {base}/work-order/{id}` (base = `SIGMA_OT_ENDPOINT` sin el sufijo `/requests`).
5. Inserta filas con `source_id`, `work_order_number`, `status`, `store_id`, `fetched_at`, `payload` (JSON crudo del detalle).
6. Concurrencia: `SIGMA_DETAIL_CONCURRENCY` (default 4); delay opcional entre lotes.

Respuesta:

```json
{
  "success": true,
  "mode": "full",
  "truncated": true,
  "total_listed": 120,
  "total_details_fetched": 118,
  "errors": [{ "id": 99, "error": "detail 99 failed: 404 …" }]
}
```

### `recent` — raw (`ordenes_trabajo_raw`)

Compatibilidad con el sync listado previo:

- Lee `max(created_at)` de `ordenes_trabajo_raw`. Si la tabla está vacía, pagina como full-list (sin filtro de detalle).
- Se detiene cuando **todas** las OT de la página tienen `created_at <= max(created_at)`.

## 5. Smoke test (después de merge)

```bash
curl -X POST "https://your-app-url/api/sync-work-orders?mode=full" \
  -H "x-sync-secret: <SYNC_TRIGGER_SECRET>"
```

O localmente con `next dev` apuntando a las mismas env vars.

Luego en Supabase:

```sql
SELECT count(*) FROM public.ordenes_trabajo_detalle;
SELECT payload->>'id' as id, payload->>'number' as number
FROM public.ordenes_trabajo_detalle
ORDER BY fetched_at DESC
LIMIT 10;
```

## 6. Query SIGMA (referencia)

Listado (`mode=full`):

```
GET {SIGMA_OT_ENDPOINT}?page=1&per_page=50&work_order_is_quote=0&store_ids[]=1&request_status=ON_REQUEST
GET {SIGMA_OT_ENDPOINT}?page=1&per_page=50&work_order_is_quote=0&store_ids[]=1&request_status=UNATTENDED
```

Detalle:

```
GET {SIGMA_OT_ENDPOINT sin /requests}/work-order/{id}
```
