import type { SpeechifyClient } from "../clients/speechify.js";
import type { CatalogClient } from "../core/products.js";
import type { RateLimiter } from "../core/rateLimit.js";
import type { Repo } from "../db/repo.js";

/**
 * Everything the imperative shell needs, injected at app-construction time.
 * Tests build an app with fakes; production wires real adapters in server.ts.
 */
export interface AppDeps {
  repo: Repo;
  speechify: SpeechifyClient;
  catalog: CatalogClient;
  rateLimiter: RateLimiter;
  /** HMAC secret for the post-call webhook (set by us in the Speechify console). */
  webhookHmacSecret: string;
  /** HMAC secret for the search_products tool (auto-minted by Speechify on create). */
  toolHmacSecret: string;
  /** ATTRIBUTION_UTM_SOURCE — stamped on every checkout URL. */
  utmSource: string;
  /** Per-IP burst ceiling for /v1/session, independent of per-key rpm. */
  sessionIpRateLimitPerMin: number;
}
