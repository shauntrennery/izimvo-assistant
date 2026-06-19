/**
 * Attribution (Guardrail §11.9). Every checkout / continuation URL is UTM-tagged
 * server-side — if it isn't, the revenue share is lost to "direct/referral".
 * Pure: takes a URL + context, returns a tagged URL and the UTM record we
 * persist alongside the attribution row.
 */

export interface UtmContext {
  /** ATTRIBUTION_UTM_SOURCE, e.g. "izimvo". */
  source: string;
  /** Resolved category slug — drives the campaign dimension. */
  categorySlug: string;
  /** Our session id — lets us reconcile a click back to a minted session. */
  sessionId: string;
}

export interface Utm {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
}

const VOICE_MEDIUM = "voice";

export function buildUtm(ctx: UtmContext): Utm {
  return {
    utm_source: ctx.source,
    utm_medium: VOICE_MEDIUM,
    utm_campaign: ctx.categorySlug,
    utm_content: ctx.sessionId,
  };
}

/**
 * Apply UTM params to a URL. Our utm_* keys always win; any other existing
 * query params on the merchant URL are preserved. Returns the input unchanged
 * if it cannot be parsed (defensive — never throw inside the search path).
 */
export function tagUrl(rawUrl: string, utm: Utm): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  for (const [k, v] of Object.entries(utm)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

/** Convenience: build + apply in one call for the search/checkout paths. */
export function tagCheckoutUrl(rawUrl: string, ctx: UtmContext): { url: string; utm: Utm } {
  const utm = buildUtm(ctx);
  return { url: tagUrl(rawUrl, utm), utm };
}

/**
 * Reverse of tagging: pull the utm_* params back off a checkout URL the loader
 * reports. `utm_content` carries our session id, which is how a browser-side
 * checkout click is re-attributed server-side without the browser ever holding
 * our internal session identity.
 */
export function extractUtm(rawUrl: string): {
  sessionId: string | null;
  utm: Record<string, string>;
} {
  try {
    const u = new URL(rawUrl);
    const utm: Record<string, string> = {};
    for (const [k, v] of u.searchParams) {
      if (k.startsWith("utm_")) utm[k] = v;
    }
    return { sessionId: utm.utm_content ?? null, utm };
  } catch {
    return { sessionId: null, utm: {} };
  }
}
