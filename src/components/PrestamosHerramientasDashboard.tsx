"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ArrowLeftRight,
  Clock3,
  Loader2,
  PackageCheck,
  Search,
  Undo2,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";

type PrestamosSubTab = "disponibles" | "pendientes" | "historial";

type HerramientaDisponible = {
  id: number;
  codigo: string;
  descripcion: string;
  cantidad: number;
  ubicacion: string | null;
  responsable: string | null;
};

type PrestamoPendiente = {
  id: number;
  herramienta_id: number | null;
  descripcion_herramienta: string;
  cantidad_prestada: number;
  cantidad_devuelta: number;
  responsable: string;
  destino: string;
  estado: string;
  fecha_hora_retiro: string;
  fecha_hora_devolucion_final: string | null;
};

type HistorialMovimiento = {
  id: number;
  tipo_movimiento: string;
  descripcion_herramienta: string;
  cantidad: number;
  responsable: string | null;
  destino: string | null;
  fecha_hora: string;
};

type PlanillaActivo = {
  id: number;
  nombres: string;
  apellido_paterno: string;
  apellido_materno: string | null;
};

function asText(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isUbicacionAlmacen(ubicacion: string | null | undefined) {
  return normalize(ubicacion ?? "") === "almacen";
}

function fullName(p: PlanillaActivo) {
  return [p.nombres, p.apellido_paterno, p.apellido_materno]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function herramientaLabel(item: {
  codigo?: string | null;
  descripcion?: string | null;
  descripcion_herramienta?: string | null;
}) {
  if (item.descripcion_herramienta) return asText(item.descripcion_herramienta);
  const codigo = asText(item.codigo);
  const descripcion = asText(item.descripcion);
  if (codigo && descripcion) return `${codigo} — ${descripcion}`;
  return descripcion || codigo || "—";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatSupabaseError(error: unknown, fallback = "Error desconocido") {
  if (!error) return fallback;

  if (typeof error === "string" && error.trim()) return error;

  if (typeof error === "object") {
    const e = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
      error?: unknown;
      status?: unknown;
    };

    const parts = [
      asText(e.message),
      asText(e.details),
      asText(e.hint),
      asText(e.code) ? `code=${asText(e.code)}` : "",
      e.status != null ? `status=${String(e.status)}` : "",
    ].filter(Boolean);

    if (parts.length > 0) return parts.join(" | ");

    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}") return json;
    } catch {
      // ignore stringify errors
    }
  }

  const asString = String(error);
  return asString && asString !== "[object Object]" ? asString : fallback;
}

function mapHerramienta(row: Record<string, unknown>): HerramientaDisponible {
  return {
    id: Number(row.id),
    codigo: asText(row.codigo),
    descripcion: asText(row.descripcion),
    cantidad: Number(row.cantidad ?? 0),
    ubicacion: asText(row.ubicacion) || null,
    responsable: asText(row.responsable) || null,
  };
}

