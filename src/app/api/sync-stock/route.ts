import { NextRequest, NextResponse } from "next/server";
import { getSigmaReport, sigmaLogin } from "@/lib/sigma/client";
import {
  hasLocalAndUbicacionData,
  parseXlsxFromUrl,
} from "@/lib/sigma/parse-xlsx";
import { getStoredToken } from "@/lib/sigma/token";
import { supabaseAdmin } from "@/lib/supabase/admin";

const BATCH_SIZE = 500;

function isSigmaAuthError(err: unknown): boolean {
  return err instanceof Error && /Sigma error (401|403):/.test(err.message);
}

function isAuthorizedSyncRequest(request: NextRequest): boolean {
  const expected = process.env.SYNC_TRIGGER_SECRET;
  if (!expected) return false;
  const provided = request.headers.get("x-sync-secret");
  return provided === expected;
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedSyncRequest(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const token = await getStoredToken();
    let report;

    if (token) {
      try {
        report = await getSigmaReport();
      } catch (err) {
        if (isSigmaAuthError(err)) {
          await sigmaLogin();
          report = await getSigmaReport();
        } else {
          throw err;
        }
      }
    } else {
      await sigmaLogin();
      report = await getSigmaReport();
    }

    console.log("[sync-stock] report request URL:", report.requestUrl);
    console.log(
      "[sync-stock] report request headers:",
      report.requestHeadersLogged
    );
    console.log(
      "[sync-stock] Sigma response JSON (fileUrl query redacted):",
      JSON.stringify(report.responseLogged, null, 2)
    );

    const { rows: repuestos, diagnostics } = await parseXlsxFromUrl(
      report.fileUrl
    );
    const validRecords = repuestos.filter(
      (repuesto) => repuesto.codigo && repuesto.codigo.trim() !== ""
    );

    if (validRecords.length === 0) {
      throw new Error(
        "No se encontraron registros válidos con codigo en el Excel"
      );
    }

    console.log("[sync-stock] parse diagnostics summary:", {
      localNonEmpty: diagnostics.localNonEmpty,
      ubicacionNonEmpty: diagnostics.ubicacionNonEmpty,
      totalRows: diagnostics.totalRows,
      localColumns: diagnostics.localColumns,
      ubicacionColumns: diagnostics.ubicacionColumns,
      headersRaw: diagnostics.headersRaw,
    });

    if (!hasLocalAndUbicacionData(validRecords)) {
      console.error(
        "[sync-stock] ABORT: Excel sin datos de LOCAL y/o UBICACIÓN. No se borrará la tabla.",
        {
          localNonEmpty: diagnostics.localNonEmpty,
          ubicacionNonEmpty: diagnostics.ubicacionNonEmpty,
          headersRaw: diagnostics.headersRaw,
          columnMap: diagnostics.columnMap,
          firstRowSample: diagnostics.firstRowSample,
        }
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "El Excel descargado desde Sigma no trae datos en LOCAL y/o UBICACIÓN. " +
            "La tabla public.repuestos NO fue modificada. " +
            "Revisa los logs del servidor (encabezados y primera fila) y compara con el Excel manual del UI.",
          diagnostics: {
            headersRaw: diagnostics.headersRaw,
            headersNormalized: diagnostics.headersNormalized,
            columnMap: diagnostics.columnMap,
            localNonEmpty: diagnostics.localNonEmpty,
            ubicacionNonEmpty: diagnostics.ubicacionNonEmpty,
            totalRows: diagnostics.totalRows,
            firstRowSample: diagnostics.firstRowSample,
            requestUrl: report.requestUrl,
            requestHeaders: report.requestHeadersLogged,
            sigmaResponse: report.responseLogged,
          },
        },
        { status: 422 }
      );
    }

    const { error: deleteError } = await supabaseAdmin
      .from("repuestos")
      .delete()
      .gte("codigo", "");

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    for (let i = 0; i < validRecords.length; i += BATCH_SIZE) {
      const batch = validRecords.slice(i, i + BATCH_SIZE);
      const { error: insertError } = await supabaseAdmin
        .from("repuestos")
        .insert(batch);

      if (insertError) {
        throw new Error(insertError.message);
      }
    }

    return NextResponse.json({
      success: true,
      total: validRecords.length,
      inserted: validRecords.length,
      errors: [],
      diagnostics: {
        localNonEmpty: diagnostics.localNonEmpty,
        ubicacionNonEmpty: diagnostics.ubicacionNonEmpty,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error("[sync-stock] error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
