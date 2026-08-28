export type AdminApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

export async function adminFetch<T>(
  url: string,
  init?: RequestInit
): Promise<AdminApiResult<T>> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, {
    ...init,
    credentials: "include",
    headers,
  });

  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    data?: T;
  };

  if (!res.ok || json.success === false) {
    return {
      ok: false,
      status: res.status,
      error: json.error || "No se pudo completar la operación.",
    };
  }

  return { ok: true, status: res.status, data: json.data as T };
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-PE", {
    dateStyle: "short",
    timeStyle: "short",
  });
}
