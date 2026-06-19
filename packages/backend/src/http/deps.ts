import type { SpeechifyClient } from "../clients/speechify.js";
import type { RateLimiter } from "../core/rateLimit.js";
import type { Repo } from "../db/repo.js";

/**
 * Everything the imperative shell needs, injected at app-construction time.
 * Tests build an app with fakes; production wires real adapters in server.ts.
 */
export interface AppDeps {
  repo: Repo;
  speechify: SpeechifyClient;
  rateLimiter: RateLimiter;
  webhookHmacSecret: string;
  /** Per-IP burst ceiling for /v1/session, independent of per-key rpm. */
  sessionIpRateLimitPerMin: number;
}
