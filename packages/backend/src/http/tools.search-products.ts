import { Hono } from "hono";
import { z } from "zod";
import { verifyHmacSignature } from "../clients/speechify.js";
import { tagCheckoutUrl } from "../core/attribution.js";
import { currencyForCountry } from "../core/countries.js";
import type { ProductResult } from "../core/products.js";
import { putConversationProducts } from "../infra/conversationProducts.js";
import type { AppDeps } from "./deps.js";
import { CONVERSATION_HEADER, resolveConversationId, speechifySignatureParts } from "./util.js";

/**
 * POST /v1/tools/search-products (PLAN §7.4). The Speechify `search_products`
 * webhook tool. Guardrails enforced here:
 *  - HMAC-verify before any work (§11.10): signed payload is `${timestamp}.${body}`.
 *  - Resolve category/scope server-side from the conversation id — the LLM
 *    never passes scope (§11.4); its `saved_catalog_slug` is a hard filter.
 *  - Return at most 3 results (§11.7).
 *  - UTM-tag every checkout URL server-side (§11.9).
 *
 * Envelope shape (confirmed from the Speechify console probe):
 *   { tool_name, tool_call_id, timestamp, arguments: { ...LLM params } }
 * The LLM fills `arguments`; `conversation_id` is envelope-level, not an
 * LLM-controlled field. NOTE: the connection-test probe does not carry a
 * conversation_id; the exact location/name on a *live* tool call is still to be
 * confirmed against a real session — adjust `requestSchema` if it differs.
 */

const SIGNATURE_HEADER = "x-speechify-signature";
const TIMESTAMP_HEADER = "x-speechify-timestamp";
const COMBINED_SIGNATURE_HEADER = "speechify-signature";
const TEST_HEADER = "x-speechify-webhook-test";
const RESULT_LIMIT = 3;

const argsSchema = z.object({
  query: z.string().min(1),
  max_price: z.number().positive().optional(),
  color: z.string().min(1).optional(),
  ships_to: z.string().min(2).optional(),
});

export function searchProductsRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    // 1. HMAC over `${timestamp}.${rawBody}`, before parsing anything. Accept
    // both the live (Speechify-Signature: t=,v0=) and console (split header)
    // signature formats.
    const rawBody = await c.req.text();
    const { signature, timestamp } = speechifySignatureParts({
      combined: c.req.header(COMBINED_SIGNATURE_HEADER),
      signature: c.req.header(SIGNATURE_HEADER),
      timestamp: c.req.header(TIMESTAMP_HEADER),
    });
    const ok = verifyHmacSignature({
      rawBody,
      signature,
      secret: deps.toolHmacSecret,
      timestamp,
    });
    if (!ok) return c.json({ error: "invalid_signature" }, 401);

    // 2. Connection-test probe: signature verified, no work to do.
    if (c.req.header(TEST_HEADER)) {
      return c.json({ ok: true }, 200);
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }
    const argsParse = argsSchema.safeParse(body.arguments);
    if (!argsParse.success) return c.json({ error: "invalid_request" }, 400);
    const args = argsParse.data;

    // 3. Resolve scope server-side from the conversation id. Speechify's tool
    // webhook sends it via the tool URL (?cid={{system__conversation_id}}); the
    // body/header are fallbacks.
    const conversationId = resolveConversationId(
      body,
      c.req.header(CONVERSATION_HEADER),
      c.req.query("cid"),
    );
    if (!conversationId) return c.json({ error: "unknown_conversation" }, 404);
    const scope = await deps.repo.findScopeByConversationId(conversationId);
    if (!scope) return c.json({ error: "unknown_conversation" }, 404);

    // 4. Search the catalog within the resolved boundary. A catalog failure
    // degrades to an empty result (the agent asks a clarifying question) rather
    // than a 500 the agent reads aloud as "the catalogue is down".
    const query = args.color ? `${args.color} ${args.query}` : args.query;
    const shipsTo = args.ships_to ?? deps.storeDefaultCountry;
    let results;
    try {
      results = await deps.catalog.search({
        query,
        savedCatalogSlug: scope.savedCatalogSlug ?? undefined,
        maxPriceMinor: args.max_price !== undefined ? Math.round(args.max_price * 100) : undefined,
        shipsTo,
        currency: currencyForCountry(shipsTo),
        optionPreferences: args.color ? ["Color"] : undefined,
        limit: RESULT_LIMIT,
      });
    } catch {
      // A catalog failure degrades to empty results (the agent asks a
      // clarifying question) rather than a 500 it reads aloud as an outage.
      return c.json({ products: [] });
    }

    // 5. Cap to 3 (defensive) and UTM-tag each checkout URL.
    const products: ProductResult[] = results.slice(0, RESULT_LIMIT).map((p) => {
      const { url } = tagCheckoutUrl(p.checkoutUrl, {
        source: deps.utmSource,
        categorySlug: scope.categorySlug,
        sessionId: scope.sessionId,
      });
      return { ...p, checkoutUrl: url };
    });

    // Stash for the loader to render via polling (the agent's render_products
    // client-tool dispatch is unreliable; this keeps cards independent of it).
    putConversationProducts(conversationId, products);

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
