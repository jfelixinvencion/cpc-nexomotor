# Sincronización de Órdenes de Trabajo (OT) desde SIGMA

Sincroniza `work_orders` desde el API DMS de SIGMA hacia la tabla raw `public.ordenes_trabajo_raw` en Supabase. Cada OT se guarda íntegra en `payload` (jsonb).

## Archivos

| Archivo | Rol |
|---|---|
| `sql/create_table_ordenes_trabajo_raw.sql` | DDL de la tabla e índice único por `source_id` |
| `src/app/api/sync-work-orders/route.ts` | API route `POST /api/sync-work-orders` |
| `.github/workflows/sync-work-orders.yml` | Disparo manual con confirmación `SINCRONIZAR` |

## 1. Crear la tabla en Supabase

Ejecutar el SQL en el SQL Editor de Supabase (o `psql`):

```bash
# Contenido: sql/create_table_ordenes_trabajo_raw.sql
```

Verifica:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'ordenes_trabajo_raw';
```

## 2. Variables de entorno (host de la app)

Configurar en el entorno donde corre Next.js (p. ej. Vercel), **no** solo en GitHub Actions:

| Variable | Requerida | Descripción |
|---|---|---|
| `SIGMA_LOGIN_URL` | Sí | URL completa de login, p. ej. `https://dms-api.sigma-peru.com/api/auth/login` |
| `SIGMA_TENANT_ID` | Sí | Header `x-tenant-id` |
| `SIGMA_USERNAME` | Sí | Usuario API |
| `SIGMA_PASSWORD` | Sí | Contraseña API |
| `SIGMA_OT_ENDPOINT` | Sí | Endpoint OT, p. ej. `https://dms-api.sigma-peru.com/api/after-sale/work-order-spare/requests` |
| `SIGMA_OT_PER_PAGE` | No | Default `50` |
| `SIGMA_OT_MAX_PAGES` | No | Tope de páginas por corrida; default `100` |
| `STORE_ID` o `SIGMA_STORE_ID` | No | Valor de `store_ids[]`; default `1` |
| `SYNC_TRIGGER_SECRET` | Sí | Debe coincidir con el header `x-sync-secret` del workflow |
| `NEXT_PUBLIC_SUPABASE_URL` | Sí | Proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Sí | Service role (upsert) |

Secrets de GitHub Actions (reutilizados de OC):

| Secret | Uso |
|---|---|
| `APP_SYNC_URL` | Origin de la app, sin path final (p. ej. `https://tu-app.vercel.app`) |
| `SYNC_TRIGGER_SECRET` | Mismo valor que en el host de la app |

## 3. Despliegue

1. Merge del PR y deploy de la app.
2. Aplicar el SQL de la tabla si aún no existe.
3. Confirmar que `SIGMA_OT_ENDPOINT` (y el resto) están en el host.
4. En GitHub → Actions → **Sincronizar Órdenes de Trabajo Sigma**:
   - `mode`: `recent` (incremental) o `full`
   - `confirmar`: exactamente `SINCRONIZAR`

El workflow hace:

```http
POST {APP_SYNC_URL}/api/sync-work-orders?mode={mode}
x-sync-secret: {SYNC_TRIGGER_SECRET}
```

## 4. Modos

- **`full`**: recorre páginas desde `page=1` hasta `last_page` (o hasta `SIGMA_OT_MAX_PAGES`).
- **`recent`**: lee `max(created_at)` de `ordenes_trabajo_raw`. Si la tabla está vacía, se comporta como `full`. Si hay máximo, pagina desde 1 y se detiene cuando **todas** las OT de la página tienen `created_at <= max(created_at)`.

## 5. Respuesta de la API

```json
{
  "success": true,
  "mode": "recent",
  "requestedMode": "recent",
  "maxCreatedAt": "2026-07-01T12:34:56.000Z",
  "pagesFetched": 3,
  "lastPage": 23,
  "stoppedEarly": true,
  "fetched": 40,
  "upserted": 40,
  "errors": []
}
```

- `401` si falta o no coincide `x-sync-secret`.
- Errores por página se acumulan en `errors` sin abortar el resto de la corrida.
- Fallos fatales de setup (env, login, etc.) responden HTTP `200` con `success: false` y detalle en `errors` / `error`.

## 6. Query SIGMA (referencia F12)

```
GET {SIGMA_OT_ENDPOINT}?page=1&per_page=50&work_order_is_quote=0&store_ids[]=1
```

Estructura esperada:

```json
{
  "code": 200,
  "data": {
    "work_orders": [{ "id": 12345, "number": "OT-0001", "created_at": "...", "status": "..." }],
    "pagination": { "current_page": 1, "last_page": 23, "per_page": 15, "total": 345 }
  },
  "message": "Success"
}
```

## 7. Upsert

Conflicto por `source_id` (índice único). Se actualizan `payload`, `work_order_number`, `status`, `fetched_at`. Si la OT entrante no trae `created_at` parseable, no se sobrescribe el `created_at` existente.
