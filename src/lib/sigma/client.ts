import { getStoredToken, setStoredToken } from "./token";

function maskToken(token: string): string {
  if (token.length <= 10) return "***";
  return `Bearer ${token.slice(0, 6)}…${token.slice(-4)}`;
}

function redactFileUrl(fileUrl: unknown): unknown {
  if (typeof fileUrl !== "string") return fileUrl;
  try {
    const u = new URL(fileUrl);
    return `${u.origin}${u.pathname}?[REDACTED_SIGNED_QUERY]`;
  } catch {
    return "[REDACTED_FILE_URL]";
  }
}

export type SigmaReportFetchResult = {
  fileUrl: string;
  requestUrl: string;
  requestHeadersLogged: Record<string, string>;
  /** Full Sigma JSON with signed fileUrl query redacted for safe logging */
  responseLogged: unknown;
};

export async function sigmaLogin(): Promise<string> {
  const res = await fetch(process.env.SIGMA_LOGIN_URL!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tenant-id": process.env.SIGMA_TENANT_ID!,
    },
    body: JSON.stringify({
      username: process.env.SIGMA_USERNAME,
      password: process.env.SIGMA_PASSWORD,
    }),
  });

  if (!res.ok) {
    throw new Error(`Sigma error ${res.status}: ${await res.text()}`);
  }

  const response = await res.json();
  const accessToken = response.data.access_token as string | undefined;
  const refreshToken = response.data.refresh_token as string | undefined;

  if (!accessToken) {
    throw new Error("No access_token in Sigma login response");
  }

  await setStoredToken(accessToken, refreshToken);
  return accessToken;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} no está definido en las variables de entorno`);
  }
  return value;
}

/**
 * Builds:
 * .../spare-stocks?companyId=...&storeId=...&month=MM&year=YYYY
 * month/year are always taken from the system clock.
 */
export function buildSigmaReportUrl(now = new Date()): URL {
  const companyId = requireEnv("SIGMA_COMPANY_ID");
  const storeId = requireEnv("SIGMA_STORE_ID");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = String(now.getFullYear());

  const url = new URL(requireEnv("SIGMA_REPORT_URL"));
  url.searchParams.set("companyId", companyId);
  url.searchParams.set("storeId", storeId);
  url.searchParams.set("month", month);
  url.searchParams.set("year", year);

  return url;
}

export async function getSigmaReport(): Promise<SigmaReportFetchResult> {
  const token = await getStoredToken();
  if (!token) {
    throw new Error("No stored Sigma token");
  }

  const url = buildSigmaReportUrl();
  console.log("[sigma] report request URL:", url.toString());

  const requestHeaders = {
    Authorization: `Bearer ${token}`,
    "x-tenant-id": process.env.SIGMA_TENANT_ID!,
  };

  const requestHeadersLogged = {
    Authorization: maskToken(token),
    "x-tenant-id": process.env.SIGMA_TENANT_ID!,
  };

  const res = await fetch(url.toString(), { headers: requestHeaders });
  if (!res.ok) {
    throw new Error(`Sigma error ${res.status}: ${await res.text()}`);
  }

  const response = await res.json();
  const fileUrl = response.data?.fileUrl as string | undefined;
  if (!fileUrl) {
    throw new Error(
      `No fileUrl in Sigma report response: ${JSON.stringify(response)}`
    );
  }

  const responseLogged = structuredClone(response) as {
    data?: { fileUrl?: unknown };
  };
  if (responseLogged?.data?.fileUrl) {
    responseLogged.data.fileUrl = redactFileUrl(responseLogged.data.fileUrl);
  }

  return {
    fileUrl,
    requestUrl: url.toString(),
    requestHeadersLogged,
    responseLogged,
  };
}
