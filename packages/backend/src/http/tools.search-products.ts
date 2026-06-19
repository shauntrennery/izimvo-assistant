import { Hono } from "hono";
import { z } from "zod";
import { verifyHmacSignature } from "../clients/speechify.js";
import { tagCheckoutUrl } from "../core/attribution.js";
import type { ProductResult } from "../core/products.js";
import type { AppDeps } from "./deps.js";

/**
 * POST /v1/tools/search-products (PLAN §7.4). The Speechify `search_products`
 * webhook tool. Guardrails enforced here:
 *  - HMAC-verify the raw body before any work (§11.10).
 *  - Resolve category/scope server-side from the conversation id — the LLM
 *    never passes scope (§11.4); its `saved_catalog_slug` is a hard filter.
 *  - Return at most 3 results (§11.7).
 *  - UTM-tag every checkout URL server-side (§11.9).
 */

const SIGNATURE_HEADER = "x-speechify-signature";
const DEFAULT_SHIPS_TO = "ZA";
const RESULT_LIMIT = 3;

// Speechify-side webhook envelope. The LLM fills `args`; `conversation_id` is
// part of the signed envelope, not an LLM-controlled field.
const requestSchema = z.object({
  conversation_id: z.string().min(1),
  args: z.object({
    query: z.string().min(1),
    max_price: z.number().positive().optional(),
    color: z.string().min(1).optional(),
    ships_to: z.string().min(2).optional(),
  }),
});

export function searchProductsRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    // 1. HMAC over the exact raw body, before parsing anything.
    const rawBody = await c.req.text();
    const ok = verifyHmacSignature({
      rawBody,
      signature: c.req.header(SIGNATURE_HEADER),
      secret: deps.webhookHmacSecret,
    });
    if (!ok) return c.json({ error: "invalid_signature" }, 401);

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }
    const parsed = requestSchema.safeParse(json);
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    const { conversation_id, args } = parsed.data;

    // 2. Resolve scope server-side from the (signed) conversation id.
    const scope = await deps.repo.findScopeByConversationId(conversation_id);
    if (!scope) return c.json({ error: "unknown_conversation" }, 404);

    // 3. Search the catalog within the resolved boundary.
    const query = args.color ? `${args.color} ${args.query}` : args.query;
    const results = await deps.catalog.search({
      query,
      savedCatalogSlug: scope.savedCatalogSlug ?? undefined,
      maxPriceMinor: args.max_price !== undefined ? Math.round(args.max_price * 100) : undefined,
      shipsTo: args.ships_to ?? DEFAULT_SHIPS_TO,
      optionPreferences: args.color ? ["Color"] : undefined,
      limit: RESULT_LIMIT,
    });

    // 4. Cap to 3 (defensive) and UTM-tag each checkout URL.
    const products: ProductResult[] = results.slice(0, RESULT_LIMIT).map((p) => {
      const { url } = tagCheckoutUrl(p.checkoutUrl, {
        source: deps.utmSource,
        categorySlug: scope.categorySlug,
        sessionId: scope.sessionId,
      });
      return { ...p, checkoutUrl: url };
    });

    // Record the tool call for billing/usage (best-effort; never blocks search).
    void deps.repo
      .recordUsageEvent({
        sessionId: scope.sessionId,
        kind: "tool_call",
        payload: { tool: "search_products", query, count: products.length },
      })
      .catch(() => undefined);

    return c.json({ products });
  });

  return app;
}
