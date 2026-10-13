import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/auth/admin-rules";
import {
  handleAuthRoute,
  HttpError,
  requirePermission,
} from "@/lib/auth/require";
import { supabaseAdmin } from "@/lib/supabase/admin";

const MAX_DELETE_IDS = 200;

function parseDeleteIds(raw: unknown): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError("Cuerpo inválido. Envíe un objeto con ids.", 400);
  }

  const ids = (raw as { ids?: unknown }).ids;
  if (!Array.isArray(ids)) {
    throw new HttpError("Debe enviar una lista de ids.", 400);
  }
  if (ids.length === 0) {
    throw new HttpError("La lista de ids no puede estar vacía.", 400);
  }
  if (ids.length > MAX_DELETE_IDS) {
    throw new HttpError(
      `Máximo ${MAX_DELETE_IDS} registros por solicitud.`,
      400
    );
  }

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of ids) {
    if (typeof value !== "string" || !isUuid(value.trim())) {
      throw new HttpError("Todos los ids deben ser UUID válidos.", 400);
    }
    const id = value.trim();
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(id);
  }

  if (unique.length === 0) {
    throw new HttpError("La lista de ids no puede estar vacía.", 400);
  }

  return unique;
}

export async function DELETE(request: NextRequest) {
  return handleAuthRoute(request, async (session) => {
    await requirePermission(session, "logistica", "inversa", "eliminar");

    const body = await request.json().catch(() => null);
    const ids = parseDeleteIds(body);

    const { data, error } = await supabaseAdmin
      .from("logistica_inversa")
      .delete()
      .in("id", ids)
      .select("id");

    if (error) {
      console.error("[inversa-historial] delete:", error.message);
      throw new HttpError("No se pudieron eliminar los registros.", 500);
    }

    const deletedIds = ((data as { id?: unknown }[] | null) ?? [])
      .map((row) => (typeof row.id === "string" ? row.id : String(row.id ?? "")))
      .filter((id) => id.length > 0);

    const deletedKeys = new Set(deletedIds.map((id) => id.toLowerCase()));
    const notDeletedIds = ids.filter((id) => !deletedKeys.has(id.toLowerCase()));
    const allDeleted = notDeletedIds.length === 0;

    return NextResponse.json({
      success: allDeleted,
      deletedIds,
      notDeletedIds,
      requestedCount: ids.length,
      deletedCount: deletedIds.length,
    });
  });
}
