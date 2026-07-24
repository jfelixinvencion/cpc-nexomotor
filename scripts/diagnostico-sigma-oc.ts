/**
 * Diagnóstico de lectura — API Órdenes de Compra (Sigma).
 * Solo GET / inspección. No modifica tablas de negocio.
 *
 * Ejecutar:
 *   npx tsx scripts/diagnostico-sigma-oc.ts
 *   (o) npx ts-node --compiler-options "{\"module\":\"commonjs\"}" scripts/diagnostico-sigma-oc.ts
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const BASE =
  "https://dms-api.sigma-peru.com/api/administration/logistics/purchase-order";
const BASE_QUERY = "all_warehouses=1&store_ids[]=1";

function loadEnvLocal(): void {
  const p = resolve(process.cwd(), ".env.local");
  if (!existsSync(p)) {
    throw new Error("No se encontró .env.local en la raíz del proyecto");
  }
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function section(title: string): void {
  console.log("\n" + "=".repeat(72));
  console.log(title);
  console.log("=".repeat(72));
}

function deepKeys(value: unknown, prefix = ""): string[] {
  if (value === null || value === undefined) return [prefix || "(root)"];
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${prefix}[]`];
    return deepKeys(value[0], `${prefix}[]`);
  }
  if (typeof value !== "object") return [prefix];
  const keys: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") {
      keys.push(...deepKeys(v, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function topLevelKeys(obj: unknown): string[] {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  return Object.keys(obj as object).sort();
}

type OcResponse = {
  data?: unknown;
  pagination?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
};

function extractList(payload: OcResponse): unknown[] {
  const d = payload.data;
  if (Array.isArray(d)) return d;
  if (d && typeof d === "object") {
    const inner = d as Record<string, unknown>;
    for (const key of ["data", "items", "orders", "purchase_orders", "results"]) {
      if (Array.isArray(inner[key])) return inner[key] as unknown[];
    }
  }
  return [];
}

function extractPagination(payload: OcResponse): Record<string, unknown> | null {
  if (payload.pagination && typeof payload.pagination === "object") {
    return payload.pagination as Record<string, unknown>;
  }
  if (payload.meta && typeof payload.meta === "object") {
    return payload.meta as Record<string, unknown>;
  }
  const d = payload.data;
  if (d && typeof d === "object" && !Array.isArray(d)) {
    const inner = d as Record<string, unknown>;
    if (inner.pagination && typeof inner.pagination === "object") {
      return inner.pagination as Record<string, unknown>;
    }
  }
  return null;
}

function paginationTotal(pag: Record<string, unknown> | null): number | null {
  if (!pag) return null;
  for (const key of ["total", "total_records", "totalRecords", "count"]) {
    const v = pag[key];
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
      return Number(v);
    }
  }
  return null;
}

async function fetchOc(
  token: string,
  extraQuery: string
): Promise<{ status: number; payload: OcResponse; url: string }> {
  const qs = [BASE_QUERY, extraQuery].filter(Boolean).join("&");
  const url = `${BASE}?${qs}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-tenant-id": process.env.SIGMA_TENANT_ID!,
      Accept: "application/json",
    },
  });

  let payload: OcResponse = {};
  const text = await res.text();
  try {
    payload = JSON.parse(text) as OcResponse;
  } catch {
    payload = { _raw: text.slice(0, 500) };
  }

  return { status: res.status, payload, url };
}

function summarizeOc(item: unknown): Record<string, unknown> {
  if (!item || typeof item !== "object") return { value: item };
  const o = item as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      if (k in o) out[k] = o[k];
    }
    return out;
  };
  return {
    ...pick(
      "id",
      "code",
      "number",
      "document_number",
      "status",
      "state",
      "creation_date",
      "created_at",
      "updated_at",
      "modified_at",
      "status_changed_at",
      "date",
      "issue_date"
    ),
    _allKeys: topLevelKeys(o),
  };
}

function analyzeOrder(items: unknown[]): string {
  if (items.length < 2) return "Muestra insuficiente (<2) para inferir orden.";

  const ids: number[] = [];
  const dates: string[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = o.id ?? o.purchase_order_id;
    if (typeof id === "number") ids.push(id);
    else if (typeof id === "string" && !Number.isNaN(Number(id))) ids.push(Number(id));

    for (const dk of [
      "creation_date",
      "created_at",
      "date",
      "issue_date",
      "document_date",
    ]) {
      if (o[dk] != null) {
        dates.push(String(o[dk]));
        break;
      }
    }
  }

  const idDesc =
    ids.length >= 2 && ids.every((v, i, a) => i === 0 || a[i - 1] >= v);
  const idAsc =
    ids.length >= 2 && ids.every((v, i, a) => i === 0 || a[i - 1] <= v);

  let dateDesc = false;
  let dateAsc = false;
  if (dates.length >= 2) {
    const ts = dates.map((d) => Date.parse(d));
    if (ts.every((t) => !Number.isNaN(t))) {
      dateDesc = ts.every((v, i, a) => i === 0 || a[i - 1] >= v);
      dateAsc = ts.every((v, i, a) => i === 0 || a[i - 1] <= v);
    }
  }

  const parts: string[] = [];
  if (idDesc) parts.push("IDs en orden DESCENDENTE (nuevas primero por id)");
  else if (idAsc) parts.push("IDs en orden ASCENDENTE");
  else if (ids.length) parts.push("IDs NO monótonos (parece desordenado por id)");

  if (dateDesc) parts.push("fechas en orden DESCENDENTE");
  else if (dateAsc) parts.push("fechas en orden ASCENDENTE");
  else if (dates.length) parts.push("fechas NO monótonas / no comparables");

  if (parts.length === 0) return "No se pudo determinar criterio de orden.";
  return parts.join("; ");
}

function findAuditFields(obj: unknown, prefix = ""): string[] {
  const hits: string[] = [];
  if (!obj || typeof obj !== "object") return hits;
  if (Array.isArray(obj)) {
    if (obj[0]) hits.push(...findAuditFields(obj[0], `${prefix}[]`));
    return hits;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const lower = k.toLowerCase();
    if (
      /updated|modified|changed|audit|timestamp|synced/.test(lower) ||
      (lower.includes("date") && !/creation|created|issue|document/.test(lower))
    ) {
      hits.push(`${path} = ${JSON.stringify(v)}`);
    }
    if (v && typeof v === "object") {
      hits.push(...findAuditFields(v, path));
    }
  }
  return hits;
}

function analyzeLineItems(oc: unknown): string {
  if (!oc || typeof oc !== "object") return "OC inválida.";
  const o = oc as Record<string, unknown>;
  const candidates = [
    "details",
    "items",
    "products",
    "lines",
    "line_items",
    "purchase_order_details",
    "purchase_order_items",
    "detail",
  ];

  for (const key of candidates) {
    const val = o[key];
    if (Array.isArray(val)) {
      if (val.length === 0) {
        return `Campo "${key}" existe como array vacío.`;
      }
      const first = val[0];
      const keys = topLevelKeys(first);
      const onlyIds =
        keys.length > 0 &&
        keys.every((k) => /^(id|product_id|item_id|sku_id|article_id)$/i.test(k));
      return [
        `Líneas en array "${key}" (length=${val.length}).`,
        onlyIds
          ? "Parecen solo IDs (poca información embebida)."
          : "Traen objeto con varios campos (información embebida).",
        `Llaves del primer ítem: ${keys.join(", ") || "(ninguna)"}`,
      ].join(" ");
    }
  }

  // nested under data
  for (const key of Object.keys(o)) {
    const val = o[key];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const nested = analyzeLineItems(val);
      if (!nested.startsWith("No se encontró") && !nested.startsWith("OC inválida")) {
        return `Dentro de "${key}": ${nested}`;
      }
    }
  }

  return (
    "No se encontró array details/items/products/lines en la OC de listado. " +
    "Puede requerir un GET por id para ver el detalle."
  );
}

async function main(): Promise<void> {
  loadEnvLocal();

  // Imports dinámicos después de cargar env (supabaseAdmin lee process.env al importar)
  const { getStoredToken } = await import("../src/lib/sigma/token");
  const { sigmaLogin } = await import("../src/lib/sigma/client");

  let token = await getStoredToken();
  if (!token) {
    console.log("No hay token guardado; ejecutando sigmaLogin()…");
    token = await sigmaLogin();
  } else {
    console.log("Usando token de getStoredToken().");
  }

  // Validar token con una llamada; si 401, re-login
  let probe = await fetchOc(token, "page=1&per_page=1");
  if (probe.status === 401 || probe.status === 403) {
    console.log(`Token rechazado (${probe.status}); renovando con sigmaLogin()…`);
    token = await sigmaLogin();
    probe = await fetchOc(token, "page=1&per_page=1");
  }

  if (probe.status < 200 || probe.status >= 300) {
    console.error("No se pudo consultar la API de OC.", {
      status: probe.status,
      url: probe.url,
      payloadKeys: topLevelKeys(probe.payload),
      snippet: JSON.stringify(probe.payload).slice(0, 800),
    });
    process.exit(1);
  }

  console.log("\n########## REPORTE DE DESCUBRIMIENTO — Sigma Purchase Orders ##########");
  console.log(`Base: ${BASE}?${BASE_QUERY}`);
  console.log(`Tenant header: x-tenant-id=${process.env.SIGMA_TENANT_ID}`);

  // -------------------------------------------------------------------------
  // A) Paginación
  // -------------------------------------------------------------------------
  section("A) Paginación y límites (per_page=50 / 100 / 500)");

  const pageResults: {
    perPage: number;
    status: number;
    returned: number;
    pagination: Record<string, unknown> | null;
    total: number | null;
  }[] = [];

  for (const perPage of [50, 100, 500]) {
    const { status, payload } = await fetchOc(
      token,
      `page=1&per_page=${perPage}`
    );
    const list = extractList(payload);
    const pagination = extractPagination(payload);
    const total = paginationTotal(pagination);
    pageResults.push({
      perPage,
      status,
      returned: list.length,
      pagination,
      total,
    });
    console.log(`\nper_page=${perPage}`);
    console.log(`  HTTP ${status}`);
    console.log(`  registros devueltos en data: ${list.length}`);
    console.log(`  pagination: ${JSON.stringify(pagination)}`);
    console.log(`  total (pagination): ${total}`);
  }

  const maxReturned = Math.max(...pageResults.map((r) => r.returned), 0);
  console.log(`\n→ Máximo de registros realmente devueltos en una página: ${maxReturned}`);

  // -------------------------------------------------------------------------
  // B) Ordenamiento
  // -------------------------------------------------------------------------
  section("B) Ordenamiento (page=1, per_page=50)");

  const page1 = await fetchOc(token, "page=1&per_page=50");
  const list1 = extractList(page1.payload);
  const first3 = list1.slice(0, 3).map(summarizeOc);
  const last3 = list1.slice(-3).map(summarizeOc);

  console.log("\nPrimeros 3:");
  console.log(JSON.stringify(first3, null, 2));
  console.log("\nÚltimos 3:");
  console.log(JSON.stringify(last3, null, 2));
  console.log(`\n→ Inferencia de orden: ${analyzeOrder(list1)}`);

  // -------------------------------------------------------------------------
  // C) Campos de auditoría + llaves
  // -------------------------------------------------------------------------
  section("C) Campos de auditoría y estructura de una OC");

  const sample = list1[0];
  if (!sample) {
    console.log("No hay OC en page=1 para inspeccionar.");
  } else {
    const keys = topLevelKeys(sample);
    console.log("\nLlaves de primer nivel de una OC:");
    console.log(keys.join("\n"));

    console.log("\nÁrbol de llaves (profundidad, arrays como []):");
    console.log(deepKeys(sample).join("\n"));

    const auditHits = findAuditFields(sample);
    console.log("\nCandidatos a auditoría / fechas no-creación:");
    if (auditHits.length === 0) {
      console.log("  (ninguno obvio: updated_at / modified_at / status_changed_at)");
    } else {
      for (const h of auditHits) console.log(`  - ${h}`);
    }

    const o = sample as Record<string, unknown>;
    console.log("\nFechas explícitas vistas:");
    for (const k of Object.keys(o).sort()) {
      if (/date|at$/i.test(k) || /time/i.test(k)) {
        console.log(`  ${k}: ${JSON.stringify(o[k])}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // D) Filtros ocultos
  // -------------------------------------------------------------------------
  section("D) Fuerza bruta de filtros (¿baja pagination.total?)");

  const baseline = await fetchOc(token, "page=1&per_page=1");
  const baselinePag = extractPagination(baseline.payload);
  const baselineTotal = paginationTotal(baselinePag);
  console.log(`Baseline total: ${baselineTotal}`);
  console.log(`Baseline pagination: ${JSON.stringify(baselinePag)}`);

  // Descubrir un status real de la muestra
  const statuses = new Set<string>();
  for (const item of list1) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    for (const sk of ["status", "state", "status_name", "status_label"]) {
      if (o[sk] != null && o[sk] !== "") statuses.add(String(o[sk]));
    }
  }
  const statusSample = [...statuses][0] ?? "PENDIENTE";
  console.log(`Estados observados en page=1: ${[...statuses].join(", ") || "(ninguno)"}`);
  console.log(`Usando status de prueba: ${statusSample}`);

  const filterVariants = [
    "date_from=2026-07-01",
    "start_date=2026-07-01",
    "created_at_min=2026-07-01",
    `status=${encodeURIComponent(statusSample)}`,
    "status=PENDIENTE",
    "updated_from=2026-07-01",
    "from_date=2026-07-01",
    "creation_date_from=2026-07-01",
  ];

  for (const variant of filterVariants) {
    const { status, payload } = await fetchOc(token, `page=1&per_page=1&${variant}`);
    const pag = extractPagination(payload);
    const total = paginationTotal(pag);
    const delta =
      baselineTotal != null && total != null ? total - baselineTotal : null;
    const works =
      baselineTotal != null && total != null && total < baselineTotal
        ? "SÍ (total bajó → filtro parece activo)"
        : baselineTotal != null && total != null && total === baselineTotal
          ? "NO (total igual)"
          : status >= 400
            ? `HTTP ${status} (rechazado/inválido)`
            : "INDETERMINADO";

    console.log(`\n&${variant}`);
    console.log(`  HTTP ${status} | total=${total} | Δ=${delta} | ${works}`);
    if (status >= 400) {
      console.log(`  error snippet: ${JSON.stringify(payload).slice(0, 300)}`);
    }
  }

  // -------------------------------------------------------------------------
  // E) Consistencia de productos / details
  // -------------------------------------------------------------------------
  section("E) Análisis de consistencia (details / items)");

  if (!sample) {
    console.log("Sin muestra de OC.");
  } else {
    console.log(analyzeLineItems(sample));

    // Si hay id, intentar detalle por id (solo lectura)
    const oc = sample as Record<string, unknown>;
    const ocId = oc.id;
    if (ocId != null) {
      const detailUrl = `${BASE}/${ocId}?${BASE_QUERY}`;
      console.log(`\nProbando detalle por id: GET …/purchase-order/${ocId}`);
      const res = await fetch(detailUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-tenant-id": process.env.SIGMA_TENANT_ID!,
          Accept: "application/json",
        },
      });
      const text = await res.text();
      let detailPayload: unknown = null;
      try {
        detailPayload = JSON.parse(text);
      } catch {
        detailPayload = text.slice(0, 300);
      }
      console.log(`  HTTP ${res.status}`);
      if (res.ok && detailPayload && typeof detailPayload === "object") {
        const detailObj =
          (detailPayload as OcResponse).data &&
          typeof (detailPayload as OcResponse).data === "object" &&
          !Array.isArray((detailPayload as OcResponse).data)
            ? (detailPayload as OcResponse).data
            : detailPayload;
        console.log(`  Llaves detalle: ${topLevelKeys(detailObj).join(", ")}`);
        console.log(`  ${analyzeLineItems(detailObj)}`);
      } else {
        console.log(`  Respuesta: ${JSON.stringify(detailPayload).slice(0, 400)}`);
      }
    }
  }

  section("FIN DEL REPORTE");
  console.log("No se modificó código de la app ni tablas de negocio (solo lecturas API / token).");
}

main().catch((err) => {
  console.error("Diagnóstico falló:", err instanceof Error ? err.message : err);
  process.exit(1);
});
