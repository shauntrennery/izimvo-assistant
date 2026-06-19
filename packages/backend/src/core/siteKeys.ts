import { type Result, ok, err } from "./result.js";

/**
 * Domain binding (Guardrail §11.2). Every minted session must prove it
 * originates from a hostname the site-key explicitly allows. Exact hostname
 * match — no suffix/wildcard matching, no port, no scheme.
 */

export interface Site {
  id: string;
  status: "active" | "suspended";
  catalogMode: "global" | "storefront";
  defaultLocale: string;
  defaultVoiceId: string | null;
}

export interface ApiKey {
  id: string;
  siteId: string;
  publicKey: string;
  allowedDomains: string[];
  rateLimitRpm: number;
  revokedAt: Date | null;
}

export type SiteKeyError =
  | { kind: "unknown_key" }
  | { kind: "revoked_key" }
  | { kind: "site_suspended" }
  | { kind: "origin_missing" }
  | { kind: "origin_forbidden"; hostname: string };

/**
 * Extract the hostname from an Origin or Referer header value. Returns null if
 * neither yields a parseable hostname. Origin is preferred; Referer is the
 * fallback some browsers send instead.
 */
export function hostnameFromHeaders(headers: {
  origin?: string | null;
  referer?: string | null;
}): string | null {
  for (const raw of [headers.origin, headers.referer]) {
    if (!raw) continue;
    try {
      return new URL(raw).hostname.toLowerCase();
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * Validate a site-key + request origin pair. The key must exist, be live, and
 * belong to an active site; the request hostname must be an exact member of the
 * key's allowed_domains. Returns the bound {site, apiKey, hostname} on success.
 */
export function bindRequest(input: {
  apiKey: ApiKey | null;
  site: Site | null;
  hostname: string | null;
}): Result<{ apiKey: ApiKey; site: Site; hostname: string }, SiteKeyError> {
  const { apiKey, site, hostname } = input;

  if (!apiKey) return err({ kind: "unknown_key" });
  if (apiKey.revokedAt) return err({ kind: "revoked_key" });
  if (!site || site.status !== "active") return err({ kind: "site_suspended" });
  if (!hostname) return err({ kind: "origin_missing" });

  const allowed = apiKey.allowedDomains.some(
    (d) => d.toLowerCase() === hostname,
  );
  if (!allowed) return err({ kind: "origin_forbidden", hostname });

  return ok({ apiKey, site, hostname });
}
