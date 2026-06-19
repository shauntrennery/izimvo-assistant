import { z } from "zod";

/**
 * Shopify Catalog client-credentials JWT cache (Guardrail §11.5). Confirmed
 * against the live api.shopify.com/auth/access_token endpoint: the request is a
 * JSON body, and the response is `{ access_token, token_type }` with NO
 * `expires_in` — the access_token is itself a JWT, so the TTL is read from its
 * `exp` claim (≈60 min). Minted server-to-server and reused; never per request.
 */

const tokenResponseSchema = z
  .object({ access_token: z.string().min(1) })
  .passthrough();

export interface JwtProvider {
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
// Used only if the token isn't a decodable JWT (defensive — it always is here).
const FALLBACK_TTL_MS = 55 * 60_000;

/** Read the `exp` (epoch seconds) claim from a JWT without verifying it. */
function jwtExpiryMs(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const exp = (claims as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "client_credentials",
      }),
    });
    if (!res.ok) {
      throw new Error(`catalog token mint failed: ${res.status}`);
    }
    const { access_token } = tokenResponseSchema.parse(await res.json());
    cached = {
      token: access_token,
      expiresAtMs: jwtExpiryMs(access_token) ?? now() + FALLBACK_TTL_MS,
    };
    return cached.token;
  }

  return {
    async getToken() {
      if (cached && now() < cached.expiresAtMs - REFRESH_MARGIN_MS) {
        return cached.token;
      }
      if (!inflight) {
        inflight = mint().finally(() => {
          inflight = null;
        });
      }
      return inflight;
    },
  };
}
