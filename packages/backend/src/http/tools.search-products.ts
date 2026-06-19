import { Hono } from "hono";
import { z } from "zod";
import { verifyHmacSignature } from "../clients/speechify.js";
import { tagCheckoutUrl } from "../core/attribution.js";
import type { ProductResult } from "../core/products.js";
import type { AppDeps } from "./deps.js";

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
const TEST_HEADER = "x-speechify-webhook-test";
const DEFAULT_SHIPS_TO = "ZA";
const RESULT_LIMIT = 3;

const requestSchema = z.object({
  conversation_id: z.string().min(1),
  arguments: z.object({
    query: z.string().min(1),
    max_price: z.number().positive().optional(),
    color: z.string().min(1).optional(),
    ships_to: z.string().min(2).optional(),
  }),
});

export function searchProductsRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    // 1. HMAC over `${timestamp}.${rawBody}`, before parsing anything.
    const rawBody = await c.req.text();

    // TEMP (wiring): capture the real tool-call envelope so we can confirm where
    // conversation_id lives on a live call. Remove once the contract is locked.
    // eslint-disable-next-line no-console
    console.log(
      `[search:in] headers=[${[...c.req.raw.headers.keys()].join(",")}] body=${rawBody}`,
    );

    const ok = verifyHmacSignature({
      rawBody,
      signature: c.req.header(SIGNATURE_HEADER),
      secret: deps.toolHmacSecret,
      timestamp: c.req.header(TIMESTAMP_HEADER),
    });
    if (!ok) {
      // eslint-disable-next-line no-console
      console.log("[search:out] 401 invalid_signature");
      return c.json({ error: "invalid_signature" }, 401);
    }

    // 2. Connection-test probe: signature verified, no work to do.
    if (c.req.header(TEST_HEADER)) {
      return c.json({ ok: true }, 200);
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }
    const parsed = requestSchema.safeParse(json);
    if (!parsed.success) {
      // eslint-disable-next-line no-console
      console.log(`[search:out] 400 invalid_request: ${parsed.error.message}`);
      return c.json({ error: "invalid_request" }, 400);
    }
    const { conversation_id } = parsed.data;
    const args = parsed.data.arguments;

    // 3. Resolve scope server-side from the conversation id.
    const scope = await deps.repo.findScopeByConversationId(conversation_id);
    if (!scope) {
      // eslint-disable-next-line no-console
      console.log(`[search:out] 404 unknown_conversation conversation_id=${conversation_id}`);
      return c.json({ error: "unknown_conversation" }, 404);
    }

    // 4. Search the catalog within the resolved boundary.
    const query = args.color ? `${args.color} ${args.query}` : args.query;
    const results = await deps.catalog.search({
      query,
      savedCatalogSlug: scope.savedCatalogSlug ?? undefined,
      maxPriceMinor: args.max_price !== undefined ? Math.round(args.max_price * 100) : undefined,
      shipsTo: args.ships_to ?? DEFAULT_SHIPS_TO,
      optionPreferences: args.color ? ["Color"] : undefined,
      limit: RESULT_LIMIT,
    });

    // 5. Cap to 3 (defensive) and UTM-tag each checkout URL.
    const products: ProductResult[] = results.slice(0, RESULT_LIMIT).map((p) => {
      const { url } = tagCheckoutUrl(p.checkoutUrl, {
        source: deps.utmSource,
        categorySlug: scope.categorySlug,
        sessionId: scope.sessionId,
      });
      return { ...p, checkoutUrl: url };
    });

    // eslint-disable-next-line no-console
    console.log(`[search:out] 200 query="${query}" returned=${products.length}`);

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
