import { Hono } from "hono";
import { z } from "zod";
import { verifyHmacSignature } from "../clients/speechify.js";
import { tagCheckoutUrl } from "../core/attribution.js";
import type { ProductResult } from "../core/products.js";
import { pushCapture } from "../infra/searchCapture.js";
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

const CONVERSATION_HEADER = "x-speechify-conversation-id";

const argsSchema = z.object({
  query: z.string().min(1),
  max_price: z.number().positive().optional(),
  color: z.string().min(1).optional(),
  ships_to: z.string().min(2).optional(),
});

function firstString(values: unknown[]): string | null {
  for (const v of values) if (typeof v === "string" && v.length > 0) return v;
  return null;
}

/**
 * Resolve the conversation id. Speechify's tool webhook carries NO conversation
 * context in the body/headers by default, so we inject it via the tool URL:
 * `?cid={{system__conversation_id}}` (interpolated per session). The body/header
 * spots are kept as fallbacks in case the contract changes.
 */
function resolveConversationId(
  body: Record<string, unknown>,
  header: string | undefined,
  query: string | undefined,
): string | null {
  const conversation = body.conversation as { id?: unknown } | undefined;
  return firstString([
    query,
    body.conversation_id,
    body.conversationId,
    conversation?.id,
    header,
  ]);
}

export function searchProductsRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    // 1. HMAC over `${timestamp}.${rawBody}`, before parsing anything.
    const rawBody = await c.req.text();

    // TEMP (wiring): stash the raw envelope in a ring buffer (Railway logs don't
    // reliably surface per-request stdout) so we can confirm the live contract.
    const cap = { ts: Date.now(), headers: [...c.req.raw.headers.keys()], body: rawBody, outcome: "pending" };
    pushCapture(cap);

    const ok = verifyHmacSignature({
      rawBody,
      signature: c.req.header(SIGNATURE_HEADER),
      secret: deps.toolHmacSecret,
      timestamp: c.req.header(TIMESTAMP_HEADER),
    });
    if (!ok) {
      cap.outcome = "401 invalid_signature";
      return c.json({ error: "invalid_signature" }, 401);
    }

    // 2. Connection-test probe: signature verified, no work to do.
    if (c.req.header(TEST_HEADER)) {
      cap.outcome = "200 connection_test";
      return c.json({ ok: true }, 200);
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      cap.outcome = "400 bad_json";
      return c.json({ error: "invalid_request" }, 400);
    }
    const argsParse = argsSchema.safeParse(body.arguments);
    if (!argsParse.success) {
      cap.outcome = `400 bad_args: ${argsParse.error.message}`;
      return c.json({ error: "invalid_request" }, 400);
    }
    const args = argsParse.data;

    // 3. Resolve scope server-side from the conversation id (sought in any of
    // the places Speechify might carry it).
    const conversationId = resolveConversationId(
      body,
      c.req.header(CONVERSATION_HEADER),
      c.req.query("cid"),
    );
    if (!conversationId) {
      cap.outcome = "404 no_conversation_id_in_payload";
      return c.json({ error: "unknown_conversation" }, 404);
    }
    const scope = await deps.repo.findScopeByConversationId(conversationId);
    if (!scope) {
      cap.outcome = `404 unknown_conversation id=${conversationId}`;
      return c.json({ error: "unknown_conversation" }, 404);
    }

    // 4. Search the catalog within the resolved boundary. A catalog failure
    // degrades to an empty result (the agent asks a clarifying question) rather
    // than a 500 the agent reads aloud as "the catalogue is down".
    const query = args.color ? `${args.color} ${args.query}` : args.query;
    let results;
    try {
      results = await deps.catalog.search({
        query,
        savedCatalogSlug: scope.savedCatalogSlug ?? undefined,
        maxPriceMinor: args.max_price !== undefined ? Math.round(args.max_price * 100) : undefined,
        shipsTo: args.ships_to ?? DEFAULT_SHIPS_TO,
        optionPreferences: args.color ? ["Color"] : undefined,
        limit: RESULT_LIMIT,
      });
    } catch (e) {
      cap.outcome = `500 catalog_error: ${e instanceof Error ? e.message : String(e)}`;
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

    cap.outcome = `200 query="${query}" returned=${products.length}`;

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
