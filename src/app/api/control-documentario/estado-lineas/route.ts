import { NextRequest } from "next/server";
import { documentosTable, itemsTable } from "@/lib/control-documentario/db";
import { jsonError, jsonOk, logServerError } from "@/lib/control-documentario/http";

/**
 * GET /api/control-documentario/estado-lineas?lineas=sigma_id:linea_orden,...
 *
 * Formato: un query param `lineas` con pares `sigma_id:linea_orden` separados
 * por coma. También se aceptan varios `lineas` (getAll) que se concatenan.
 * Ejemplo: ?lineas=123:1,123:2,456:3
 * Máximo 500 pares por consulta.
 */

const MAX_LINEAS = 500;
const PAIR_RE = /^(\d+):(\d+)$/;

type Pair = { sigma_id: number; linea_orden: number };

function parseLineasParam(request: NextRequest): Pair[] | { error: string } {
  const all = request.nextUrl.searchParams.getAll("lineas");
  const raw = all
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  if (raw.length === 0) return [];
  if (raw.length > MAX_LINEAS) {
    return { error: `Se permiten como máximo ${MAX_LINEAS} líneas por consulta.` };
  }

  const seen = new Set<string>();
  const pairs: Pair[] = [];
  for (const token of raw) {
    const m = token.match(PAIR_RE);
    if (!m) {
      return {
        error: "Formato inválido. Use lineas=sigma_id:linea_orden separados por coma.",
      };
    }
    const sigma_id = Number(m[1]);
    const linea_orden = Number(m[2]);
    const key = `${sigma_id}:${linea_orden}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ sigma_id, linea_orden });
  }
  return pairs;
}

export async function GET(request: NextRequest) {
  try {
    const parsed = parseLineasParam(request);
    if ("error" in parsed) return jsonError(parsed.error, 400);
    if (parsed.length === 0) return jsonOk({ data: [] });

    const wanted = new Set(
      parsed.map((p) => `${p.sigma_id}:${p.linea_orden}`)
    );
    const sigmaIds = Array.from(new Set(parsed.map((p) => p.sigma_id)));

    const { data: itemRows, error: itemsError } = await itemsTable()
      .select("sigma_id,linea_orden,documento_id")
      .in("sigma_id", sigmaIds);

    if (itemsError) {
      logServerError("estado-lineas items", itemsError);
      return jsonError("No se pudo consultar el estado de las líneas.", 500);
    }

    const matched = (
      (itemRows as {
        sigma_id?: number;
        linea_orden?: number;
        documento_id?: string;
      }[] | null) ?? []
    ).filter((row) => wanted.has(`${Number(row.sigma_id)}:${Number(row.linea_orden)}`));

    const docIds = Array.from(
      new Set(matched.map((row) => String(row.documento_id ?? "")).filter(Boolean))
    );

    const confirmadoByDoc = new Map<string, boolean>();
    if (docIds.length > 0) {
      const { data: docs, error: docsError } = await documentosTable()
        .select("id,confirmado")
        .in("id", docIds);
      if (docsError) {
        logServerError("estado-lineas docs", docsError);
        return jsonError("No se pudo consultar el estado de los documentos.", 500);
      }
      for (const row of (docs as { id?: string; confirmado?: boolean }[] | null) ?? []) {
        if (row.id) confirmadoByDoc.set(row.id, Boolean(row.confirmado));
      }
    }

    const data = matched
      .filter((row) => row.documento_id)
      .map((row) => {
        const documento_id = String(row.documento_id);
        return {
          sigma_id: Number(row.sigma_id),
          linea_orden: Number(row.linea_orden),
          documento_id,
          confirmado: confirmadoByDoc.get(documento_id) ?? false,
        };
      });

    return jsonOk({ data });
  } catch (err) {
    logServerError("estado-lineas", err);
    return jsonError("Error inesperado al consultar el estado de las líneas.", 500);
  }
}
