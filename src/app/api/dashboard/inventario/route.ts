import { NextRequest, NextResponse } from "next/server";
import { enforceIfRealSession } from "@/lib/auth/require";
import { listRepuestosJoinBase } from "@/lib/repuestos-clasificacion-db";
import {
  conteoSinClasificar,
  conteoSkusConStock,
  itemsDetalle,
  porCategoria,
  porCategoriaSinRotacion,
  porRotacion,
  porTipoSku,
  sinRotacion,
  toInventarioItems,
  valorizadoTotal,
} from "@/lib/dashboard-inventario";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = await enforceIfRealSession(
    request,
    "dashboard",
    "inventario",
    "ver"
  );
  if (denied) return denied;

  try {
    const now = new Date();
    const { items: joinItems, fechaActualizacionTabla } =
      await listRepuestosJoinBase();
    const items = toInventarioItems(joinItems, now);
    const clasificados = items.filter((item) => item.clasificado);

    return NextResponse.json({
      success: true,
      fechaCorte: now.toISOString(),
      fechaActualizacionTabla,
      valorizadoTotal: valorizadoTotal(items),
      skusConStock: conteoSkusConStock(items),
      sinClasificar: conteoSinClasificar(items),
      sinRotacion: sinRotacion(items),
      porTipoSku: porTipoSku(items),
      porCategoriaPreventivo: porCategoria(items, "Preventivo"),
      porCategoriaCorrectivo: porCategoria(items, "Correctivo"),
      porCategoriaSinRotacion: porCategoriaSinRotacion(items),
      porRotacion: porRotacion(items),
      itemsDetalle: itemsDetalle(clasificados),
      itemsSinClasificar: itemsDetalle(
        items.filter((item) => !item.clasificado)
      ),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("[dashboard-inventario] GET:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
