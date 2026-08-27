import { NextRequest } from "next/server";
import { jsonError, jsonOk, logServerError } from "@/lib/control-documentario/http";
import { ocDetallesTable } from "@/lib/control-documentario/db";

export async function GET(request: NextRequest) {
  try {
    const search = (request.nextUrl.searchParams.get("search") ?? "").trim();
    let query = ocDetallesTable()
      .select("sigma_id,numero_oc,proveedor,nro_document,fecha_creacion")
      .order("fecha_creacion", { ascending: false })
      .limit(120);

    if (search) {
      query = query.ilike("numero_oc", `%${search}%`);
    }

    const { data, error } = await query;
    if (error) {
      logServerError("ocs", error);
      return jsonError("No se pudieron listar las órdenes de compra.", 500);
    }

    const seen = new Set<string>();
    const items: {
      sigma_id: number;
      numero_oc: string;
      proveedor: string | null;
      nro_document: string | null;
    }[] = [];

    for (const row of (data as Record<string, unknown>[] | null) ?? []) {
      const numero_oc =
        row.numero_oc == null ? "" : String(row.numero_oc).trim();
      if (!numero_oc || seen.has(numero_oc)) continue;
      seen.add(numero_oc);
      const sigma_id = Number(row.sigma_id);
      if (!Number.isInteger(sigma_id) || sigma_id <= 0) continue;
      items.push({
        sigma_id,
        numero_oc,
        proveedor:
          row.proveedor == null || row.proveedor === ""
            ? null
            : String(row.proveedor),
        nro_document:
          row.nro_document == null || row.nro_document === ""
            ? null
            : String(row.nro_document),
      });
      if (items.length >= 40) break;
    }

    return jsonOk({ items });
  } catch (err) {
    logServerError("ocs", err);
    return jsonError("Error inesperado al listar OCs.", 500);
  }
}
