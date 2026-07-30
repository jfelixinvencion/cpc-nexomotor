"use client";

import { FormEvent, type ReactNode, useEffect, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Boxes,
  Car,
  ClipboardList,
  FolderCog,
  LogOut,
  Package,
  Settings,
  Shield,
  Users,
  Wrench,
} from "lucide-react";
import HerramientasDashboard from "@/components/HerramientasDashboard";
import PlanillaDashboard from "@/components/PlanillaDashboard";

type View = "landing" | "login" | "dashboard" | "warehouse" | "administracion";
type WarehouseTab = "herramientas" | "consumibles";
type AdminTab = "planilla" | "herramientas";
type ActiveAreaId = "almacen" | "administracion";

const SESSION_KEY = "nexo_session";
const VIEW_KEY = "nexo_view";

const PERSISTABLE_VIEWS: View[] = [
  "dashboard",
  "warehouse",
  "administracion",
];

type NexoSession = {
  user: string;
  loggedIn: boolean;
  timestamp: number;
};

function isPersistableView(value: string | null): value is View {
  return value !== null && PERSISTABLE_VIEWS.includes(value as View);
}

function readSession(): NexoSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NexoSession;
    if (parsed && parsed.loggedIn === true) return parsed;
    return null;
  } catch {
    return null;
  }
}

function writeSession() {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      user: "Admin",
      loggedIn: true,
      timestamp: Date.now(),
    } satisfies NexoSession)
  );
}

function writeView(currentView: View) {
  if (typeof window === "undefined") return;
  if (!isPersistableView(currentView)) return;
  localStorage.setItem(VIEW_KEY, currentView);
}

function clearSessionStorage() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(VIEW_KEY);
}

const MOCK_USER = "Admin";
const MOCK_PASSWORD = "NexoMotor";

const areaBlocks = [
  {
    id: "almacen",
    title: "ALMACÉN",
    description: "Herramientas, consumibles e inventario del taller.",
    icon: Boxes,
    active: true,
    iconBg: "bg-white/20",
    cardClass:
      "border-accent/20 bg-gradient-to-br from-accent to-accent-dark text-white shadow-lg shadow-accent/25 hover:-translate-y-1 hover:shadow-xl",
    descriptionClass: "text-blue-100",
    ctaClass: "text-blue-100",
  },
  {
    id: "administracion",
    title: "ADMINISTRACIÓN",
    description: "Registros de apoyo, planillas y catálogos internos.",
    icon: FolderCog,
    active: true,
    iconBg: "bg-white/20",
    cardClass:
      "border-emerald-500/20 bg-gradient-to-br from-emerald-600 to-emerald-800 text-white shadow-lg shadow-emerald-600/25 hover:-translate-y-1 hover:shadow-xl",
    descriptionClass: "text-emerald-100",
    ctaClass: "text-emerald-100",
  },
  {
    id: "operaciones",
    title: "OPERACIONES",
    description: "Órdenes de trabajo y seguimiento de servicios.",
    icon: ClipboardList,
    active: false,
    iconBg: "bg-slate-200/70",
    cardClass: "",
    descriptionClass: "text-slate-500",
    ctaClass: "",
  },
  {
    id: "clientes",
    title: "CLIENTES",
    description: "Base de clientes y historial de vehículos.",
    icon: Users,
    active: false,
    iconBg: "bg-slate-200/70",
    cardClass: "",
    descriptionClass: "text-slate-500",
    ctaClass: "",
  },
  {
    id: "configuracion",
    title: "CONFIGURACIÓN",
    description: "Preferencias del sistema y accesos.",
    icon: Settings,
    active: false,
    iconBg: "bg-slate-200/70",
    cardClass: "",
    descriptionClass: "text-slate-500",
    ctaClass: "",
  },
] as const;

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent shadow-md shadow-accent/25">
        <Car className="h-5 w-5 text-white" strokeWidth={2.25} aria-hidden />
        <Wrench
          className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-accent-light p-0.5 text-white shadow-sm"
          strokeWidth={2.5}
          aria-hidden
        />
      </div>
      <div className={compact ? "hidden sm:block" : "block"}>
        <p className="text-base font-bold leading-tight tracking-tight text-foreground sm:text-lg">
          Nexo Motor
        </p>
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted">
          Taller &amp; Almacén
        </p>
      </div>
    </div>
  );
}

