import { z } from "zod";

/**
 * Shopify Catalog client-credentials JWT cache (Guardrail §11.5). The token is
 * minted server-to-server and reused across requests — never minted per
 * request. Refreshed a margin before expiry so an in-flight search never races
 * an expiring token.
 */

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  // seconds; the spec says ~60 min. Default if the provider omits it.
  expires_in: z.number().positive().default(3600),
});

export interface JwtProvider {
  /** Returns a currently-valid bearer token, minting/refreshing as needed. */
  getToken(): Promise<string>;
}

export interface JwtCacheConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

// Refresh this long before the real expiry to avoid edge races.
const REFRESH_MARGIN_MS = 60_000;

export function createJwtCache(
  config: JwtCacheConfig,
  deps: { fetchImpl?: typeof fetch; now?: () => number } = {},
): JwtProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => Date.now());

  let cached: CachedToken | null = null;
  let inflight: Promise<string> | null = null;

  async function mint(): Promise<string> {
    const res = await fetchImpl(config.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }).toString(),
    });
    if (!res.ok) {
      throw new Error(`catalog token mint failed: ${res.status}`);
    }
    const parsed = tokenResponseSchema.parse(await res.json());
    cached = {
      token: parsed.access_token,
      expiresAtMs: now() + parsed.expires_in * 1000,
    };
    return cached.token;
  }

  return {
    async getToken() {
      if (cached && now() < cached.expiresAtMs - REFRESH_MARGIN_MS) {
        return cached.token;
      }
      // Coalesce concurrent refreshes into a single mint.
      if (!inflight) {
        inflight = mint().finally(() => {
          inflight = null;
        });
      }
      return inflight;
    },
  };
}