export default function PrestamosHerramientasDashboard() {
  const [subTab, setSubTab] = useState<PrestamosSubTab>("disponibles");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [disponibles, setDisponibles] = useState<HerramientaDisponible[]>([]);
  const [pendientes, setPendientes] = useState<PrestamoPendiente[]>([]);
  const [historial, setHistorial] = useState<HistorialMovimiento[]>([]);
  const [activos, setActivos] = useState<PlanillaActivo[]>([]);

  const [retirosOpen, setRetirosOpen] = useState(false);
  const [retiroTarget, setRetiroTarget] =
    useState<HerramientaDisponible | null>(null);
  const [retiroResponsable, setRetiroResponsable] = useState("");
  const [retiroDestino, setRetiroDestino] = useState("Taller");
  const [retiroCantidad, setRetiroCantidad] = useState("1");
  const [retiroError, setRetiroError] = useState<string | null>(null);
  const [savingRetiro, setSavingRetiro] = useState(false);

  const [devolverOpen, setDevolverOpen] = useState(false);
  const [devolverTarget, setDevolverTarget] =
    useState<PrestamoPendiente | null>(null);
  const [devolverCantidad, setDevolverCantidad] = useState("1");
  const [devolverError, setDevolverError] = useState<string | null>(null);
  const [savingDevolver, setSavingDevolver] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [dispRes, pendRes, histRes, planRes] = await Promise.all([
      supabase
        .from("herramientas")
        .select("id, codigo, descripcion, cantidad, ubicacion, responsable")
        .gt("cantidad", 0)
        .order("descripcion", { ascending: true }),
      supabase
        .from("prestamos_herramientas")
        .select(
          "id, herramienta_id, descripcion_herramienta, cantidad_prestada, cantidad_devuelta, responsable, destino, estado, fecha_hora_retiro, fecha_hora_devolucion_final"
        )
        .order("fecha_hora_retiro", { ascending: false }),
      supabase
        .from("historial_movimientos_herramientas")
        .select(
          "id, tipo_movimiento, descripcion_herramienta, cantidad, responsable, destino, fecha_hora"
        )
        .order("fecha_hora", { ascending: false }),
      supabase
        .from("planilla")
        .select("id, nombres, apellido_paterno, apellido_materno, estado")
        .eq("estado", "Activo")
        .order("nombres", { ascending: true }),
    ]);

    const firstError =
      dispRes.error || pendRes.error || histRes.error || planRes.error;
    if (firstError) {
      const message = formatSupabaseError(
        firstError,
        "No se pudieron cargar los datos de préstamos"
      );
      console.error("Error cargando préstamos de herramientas:", message, firstError);
      setError(message);
      setLoading(false);
      return;
    }

    const disponiblesMapped = ((dispRes.data as Record<string, unknown>[]) ?? [])
      .map(mapHerramienta)
      .filter(
        (item) => item.cantidad > 0 && isUbicacionAlmacen(item.ubicacion)
      );

    setDisponibles(disponiblesMapped);

    const mappedPendientes = ((pendRes.data as Record<string, unknown>[]) ?? [])
      .map((row) => {
        const prestado = Number(row.cantidad_prestada ?? 0);
        const devuelto = Number(row.cantidad_devuelta ?? 0);
        return {
          id: Number(row.id),
          herramienta_id:
            row.herramienta_id == null ? null : Number(row.herramienta_id),
          descripcion_herramienta: asText(row.descripcion_herramienta),
          cantidad_prestada: prestado,
          cantidad_devuelta: devuelto,
          responsable: asText(row.responsable),
          destino: asText(row.destino),
          estado: asText(row.estado),
          fecha_hora_retiro: asText(row.fecha_hora_retiro),
          fecha_hora_devolucion_final:
            asText(row.fecha_hora_devolucion_final) || null,
        } satisfies PrestamoPendiente;
      })
      .filter((p) => p.cantidad_prestada > p.cantidad_devuelta);

    setPendientes(mappedPendientes);

    setHistorial(
      ((histRes.data as Record<string, unknown>[]) ?? []).map((row) => ({
        id: Number(row.id),
        tipo_movimiento: asText(row.tipo_movimiento),
        descripcion_herramienta: asText(row.descripcion_herramienta),
        cantidad: Number(row.cantidad ?? 0),
        responsable: asText(row.responsable) || null,
        destino: asText(row.destino) || null,
        fecha_hora: asText(row.fecha_hora),
      }))
    );

    setActivos(
      ((planRes.data as Record<string, unknown>[]) ?? []).map((row) => ({
        id: Number(row.id),
        nombres: asText(row.nombres),
        apellido_paterno: asText(row.apellido_paterno),
        apellido_materno: asText(row.apellido_materno) || null,
      }))
    );

    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredDisponibles = useMemo(() => {
    const q = normalize(search);
    if (!q) return disponibles;
    return disponibles.filter((item) => {
      const haystack = normalize(`${item.codigo} ${item.descripcion}`);
      return haystack.includes(q);
    });
  }, [disponibles, search]);

  const filteredPendientes = useMemo(() => {
    const q = normalize(search);
    if (!q) return pendientes;
    return pendientes.filter((item) => {
      const haystack = normalize(
        [
          item.descripcion_herramienta,
          item.responsable,
          item.destino,
          item.estado,
        ].join(" ")
      );
      return haystack.includes(q);
    });
  }, [pendientes, search]);

  const filteredHistorial = useMemo(() => {
    const q = normalize(search);
    if (!q) return historial;
    return historial.filter((item) => {
      const haystack = normalize(
        [
          item.descripcion_herramienta,
          item.responsable ?? "",
          item.destino ?? "",
          item.tipo_movimiento,
        ].join(" ")
      );
      return haystack.includes(q);
    });
  }, [historial, search]);

  function openRetiro(item: HerramientaDisponible) {
    setRetiroTarget(item);
    setRetiroResponsable("");
    setRetiroDestino("Taller");
    setRetiroCantidad("1");
    setRetiroError(null);
    setRetirosOpen(true);
  }

  function closeRetiro() {
    if (savingRetiro) return;
    setRetirosOpen(false);
    setRetiroTarget(null);
    setRetiroError(null);
  }

  function openDevolver(item: PrestamoPendiente) {
    setDevolverTarget(item);
    setDevolverCantidad("1");
    setDevolverError(null);
    setDevolverOpen(true);
  }

  function closeDevolver() {
    if (savingDevolver) return;
    setDevolverOpen(false);
    setDevolverTarget(null);
    setDevolverError(null);
  }

  async function handleRetiroSubmit(e: FormEvent) {
    e.preventDefault();
    if (!retiroTarget) return;
    setRetiroError(null);

    const cantidad = Number(retiroCantidad);
    const responsable = retiroResponsable.trim();
    const destino = retiroDestino.trim() || "Taller";
    const descripcionHerramienta = herramientaLabel(retiroTarget);

    if (!responsable) {
      setRetiroError("Selecciona un responsable.");
      return;
    }
    if (
      !Number.isFinite(cantidad) ||
      cantidad <= 0 ||
      !Number.isInteger(cantidad)
    ) {
      setRetiroError("La cantidad debe ser un entero mayor a 0.");
      return;
    }
    if (cantidad > retiroTarget.cantidad) {
      setRetiroError(
        `No puedes retirar más de ${retiroTarget.cantidad} disponible(s).`
      );
      return;
    }

    setSavingRetiro(true);

    const ahora = new Date().toISOString();
    const { data: prestamo, error: prestamoError } = await supabase
      .from("prestamos_herramientas")
      .insert({
        herramienta_id: retiroTarget.id,
        descripcion_herramienta: descripcionHerramienta,
        cantidad_prestada: cantidad,
        cantidad_devuelta: 0,
        responsable,
        destino,
        estado: "PENDIENTE",
        fecha_hora_retiro: ahora,
      })
      .select("id")
      .single();

    if (prestamoError) {
      const message = formatSupabaseError(
        prestamoError,
        "No se pudo registrar el préstamo"
      );
      console.error("Error al registrar préstamo:", message, prestamoError);
      setRetiroError(message);
      setSavingRetiro(false);
      return;
    }

    const { error: historialError } = await supabase
      .from("historial_movimientos_herramientas")
      .insert({
        prestamo_id: prestamo?.id ?? null,
        herramienta_id: retiroTarget.id,
        descripcion_herramienta: descripcionHerramienta,
        tipo_movimiento: "RETIRO",
        cantidad,
        responsable,
        destino,
        fecha_hora: ahora,
      });

    if (historialError) {
      const message = formatSupabaseError(
        historialError,
        "No se pudo registrar el historial de retiro"
      );
      console.error("Error al registrar historial de retiro:", message, historialError);
      setRetiroError(message);
      setSavingRetiro(false);
      return;
    }

    const nuevaCantidad = retiroTarget.cantidad - cantidad;
    const { error: stockError } = await supabase
      .from("herramientas")
      .update({ cantidad: nuevaCantidad })
      .eq("id", retiroTarget.id);

    if (stockError) {
      const message = formatSupabaseError(
        stockError,
        "No se pudo actualizar el stock"
      );
      console.error("Error al actualizar stock:", message, stockError);
      setRetiroError(message);
      setSavingRetiro(false);
      return;
    }

    setSavingRetiro(false);
    setRetirosOpen(false);
    setRetiroTarget(null);
    await loadData();
  }

  async function handleDevolverSubmit(e: FormEvent) {
    e.preventDefault();
    if (!devolverTarget) return;
    setDevolverError(null);

    const faltan =
      devolverTarget.cantidad_prestada - devolverTarget.cantidad_devuelta;
    const cantidad = Number(devolverCantidad);

    if (
      !Number.isFinite(cantidad) ||
      cantidad <= 0 ||
      !Number.isInteger(cantidad)
    ) {
      setDevolverError("La cantidad debe ser un entero mayor a 0.");
      return;
    }
    if (cantidad > faltan) {
      setDevolverError(`No puedes devolver más de ${faltan} pendiente(s).`);
      return;
    }

    setSavingDevolver(true);

    const nuevaDevuelta = devolverTarget.cantidad_devuelta + cantidad;
    const completo = nuevaDevuelta >= devolverTarget.cantidad_prestada;
    const ahora = new Date().toISOString();

    const updatePayload: Record<string, unknown> = {
      cantidad_devuelta: nuevaDevuelta,
      estado: completo ? "DEVUELTO" : "PARCIAL",
    };
    if (completo) {
      updatePayload.fecha_hora_devolucion_final = ahora;
    }

    const { error: updateError } = await supabase
      .from("prestamos_herramientas")
      .update(updatePayload)
      .eq("id", devolverTarget.id)
      .select("id")
      .single();

    if (updateError) {
      const message = formatSupabaseError(
        updateError,
        "No se pudo actualizar el préstamo"
      );
      console.error("Error al actualizar préstamo:", message, updateError);
      setDevolverError(message);
      setSavingDevolver(false);
      return;
    }

    const { error: historialError } = await supabase
      .from("historial_movimientos_herramientas")
      .insert({
        prestamo_id: devolverTarget.id,
        herramienta_id: devolverTarget.herramienta_id,
        descripcion_herramienta: devolverTarget.descripcion_herramienta,
        tipo_movimiento: "DEVOLUCION",
        cantidad,
        responsable: devolverTarget.responsable,
        destino: devolverTarget.destino,
        fecha_hora: ahora,
      });

    if (historialError) {
      const message = formatSupabaseError(
        historialError,
        "No se pudo registrar el historial de devolución"
      );
      console.error(
        "Error al registrar historial de devolución:",
        message,
        historialError
      );
      setDevolverError(message);
      setSavingDevolver(false);
      return;
    }

    if (devolverTarget.herramienta_id != null) {
      const { data: herramientaActual, error: fetchStockError } = await supabase
        .from("herramientas")
        .select("id, cantidad")
        .eq("id", devolverTarget.herramienta_id)
        .single();

      if (fetchStockError) {
        const message = formatSupabaseError(
          fetchStockError,
          "No se pudo leer el stock de la herramienta"
        );
        console.error("Error al leer stock:", message, fetchStockError);
        setDevolverError(message);
        setSavingDevolver(false);
        return;
      }

      const stockActual = Number(herramientaActual?.cantidad ?? 0);
      const { error: stockError } = await supabase
        .from("herramientas")
        .update({ cantidad: stockActual + cantidad })
        .eq("id", devolverTarget.herramienta_id);

      if (stockError) {
        const message = formatSupabaseError(
          stockError,
          "No se pudo devolver el stock"
        );
        console.error("Error al devolver stock:", message, stockError);
        setDevolverError(message);
        setSavingDevolver(false);
        return;
      }
    }

    setSavingDevolver(false);
    setDevolverOpen(false);
    setDevolverTarget(null);
    await loadData();
  }

  const subTabs = [
    { id: "disponibles" as const, label: "Disponibles", icon: PackageCheck },
    { id: "pendientes" as const, label: "Pendientes", icon: ArrowLeftRight },
    { id: "historial" as const, label: "Historial", icon: Clock3 },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Herramientas</h2>
          <p className="mt-1 text-sm text-muted">
            Control de retiros, devoluciones y movimientos del almacén.
          </p>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Subsecciones de herramientas"
        className="flex flex-wrap gap-2 rounded-xl border border-border bg-slate-50/80 p-1.5"
      >
        {subTabs.map((item) => {
          const selected = subTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setSubTab(item.id)}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition sm:flex-none sm:px-4 ${
                selected
                  ? "bg-white text-accent shadow-sm"
                  : "text-slate-500 hover:bg-white/70 hover:text-slate-700"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {item.label}
            </button>
          );
        })}
      </div>

      <label className="relative block max-w-xl">
        <span className="sr-only">Buscar</span>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar herramienta, responsable o destino…"
          className="w-full rounded-xl border border-border bg-white py-2.5 pl-10 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </label>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="overflow-x-auto">
          {subTab === "disponibles" ? (
            <table className="min-w-full divide-y divide-border text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Código</th>
                  <th className="px-4 py-3">Descripción</th>
                  <th className="px-4 py-3 text-right">Disponible</th>
                  <th className="px-4 py-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-muted">
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-accent" />
                        Cargando disponibles…
                      </span>
                    </td>
                  </tr>
                ) : filteredDisponibles.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-muted">
                      No hay herramientas disponibles en Almacén.
                    </td>
                  </tr>
                ) : (
                  filteredDisponibles.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/80">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-accent">
                        {item.codigo}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {item.descripcion}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700">
                        {item.cantidad}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openRetiro(item)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-700"
                        >
                          Retirar
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : null}

          {subTab === "pendientes" ? (
            <table className="min-w-full divide-y divide-border text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Herramienta</th>
                  <th className="px-4 py-3 text-right">Prestado</th>
                  <th className="px-4 py-3 text-right">Devuelto</th>
                  <th className="px-4 py-3 text-right">Faltan</th>
                  <th className="px-4 py-3">Responsable</th>
                  <th className="px-4 py-3">Destino</th>
                  <th className="px-4 py-3">Fecha/Hora retiro</th>
                  <th className="px-4 py-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-muted">
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-accent" />
                        Cargando pendientes…
                      </span>
                    </td>
                  </tr>
                ) : filteredPendientes.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-muted">
                      No hay préstamos pendientes.
                    </td>
                  </tr>
                ) : (
                  filteredPendientes.map((item) => {
                    const faltan =
                      item.cantidad_prestada - item.cantidad_devuelta;
                    return (
                      <tr key={item.id} className="hover:bg-slate-50/80">
                        <td className="px-4 py-3 font-medium text-foreground">
                          {item.descripcion_herramienta || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                          {item.cantidad_prestada}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                          {item.cantidad_devuelta}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-amber-700">
                          {faltan}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                          {item.responsable || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                          {item.destino || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                          {formatDateTime(item.fecha_hora_retiro)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => openDevolver(item)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                          >
                            <Undo2 className="h-3.5 w-3.5" aria-hidden />
                            Devolver
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          ) : null}

          {subTab === "historial" ? (
            <table className="min-w-full divide-y divide-border text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Fecha/Hora</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Herramienta</th>
                  <th className="px-4 py-3 text-right">Cantidad</th>
                  <th className="px-4 py-3">Responsable</th>
                  <th className="px-4 py-3">Destino</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted">
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-accent" />
                        Cargando historial…
                      </span>
                    </td>
                  </tr>
                ) : filteredHistorial.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted">
                      Aún no hay movimientos registrados.
                    </td>
                  </tr>
                ) : (
                  filteredHistorial.map((item) => {
                    const isRetiro = normalize(item.tipo_movimiento).includes(
                      "retiro"
                    );
                    return (
                      <tr key={item.id} className="hover:bg-slate-50/80">
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                          {formatDateTime(item.fecha_hora)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                              isRetiro
                                ? "bg-amber-100 text-amber-800 ring-amber-600/20"
                                : "bg-emerald-100 text-emerald-800 ring-emerald-600/20"
                            }`}
                          >
                            {isRetiro ? "Retirado" : "Devuelto"}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground">
                          {item.descripcion_herramienta || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                          {item.cantidad}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                          {item.responsable || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                          {item.destino || "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>

      {retirosOpen && retiroTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="retiro-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeRetiro();
          }}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-border bg-amber-50/70 px-5 py-4">
              <h3
                id="retiro-modal-title"
                className="text-base font-bold text-foreground"
              >
                Retirar herramienta
              </h3>
              <button
                type="button"
                onClick={closeRetiro}
                disabled={savingRetiro}
                className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white disabled:opacity-50"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleRetiroSubmit(e)}
              className="space-y-4 p-5"
            >
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Herramienta
                </span>
                <input
                  readOnly
                  value={herramientaLabel(retiroTarget)}
                  className="w-full rounded-xl border border-border bg-slate-50 px-3 py-2.5 text-sm text-slate-700"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Responsable
                </span>
                <select
                  required
                  value={retiroResponsable}
                  onChange={(e) => setRetiroResponsable(e.target.value)}
                  className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                >
                  <option value="">Seleccionar responsable…</option>
                  {activos.map((persona) => {
                    const nombre = fullName(persona);
                    return (
                      <option key={persona.id} value={nombre}>
                        {nombre}
                      </option>
                    );
                  })}
                </select>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Destino
                  </span>
                  <input
                    value={retiroDestino}
                    onChange={(e) => setRetiroDestino(e.target.value)}
                    className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                    placeholder="Taller"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Cantidad
                  </span>
                  <input
                    required
                    type="number"
                    min={1}
                    max={retiroTarget.cantidad}
                    step={1}
                    value={retiroCantidad}
                    onChange={(e) => setRetiroCantidad(e.target.value)}
                    className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Disponible: {retiroTarget.cantidad}
                  </p>
                </label>
              </div>

              {retiroError ? (
                <p
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {retiroError}
                </p>
              ) : null}

              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeRetiro}
                  disabled={savingRetiro}
                  className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingRetiro}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-amber-700 disabled:opacity-50"
                >
                  {savingRetiro ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Registrando…
                    </>
                  ) : (
                    "Confirmar retiro"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {devolverOpen && devolverTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="devolver-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDevolver();
          }}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-border bg-emerald-50/70 px-5 py-4">
              <h3
                id="devolver-modal-title"
                className="text-base font-bold text-foreground"
              >
                Devolver herramienta
              </h3>
              <button
                type="button"
                onClick={closeDevolver}
                disabled={savingDevolver}
                className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white disabled:opacity-50"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleDevolverSubmit(e)}
              className="space-y-4 p-5"
            >
              <div className="rounded-xl border border-border bg-slate-50 px-4 py-3 text-sm">
                <p className="font-semibold text-foreground">
                  {devolverTarget.descripcion_herramienta || "—"}
                </p>
                <p className="mt-1 text-slate-600">
                  Responsable: {devolverTarget.responsable || "—"} · Destino:{" "}
                  {devolverTarget.destino || "—"}
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-white px-2 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">
                      Prestado
                    </p>
                    <p className="text-base font-bold tabular-nums">
                      {devolverTarget.cantidad_prestada}
                    </p>
                  </div>
                  <div className="rounded-lg bg-white px-2 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">
                      Devuelto
                    </p>
                    <p className="text-base font-bold tabular-nums">
                      {devolverTarget.cantidad_devuelta}
                    </p>
                  </div>
                  <div className="rounded-lg bg-white px-2 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">
                      Faltan
                    </p>
                    <p className="text-base font-bold tabular-nums text-amber-700">
                      {devolverTarget.cantidad_prestada -
                        devolverTarget.cantidad_devuelta}
                    </p>
                  </div>
                </div>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Cantidad a devolver
                </span>
                <input
                  required
                  type="number"
                  min={1}
                  max={
                    devolverTarget.cantidad_prestada -
                    devolverTarget.cantidad_devuelta
                  }
                  step={1}
                  value={devolverCantidad}
                  onChange={(e) => setDevolverCantidad(e.target.value)}
                  className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
              </label>

              {devolverError ? (
                <p
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {devolverError}
                </p>
              ) : null}

              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeDevolver}
                  disabled={savingDevolver}
                  className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingDevolver}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {savingDevolver ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Guardando…
                    </>
                  ) : (
                    "Confirmar devolución"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