function AppShell({
  children,
  onLogin,
  onLogout,
  isAuthenticated,
  showBack,
  onBack,
  backLabel,
}: {
  children: ReactNode;
  onLogin?: () => void;
  onLogout?: () => void;
  isAuthenticated: boolean;
  showBack?: boolean;
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_10%_-10%,rgba(30,58,138,0.14),transparent),radial-gradient(ellipse_60%_50%_at_90%_0%,rgba(59,130,246,0.12),transparent),radial-gradient(ellipse_50%_40%_at_50%_100%,rgba(148,163,184,0.18),transparent)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(rgba(148,163,184,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.12)_1px,transparent_1px)] [background-size:28px_28px]"
        aria-hidden
      />

      <header className="relative z-10 border-b border-border/80 bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            {showBack && onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">{backLabel ?? "Volver"}</span>
              </button>
            ) : null}
            <Logo compact />
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {isAuthenticated ? (
              <>
                <span className="hidden items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent sm:inline-flex">
                  <Shield className="h-3.5 w-3.5" aria-hidden />
                  {MOCK_USER}
                </span>
                <button
                  type="button"
                  onClick={onLogout}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <LogOut className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">Salir</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onLogin}
                className="inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-accent/25 transition hover:bg-accent-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Iniciar Sesión
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10">{children}</main>
    </div>
  );
}

