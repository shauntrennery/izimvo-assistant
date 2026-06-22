import { Hono } from "hono";
import { z } from "zod";
import { currencyForCountry, DEFAULT_COUNTRY } from "../core/countries.js";
import type { AppDeps } from "./deps.js";

/**
 * GET /v1/catalog/search — read-only catalogue browse for the search page.
 *
 * Unlike the voice `search_products` tool (PLAN §7.4) this is NOT HMAC-gated and
 * is not bound to the ≤3 read-aloud guardrail (§11.7) — that cap is for spoken
 * results, not a scannable grid. It mirrors the open, non-sensitive
 * `/v1/conversation-products` endpoint: it returns product data only, no secrets.
 *
 * Primary filter is `country`: products must be sold/shippable to it, priced in
 * that country's currency (strict-currency in the catalog client drops offers in
 * other currencies). Defaults to South Africa.
 */

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 48;

const querySchema = z.object({
  q: z.string().min(1),
  country: z.string().length(2).optional(),
  // major units (e.g. Rand) → converted to minor below, matching the voice tool.
  max_price: z.coerce.number().positive().optional(),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).optional(),
});

export function catalogSearchRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const parsed = querySchema.safeParse({
      q: c.req.query("q"),
      country: c.req.query("country"),
      max_price: c.req.query("max_price"),
      limit: c.req.query("limit"),
    });
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

    const { q, max_price, limit } = parsed.data;
    const country = (parsed.data.country ?? DEFAULT_COUNTRY).toUpperCase();
    const currency = currencyForCountry(country);

    try {
      const products = await deps.catalog.search({
        query: q,
        shipsTo: country,
        currency,
        maxPriceMinor: max_price !== undefined ? Math.round(max_price * 100) : undefined,
        limit: limit ?? DEFAULT_LIMIT,
      });
      return c.json({ products, country, currency: currency ?? null });
    } catch {
      // Surface the failure (vs. an empty grid) so the page can distinguish
      // "no matches" from "search is down".
      return c.json({ error: "catalog_unavailable", products: [] }, 502);
    }
  });

  return app;
}
