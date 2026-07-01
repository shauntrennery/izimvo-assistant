import type { SpeechifyClient } from "../clients/speechify.js";
import type { FaqClient } from "../clients/faq.storefront.js";
import type { CartClient } from "../core/cart.js";
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
  /** Storefront-only: real MCP-managed cart. Absent in Global mode. */
  cart?: CartClient;
  /** Storefront-only: store policy / FAQ lookups. Absent in Global mode. */
  faq?: FaqClient;
  rateLimiter: RateLimiter;
  /** HMAC secret for the post-call webhook (set by us in the Speechify console). */
  webhookHmacSecret: string;
  /** HMAC secret for the search_products tool (auto-minted by Speechify on create). */
  toolHmacSecret: string;
  /** HMAC secret for the add_to_cart tool (its own Speechify-minted secret). */
  addToCartHmacSecret: string;
  /** HMAC secret for the product_info tool (its own Speechify-minted secret). */
  productInfoHmacSecret: string;
  /** ATTRIBUTION_UTM_SOURCE — stamped on every checkout URL. */
  utmSource: string;
  /** Default ships-to country (ISO-2) when the LLM omits it; drives buyer currency. */
  storeDefaultCountry: string;
  /** Per-IP burst ceiling for /v1/session, independent of per-key rpm. */
  sessionIpRateLimitPerMin: number;
  /** Built loader bundle to serve at /v1/loader.js; omitted in tests/when absent. */
  loaderBundle?: { js: string; map: string | null };
  /** Example storefront HTML to serve at /demo; omitted in tests/when absent. */
  demoHtml?: string;
  /** Install/embed docs HTML to serve at /docs; omitted in tests/when absent. */
  docsHtml?: string;
}