function LandingView({ onLogin }: { onLogin: () => void }) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-20 lg:py-24">
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
        <div className="order-2 text-center lg:order-1 lg:text-left">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/15 bg-accent/5 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent">
            <Wrench className="h-3.5 w-3.5" aria-hidden />
            Taller profesional
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            Nexo Motor
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
            Mantenimiento preventivo y correctivo de autos ligeros. Gestiona tu
            taller, almacén y operaciones desde un centro de mandos claro y
            ágil.
          </p>
          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row lg:justify-start">
            <button
              type="button"
              onClick={onLogin}
              className="inline-flex items-center justify-center rounded-xl bg-accent px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-accent/30 transition hover:bg-accent-dark hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Iniciar Sesión
            </button>
            <a
              href="#servicios"
              className="inline-flex items-center justify-center rounded-xl border border-border bg-surface px-6 py-3.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Conocer más
            </a>
          </div>
        </div>

        <div className="order-1 flex justify-center lg:order-2">
          <div className="relative w-full max-w-md">
            <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-accent/20 via-accent-light/15 to-slate-200/40 blur-2xl" aria-hidden />
            <div className="relative overflow-hidden rounded-3xl border border-white/70 bg-surface/90 p-8 shadow-xl shadow-slate-300/40 backdrop-blur sm:p-10">
              <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-3xl bg-gradient-to-br from-accent to-accent-light shadow-lg shadow-accent/30 sm:h-32 sm:w-32">
                <Car className="h-14 w-14 text-white sm:h-16 sm:w-16" strokeWidth={1.5} aria-hidden />
              </div>
              <div className="mt-8 grid grid-cols-3 gap-3">
                {[
                  { icon: Wrench, label: "Taller" },
                  { icon: Package, label: "Stock" },
                  { icon: Shield, label: "Calidad" },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex flex-col items-center gap-2 rounded-2xl bg-slate-50 px-2 py-4 transition hover:bg-accent/5"
                  >
                    <item.icon className="h-5 w-5 text-accent" aria-hidden />
                    <span className="text-xs font-semibold text-slate-600">
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div id="servicios" className="mt-16 grid gap-4 sm:grid-cols-3 sm:gap-5">
        {[
          {
            title: "Preventivo",
            text: "Programación clara de servicios para evitar fallas costosas.",
          },
          {
            title: "Correctivo",
            text: "Diagnóstico y reparación con control de piezas y tiempos.",
          },
          {
            title: "Almacén",
            text: "Herramientas y consumibles organizados para el día a día.",
          },
        ].map((item) => (
          <article
            key={item.title}
            className="rounded-2xl border border-border/80 bg-surface/90 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <h2 className="text-sm font-bold uppercase tracking-wide text-accent">
              {item.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              {item.text}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function LoginView({
  onSuccess,
  onCancel,
}: {
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (username.trim() === MOCK_USER && password === MOCK_PASSWORD) {
      setError("");
      onSuccess();
      return;
    }
    setError("Usuario o contraseña incorrectos.");
    setShake(true);
    window.setTimeout(() => setShake(false), 450);
  }

  return (
    <section className="mx-auto flex max-w-6xl items-center justify-center px-4 py-12 sm:px-6 sm:py-20">
      <div
        className={`w-full max-w-md rounded-3xl border border-border/80 bg-surface p-6 shadow-xl shadow-slate-300/40 transition sm:p-8 ${
          shake ? "animate-shake" : ""
        }`}
      >
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-white shadow-md shadow-accent/30">
            <Shield className="h-7 w-7" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Acceso al sistema
          </h1>
          <p className="mt-2 text-sm text-muted">
            Ingresa con tus credenciales de administrador.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="username"
              className="mb-1.5 block text-sm font-semibold text-slate-700"
            >
              Usuario
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-xl border border-border bg-slate-50 px-4 py-3 text-sm text-foreground outline-none transition focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20"
              placeholder="Admin"
              required
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-sm font-semibold text-slate-700"
            >
              Contraseña
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-border bg-slate-50 px-4 py-3 text-sm text-foreground outline-none transition focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20"
              placeholder="••••••••"
              required
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="w-full rounded-xl bg-accent px-4 py-3.5 text-sm font-semibold text-white shadow-md shadow-accent/25 transition hover:bg-accent-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Entrar al panel
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Volver al inicio
          </button>
        </form>
      </div>
    </section>
  );
}

function DashboardView({
  onOpenArea,
}: {
  onOpenArea: (areaId: ActiveAreaId) => void;
}) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-8 sm:mb-10">
        <p className="text-sm font-semibold uppercase tracking-wide text-accent">
          Centro de mandos
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Panel principal
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted sm:text-base">
          Selecciona un área para continuar. Almacén y Administración están
          listos para operar.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {areaBlocks.map((area) => {
          const Icon = area.icon;
          const isActive = area.active;

          return (
            <button
              key={area.id}
              type="button"
              disabled={!isActive}
              onClick={
                isActive
                  ? () => onOpenArea(area.id as ActiveAreaId)
                  : undefined
              }
              className={`group rounded-2xl border p-5 text-left shadow-sm transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                isActive
                  ? area.cardClass
                  : "cursor-not-allowed border-border/80 bg-surface text-slate-500 opacity-80"
              }`}
            >
              <div
                className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl ${area.iconBg} transition group-hover:scale-105`}
              >
                <Icon
                  className={`h-6 w-6 ${isActive ? "text-white" : "text-slate-500"}`}
                  aria-hidden
                />
              </div>
              <h2 className="text-base font-bold tracking-wide">{area.title}</h2>
              <p
                className={`mt-2 text-sm leading-relaxed ${area.descriptionClass}`}
              >
                {area.description}
              </p>
              {isActive ? (
                <span
                  className={`mt-4 inline-flex text-xs font-semibold uppercase tracking-wide ${area.ctaClass}`}
                >
                  Abrir módulo →
                </span>
              ) : (
                <span className="mt-4 inline-flex rounded-full bg-slate-200/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Próximamente
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function WarehouseView() {
  const [tab, setTab] = useState<WarehouseTab>("herramientas");

  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-6 sm:mb-8">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent">
          <Boxes className="h-3.5 w-3.5" aria-hidden />
          Módulo activo
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Almacén
        </h1>
        <p className="mt-2 text-sm text-muted sm:text-base">
          Espacios preparados para el ingreso de herramientas y consumibles.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-lg shadow-slate-200/60">
        <div
          role="tablist"
          aria-label="Secciones de almacén"
          className="flex border-b border-border bg-slate-50/80"
        >
          {(
            [
              { id: "herramientas", label: "Herramientas", icon: Wrench },
              { id: "consumibles", label: "Consumibles", icon: Package },
            ] as const
          ).map((item) => {
            const selected = tab === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setTab(item.id)}
                className={`relative flex flex-1 items-center justify-center gap-2 px-3 py-3.5 text-sm font-semibold transition sm:px-6 ${
                  selected
                    ? "bg-surface text-accent"
                    : "text-slate-500 hover:bg-white/70 hover:text-slate-700"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span className="truncate">{item.label}</span>
                {selected ? (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />
                ) : null}
              </button>
            );
          })}
        </div>

        <div role="tabpanel" className="p-5 sm:p-8">
          {tab === "herramientas" ? (
            <div className="rounded-2xl border border-dashed border-accent/30 bg-accent/[0.03] p-6 sm:p-10">
              <div className="mx-auto flex max-w-lg flex-col items-center text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                  <Wrench className="h-7 w-7" aria-hidden />
                </div>
                <h2 className="text-lg font-bold text-foreground">
                  Herramientas
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Aquí se desarrollarán los formularios de ingreso, catálogo y
                  control de herramientas del taller.
                </p>
                <div className="mt-6 w-full rounded-xl border border-border bg-surface px-4 py-8 text-sm text-slate-500 shadow-sm">
                  Espacio reservado — formularios próximamente
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-6 sm:p-10">
              <div className="mx-auto flex max-w-lg flex-col items-center text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-200/80 text-slate-600">
                  <Package className="h-7 w-7" aria-hidden />
                </div>
                <h2 className="text-lg font-bold text-foreground">
                  Consumibles
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Espacio independiente para el registro y seguimiento de
                  consumibles del almacén.
                </p>
                <div className="mt-6 w-full rounded-xl border border-border bg-surface px-4 py-8 text-sm text-slate-500 shadow-sm">
                  Espacio reservado — formularios próximamente
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function AdministracionView({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<AdminTab>("planilla");

  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-6 sm:mb-8">
        <nav
          aria-label="Breadcrumb"
          className="mb-3 flex flex-wrap items-center gap-1.5 text-sm text-muted"
        >
          <button
            type="button"
            onClick={onBack}
            className="font-medium text-slate-600 transition hover:text-emerald-700"
          >
            Dashboard
          </button>
          <span aria-hidden className="text-slate-400">
            /
          </span>
          <span className="font-semibold text-emerald-700">Administración</span>
        </nav>

        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-emerald-600/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
          <FolderCog className="h-3.5 w-3.5" aria-hidden />
          Módulo activo
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Administración
        </h1>
        <p className="mt-2 text-sm text-muted sm:text-base">
          Registros de apoyo, planillas y catálogos internos del taller.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-lg shadow-slate-200/60">
        <div
          role="tablist"
          aria-label="Secciones de administración"
          className="flex border-b border-border bg-slate-50/80"
        >
          {(
            [
              { id: "planilla", label: "PLANILLA", icon: BookOpen },
              { id: "herramientas", label: "HERRAMIENTAS", icon: Wrench },
            ] as const
          ).map((item) => {
            const selected = tab === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setTab(item.id)}
                className={`relative flex flex-1 items-center justify-center gap-2 px-3 py-3.5 text-sm font-semibold transition sm:px-6 ${
                  selected
                    ? "bg-surface text-emerald-700"
                    : "text-slate-500 hover:bg-white/70 hover:text-slate-700"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span className="truncate">{item.label}</span>
                {selected ? (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 bg-emerald-600" />
                ) : null}
              </button>
            );
          })}
        </div>

        <div role="tabpanel" className="p-5 sm:p-8">
          {tab === "planilla" ? (
            <PlanillaDashboard />
          ) : (
            <HerramientasDashboard />
          )}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("landing");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    const session = readSession();
    if (session?.loggedIn) {
      setIsAuthenticated(true);
      const savedView =
        typeof window !== "undefined" ? localStorage.getItem(VIEW_KEY) : null;
      setView(isPersistableView(savedView) ? savedView : "dashboard");
    }
    setSessionReady(true);
  }, []);

  useEffect(() => {
    if (!sessionReady || !isAuthenticated) return;
    writeView(view);
  }, [view, isAuthenticated, sessionReady]);

  function goLogin() {
    setView("login");
  }

  function handleLoginSuccess() {
    writeSession();
    setIsAuthenticated(true);
    setView("dashboard");
    writeView("dashboard");
  }

  function handleLogout() {
    clearSessionStorage();
    setIsAuthenticated(false);
    setView("login");
  }

  function handleOpenArea(areaId: ActiveAreaId) {
    if (areaId === "almacen") {
      setView("warehouse");
      return;
    }
    setView("administracion");
  }

  function handleBack() {
    if (view === "warehouse" || view === "administracion") {
      setView("dashboard");
      return;
    }
    if (view === "login") {
      setView("landing");
    }
  }

  const showBack =
    view === "warehouse" || view === "administracion" || view === "login";
  const backLabel =
    view === "warehouse" || view === "administracion" ? "Panel" : "Inicio";

  if (!sessionReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted">
        Cargando…
      </div>
    );
  }

  return (
    <AppShell
      isAuthenticated={isAuthenticated}
      onLogin={goLogin}
      onLogout={handleLogout}
      showBack={showBack}
      onBack={handleBack}
      backLabel={backLabel}
    >
      {view === "landing" && <LandingView onLogin={goLogin} />}
      {view === "login" && (
        <LoginView
          onSuccess={handleLoginSuccess}
          onCancel={() => setView("landing")}
        />
      )}
      {view === "dashboard" && isAuthenticated && (
        <DashboardView onOpenArea={handleOpenArea} />
      )}
      {view === "warehouse" && isAuthenticated && <WarehouseView />}
      {view === "administracion" && isAuthenticated && (
        <AdministracionView onBack={() => setView("dashboard")} />
      )}
    </AppShell>
  );
}
