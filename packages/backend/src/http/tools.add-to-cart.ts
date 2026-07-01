import { Hono } from "hono";
import { z } from "zod";
import { verifyHmacSignature } from "../clients/speechify.js";
import { tagCheckoutUrl } from "../core/attribution.js";
import { formatMoney } from "../core/products.js";
import { getConversationCartId, putConversationCart } from "../infra/conversationCart.js";
import type { AppDeps } from "./deps.js";
import { CONVERSATION_HEADER, resolveConversationId, speechifySignatureParts } from "./util.js";

/**
 * POST /v1/tools/add-to-cart. The Speechify `add_to_cart` webhook tool. Adds a
 * product to the shopper's real Storefront cart (Danetti MCP `update_cart`),
 * building the cart up across turns and handing back a real, UTM-tagged checkout
 * URL. Same guardrails as the search tool:
 *  - HMAC-verify before any work (§11.10).
 *  - Resolve scope server-side from the conversation id (§11.4) — the LLM never
 *    passes the cart id or session; we key the cart to the conversation.
 *  - UTM-tag the checkout URL server-side (§11.9).
 *
 * The variant is resolved server-side from `product_id` (+ optional `options`)
 * via the catalog's product detail, so the LLM only needs the product id it saw
 * in a search result — never a raw variant id.
 */

const SIGNATURE_HEADER = "x-speechify-signature";
const TIMESTAMP_HEADER = "x-speechify-timestamp";
const COMBINED_SIGNATURE_HEADER = "speechify-signature";
const TEST_HEADER = "x-speechify-webhook-test";

const argsSchema = z.object({
  product_id: z.string().min(1),
  quantity: z.coerce.number().int().positive().max(99).optional(),
  // Speechify tool params are scalars, so an object may arrive JSON-encoded.
  options: z.preprocess((v) => {
    if (typeof v === "string") {
      try {
        return JSON.parse(v);
      } catch {
        return undefined;
      }
    }
    return v;
  }, z.record(z.string()).optional()),
});

export function addToCartRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    // 1. HMAC over `${timestamp}.${rawBody}`, before parsing anything. Accept
    // both the live (Speechify-Signature: t=,v0=) and console (split header)
    // formats; verify with this tool's own minted secret.
    const rawBody = await c.req.text();
    const { signature, timestamp } = speechifySignatureParts({
      combined: c.req.header(COMBINED_SIGNATURE_HEADER),
      signature: c.req.header(SIGNATURE_HEADER),
      timestamp: c.req.header(TIMESTAMP_HEADER),
    });
    const ok = verifyHmacSignature({
      rawBody,
      signature,
      secret: deps.addToCartHmacSecret,
      timestamp,
    });
    if (!ok) return c.json({ error: "invalid_signature" }, 401);

    // 2. Connection-test probe: signature verified, no work to do.
    if (c.req.header(TEST_HEADER)) return c.json({ ok: true }, 200);

    // 3. Cart is a Storefront-only capability.
    if (!deps.cart) return c.json({ error: "cart_unavailable" }, 503);

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }
    const argsParse = argsSchema.safeParse(body.arguments);
    if (!argsParse.success) return c.json({ error: "invalid_request" }, 400);
    const args = argsParse.data;
    const quantity = args.quantity ?? 1;

    // 4. Resolve scope server-side from the conversation id.
    const conversationId = resolveConversationId(
      body,
      c.req.header(CONVERSATION_HEADER),
      c.req.query("cid"),
    );
    if (!conversationId) return c.json({ error: "unknown_conversation" }, 404);
    const scope = await deps.repo.findScopeByConversationId(conversationId);
    if (!scope) return c.json({ error: "unknown_conversation" }, 404);

    // 5. Resolve the purchasable variant from the product id (+ any options),
    // then add it to this conversation's cart (creating one on first add).
    try {
      const detail = await deps.catalog.getProduct(args.product_id, args.options);
      if (!detail.variantId) {
        return c.json({ ok: false, message: "That product can't be added right now." });
      }
      const cartId = getConversationCartId(conversationId);
      const summary = await deps.cart.addItems(cartId, [
        { variantId: detail.variantId, quantity },
      ]);

      // UTM-tag the checkout URL server-side (§11.9) and store the TAGGED summary
      // so the loader's /v1/conversation-cart poll and /v1/checkout both see it.
      const { url: checkoutUrl } = tagCheckoutUrl(summary.checkoutUrl, {
        source: deps.utmSource,
        categorySlug: scope.categorySlug,
        sessionId: scope.sessionId,
      });
      const tagged = { ...summary, checkoutUrl };
      putConversationCart(conversationId, tagged);

      void deps.repo
        .recordUsageEvent({
          sessionId: scope.sessionId,
          kind: "tool_call",
          payload: {
            tool: "add_to_cart",
            productId: args.product_id,
            quantity,
            totalQuantity: summary.totalQuantity,
          },
        })
        .catch(() => undefined);

      // Add spoken-ready prices so the agent speaks the basket total correctly.
      const locale = `en-${deps.storeDefaultCountry}`;
      const cartOut = {
        ...tagged,
        total: formatMoney(tagged.subtotalMinor, tagged.currency, locale),
        lines: tagged.lines.map((l) => ({
          ...l,
          price: formatMoney(l.subtotalMinor, l.currency, locale),
        })),
      };
      return c.json({ ok: true, cart: cartOut });
    } catch {
      // Degrade to a spoken-friendly failure rather than a 500 the agent reads
      // aloud as an outage.
      return c.json({ ok: false, message: "I couldn't add that to the cart just now." });
    }
  });

  return app;
}
