import { Hono } from "hono";
import { z } from "zod";
import { verifyHmacSignature } from "../clients/speechify.js";
import type { PolicyAnswer } from "../clients/faq.storefront.js";
import { formatMoney, type ProductDetail } from "../core/products.js";
import type { AppDeps } from "./deps.js";
import { CONVERSATION_HEADER, resolveConversationId, speechifySignatureParts } from "./util.js";

/**
 * POST /v1/tools/product-info. The Speechify `product_info` webhook tool. Grounds
 * the adviser's answers about a specific product (dimensions, materials, price,
 * variants) and about store policies (delivery / returns / warranty) in real
 * Danetti data, so it never invents facts (Guardrail §11.8). Same guardrails as
 * the other tools: HMAC-verify first; resolve scope server-side from the
 * conversation id. At least one of `product_id` / `question` is required.
 */

const SIGNATURE_HEADER = "x-speechify-signature";
const TIMESTAMP_HEADER = "x-speechify-timestamp";
const COMBINED_SIGNATURE_HEADER = "speechify-signature";
const TEST_HEADER = "x-speechify-webhook-test";

const argsSchema = z
  .object({
    product_id: z.string().min(1).optional(),
    question: z.string().min(1).optional(),
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
  })
  .refine((a) => Boolean(a.product_id) || Boolean(a.question), {
    message: "product_id or question required",
  });

/** Spoken-facing subset of a product — omit the checkout/variant plumbing. */
function toProductFacts(d: ProductDetail, locale: string) {
  return {
    upid: d.upid,
    title: d.title,
    priceMinor: d.priceMinor,
    currency: d.currency,
    price: formatMoney(d.priceMinor, d.currency, locale),
    imageUrl: d.imageUrl,
    description: d.description,
    options: d.options,
  };
}

export function productInfoRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    // 1. HMAC over `${timestamp}.${rawBody}`, before parsing anything. Accept
    // both live + console signature formats; verify with this tool's own secret.
    const rawBody = await c.req.text();
    const { signature, timestamp } = speechifySignatureParts({
      combined: c.req.header(COMBINED_SIGNATURE_HEADER),
      signature: c.req.header(SIGNATURE_HEADER),
      timestamp: c.req.header(TIMESTAMP_HEADER),
    });
    const ok = verifyHmacSignature({
      rawBody,
      signature,
      secret: deps.productInfoHmacSecret,
      timestamp,
    });
    if (!ok) return c.json({ error: "invalid_signature" }, 401);

    // 2. Connection-test probe: signature verified, no work to do.
    if (c.req.header(TEST_HEADER)) return c.json({ ok: true }, 200);

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }
    const argsParse = argsSchema.safeParse(body.arguments);
    if (!argsParse.success) return c.json({ error: "invalid_request" }, 400);
    const args = argsParse.data;

    // 3. Resolve scope server-side from the conversation id (also gives sessionId
    // for usage attribution).
    const conversationId = resolveConversationId(
      body,
      c.req.header(CONVERSATION_HEADER),
      c.req.query("cid"),
    );
    if (!conversationId) return c.json({ error: "unknown_conversation" }, 404);
    const scope = await deps.repo.findScopeByConversationId(conversationId);
    if (!scope) return c.json({ error: "unknown_conversation" }, 404);

    // 4. Gather grounding: product facts (any mode) + store policies (Storefront).
    const locale = `en-${deps.storeDefaultCountry}`;
    let product: ReturnType<typeof toProductFacts> | undefined;
    if (args.product_id) {
      try {
        product = toProductFacts(await deps.catalog.getProduct(args.product_id, args.options), locale);
      } catch {
        product = undefined; // agent handles a missing product gracefully
      }
    }

    let policies: PolicyAnswer[] = [];
    if (args.question && deps.faq) {
      policies = await deps.faq.searchPolicies(args.question);
    }

    void deps.repo
      .recordUsageEvent({
        sessionId: scope.sessionId,
        kind: "tool_call",
        payload: {
          tool: "product_info",
          productId: args.product_id,
          hasQuestion: Boolean(args.question),
          policyHits: policies.length,
        },
      })
      .catch(() => undefined);

    return c.json({ ok: true, product, policies });
  });

  return app;
}
