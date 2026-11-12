import type { IncomingHttpHeaders } from "node:http";

export const SESSION_COOKIE = "ops_session";

export const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "cache-control": "no-store",
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
};

const ALLOWED_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);

function hostnameOf(value: string): string | undefined {
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

// Rejecting other Host names blocks DNS rebinding: a hostile site resolving its own name to 127.0.0.1.
export function isAllowedHost(host: string | undefined): boolean {
  const hostname = host ? hostnameOf(`http://${host}`) : undefined;
  return hostname !== undefined && ALLOWED_HOSTNAMES.has(hostname);
}

// The whole origin must match, port included: SameSite treats other local sites (e.g. localhost:80) as the
// same site and would still send the cookie.
export function isSameOriginPost(headers: IncomingHttpHeaders): boolean {
  if (headers["sec-fetch-site"] === "same-origin") return true;
  const { origin, host } = headers;
  return typeof origin === "string" && typeof host === "string" && origin.toLowerCase() === `http://${host.toLowerCase()}`;
}

export function safeReturnPath(value: unknown): string {
  const fallback = "/ringkasan";
  if (typeof value !== "string" || !value.startsWith("/") || /[\u0000-\u001f\\]/.test(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, "http://local");
  } catch {
    return fallback;
  }
  // Checked after normalizing: "/.//evil.com" becomes "//evil.com", which browsers read as another site.
  if (url.origin !== "http://local" || url.pathname.startsWith("//")) return fallback;
  return `${url.pathname}${url.search}`;
}
