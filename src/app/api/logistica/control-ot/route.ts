import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const SELECT_COLUMNS =
  "ot_numero,vehiculo_modelo,vehiculo_placa,linea_codigo,linea_descripcion,linea_cantidad,linea_precio_unitario_pen,linea_fecha_entrega,linea_tipo,ot_tipo_operacion,ot_status,linea_estado";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return NextResponse.json(
      { error: "Faltan variables de entorno de Supabase" },
      { status: 500 }
    );
  }

  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "vista" },
    });

    const { data, error } = await supabase
      .from("Detalle_OT_Pendientes")
      .select(SELECT_COLUMNS)
      .eq("linea_tipo", "SPARE");

    if (!error) {
      return NextResponse.json({ data: data ?? [] });
    }

    // Fallback: REST API with Accept-Profile for custom schema
    const response = await fetch(
      `${url}/rest/v1/Detalle_OT_Pendientes?select=${encodeURIComponent(SELECT_COLUMNS)}&linea_tipo=eq.SPARE`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Accept-Profile": "vista",
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return NextResponse.json(
        {
          error:
            body ||
            error.message ||
            `Supabase HTTP ${response.status}`,
        },
        { status: 500 }
      );
    }

    const restData = (await response.json()) as unknown;
    return NextResponse.json({
      data: Array.isArray(restData) ? restData : [],
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
