import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { enforceIfRealSession } from "@/lib/auth/require";
import {
  asNullableText,
  isObsolescencia,
  isSkuExcluido,
  isTipoSku,
  type Obsolescencia,
  type TipoSku,
} from "@/lib/repuestos-clasificacion";

type RouteContext = { params: Promise<{ codigo: string }> };

type PatchBody = {
  tipo_sku?: unknown;
  categoria?: unknown;
  sub_categoria?: unknown;
  obsolescencia?: unknown;
};

function parseNullableEnum<T extends string>(
  value: unknown,
  isValid: (value: unknown) => value is T,
  field: string,
  allowed: readonly string[]
): T | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new Error(`${field} inválido.`);
  }
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!isValid(trimmed)) {
    throw new Error(`${field} debe ser uno de: ${allowed.join(", ")}.`);
  }
  return trimmed;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const denied = await enforceIfRealSession(
    request,
    "administracion",
    "repuestos",
    "editar"
  );
  if (denied) return denied;

  const { codigo: rawCodigo } = await context.params;
  const codigo = decodeURIComponent(rawCodigo ?? "").trim();
  if (!codigo) {
    return NextResponse.json(
      { success: false, error: "Código inválido." },
      { status: 400 }
    );
  }
  if (isSkuExcluido(codigo)) {
    return NextResponse.json(
      { success: false, error: "SKU excluido." },
      { status: 404 }
    );
  }

  try {
    const body = (await request.json().catch(() => null)) as PatchBody | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { success: false, error: "Solicitud inválida." },
        { status: 400 }
      );
    }

    const patch: {
      tipo_sku?: TipoSku | null;
      categoria?: string | null;
      sub_categoria?: string | null;
      obsolescencia?: Obsolescencia | null;
      updated_at: string;
    } = { updated_at: new Date().toISOString() };

    let hasField = false;
    if ("tipo_sku" in body) {
      patch.tipo_sku = parseNullableEnum(
        body.tipo_sku,
        isTipoSku,
        "tipo_sku",
        ["Preventivo", "Correctivo", "Consumible", "Herramienta"]
      );
      hasField = true;
    }
    if ("categoria" in body) {
      if (body.categoria != null && typeof body.categoria !== "string") {
        return NextResponse.json(
          { success: false, error: "categoria debe ser texto." },
          { status: 400 }
        );
      }
      patch.categoria = asNullableText(body.categoria);
      hasField = true;
    }
    if ("sub_categoria" in body) {
      if (
        body.sub_categoria != null &&
        typeof body.sub_categoria !== "string"
      ) {
        return NextResponse.json(
          { success: false, error: "sub_categoria debe ser texto." },
          { status: 400 }
        );
      }
      patch.sub_categoria = asNullableText(body.sub_categoria);
      hasField = true;
    }
    if ("obsolescencia" in body) {
      patch.obsolescencia = parseNullableEnum(
        body.obsolescencia,
        isObsolescencia,
        "obsolescencia",
        ["Si", "No"]
      );
      hasField = true;
    }

    if (!hasField) {
      return NextResponse.json(
        { success: false, error: "No hay campos para actualizar." },
        { status: 400 }
      );
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("repuestos_clasificacion")
      .update(patch)
      .eq("codigo", codigo)
      .select(
        "codigo,tipo_sku,categoria,sub_categoria,obsolescencia,consumo_prom_dia,updated_at"
      )
      .maybeSingle();

    if (updateError) {
      throw new Error(updateError.message);
    }
    if (updated) {
      return NextResponse.json({ success: true, data: updated });
    }

    const now = patch.updated_at;
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("repuestos_clasificacion")
      .insert({
        codigo,
        tipo_sku: patch.tipo_sku ?? null,
        categoria: patch.categoria ?? null,
        sub_categoria: patch.sub_categoria ?? null,
        obsolescencia: patch.obsolescencia ?? null,
        consumo_prom_dia: null,
        created_at: now,
        updated_at: now,
      })
      .select(
        "codigo,tipo_sku,categoria,sub_categoria,obsolescencia,consumo_prom_dia,updated_at"
      )
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        const { data: retried, error: retryError } = await supabaseAdmin
          .from("repuestos_clasificacion")
          .update(patch)
          .eq("codigo", codigo)
          .select(
            "codigo,tipo_sku,categoria,sub_categoria,obsolescencia,consumo_prom_dia,updated_at"
          )
          .maybeSingle();
        if (retryError) throw new Error(retryError.message);
        if (!retried) {
          throw new Error("No se pudo guardar la clasificación.");
        }
        return NextResponse.json({ success: true, data: retried });
      }
      throw new Error(insertError.message);
    }

    return NextResponse.json({ success: true, data: inserted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    const isValidation =
      /inválido|debe ser uno de|debe ser texto|No hay campos/.test(message);
    return NextResponse.json(
      { success: false, error: message },
      { status: isValidation ? 400 : 500 }
    );
  }
}
