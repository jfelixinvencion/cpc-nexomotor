import { NextRequest } from "next/server";
import { itemsTable, ocDetallesTable } from "@/lib/control-documentario/db";
import { jsonError, jsonOk, logServerError } from "@/lib/control-documentario/http";
import { isUuid } from "@/lib/control-documentario/parse";
import { enforceIfRealSession } from "@/lib/auth/require";

export async function GET(request: NextRequest) {
  const denied = await enforceIfRealSession(
    request,
    "logistica",
    "control_documentario",
    "ver"
  );
  if (denied) return denied;

  try {
    const numeroOc = (request.nextUrl.searchParams.get("numero_oc") ?? "").trim();
    const documentoId = (
      request.nextUrl.searchParams.get("documento_id") ?? ""
    ).trim();

    if (!numeroOc) {
      return jsonError("numero_oc es obligatorio.", 400);
    }
    if (documentoId && !isUuid(documentoId)) {
      return jsonError("documento_id inválido.", 400);
    }

    const { data, error } = await ocDetallesTable()
      .select(
        "sigma_id,numero_oc,linea_orden,codigo_repuesto,descripcion_repuesto,cantidad,precio_total_con_igv_soles,proveedor,nro_document"
      )
      .eq("numero_oc", numeroOc)
      .order("linea_orden", { ascending: true });

    if (error) {
      logServerError("lineas-disponibles vista", error);
      return jsonError("No se pudieron leer las líneas de la OC.", 500);
    }

    const rows = (data as Record<string, unknown>[] | null) ?? [];
    if (rows.length === 0) {
      return jsonOk({
        numero_oc: numeroOc,
        sigma_id: null,
        proveedor: null,
        nro_document: null,
        items: [],
      });
    }

    const sigmaIds = Array.from(
      new Set(
        rows
          .map((row) => Number(row.sigma_id))
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    );

    const taken = new Map<string, string>();
    if (sigmaIds.length > 0) {
      const { data: linked, error: linkedError } = await itemsTable()
        .select("sigma_id,linea_orden,documento_id")
        .in("sigma_id", sigmaIds);
      if (linkedError) {
        logServerError("lineas-disponibles items", linkedError);
        return jsonError("No se pudo verificar líneas ya documentadas.", 500);
      }
      for (const row of (linked as Record<string, unknown>[] | null) ?? []) {
        const key = `${Number(row.sigma_id)}:${Number(row.linea_orden)}`;
        taken.set(key, String(row.documento_id ?? ""));
      }
    }

    const items = [];
    for (const row of rows) {
      const sigma_id = Number(row.sigma_id);
      const linea_orden = Number(row.linea_orden);
      if (!Number.isInteger(sigma_id) || !Number.isInteger(linea_orden)) continue;
      const owner = taken.get(`${sigma_id}:${linea_orden}`);
      if (owner && owner !== documentoId) continue;
      const codigo =
        row.codigo_repuesto == null ? "" : String(row.codigo_repuesto).trim();
      if (!codigo) continue;
      items.push({
        sigma_id,
        numero_oc: String(row.numero_oc ?? numeroOc),
        linea_orden,
        codigo_repuesto: codigo,
        descripcion_repuesto:
          row.descripcion_repuesto == null || row.descripcion_repuesto === ""
            ? null
            : String(row.descripcion_repuesto),
        cantidad: row.cantidad ?? null,
        precio_total_con_igv_soles: row.precio_total_con_igv_soles ?? null,
        ya_en_documento: Boolean(owner && owner === documentoId),
      });
    }

    const first = rows[0];
    return jsonOk({
      numero_oc: numeroOc,
      sigma_id: Number(first.sigma_id) || null,
      proveedor:
        first.proveedor == null || first.proveedor === ""
          ? null
          : String(first.proveedor),
      nro_document:
        first.nro_document == null || first.nro_document === ""
          ? null
          : String(first.nro_document),
      items,
    });
  } catch (err) {
    logServerError("lineas-disponibles", err);
    return jsonError("Error inesperado al listar líneas disponibles.", 500);
  }
}
