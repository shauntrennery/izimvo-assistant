import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { ProductResult } from "../core/products.js";
import { createFakeCatalog } from "../test/fakes.js";
import { buildApp } from "../test/buildApp.js";

/**
 * Contract test for POST /v1/tools/search-products (PLAN §10 Phase 2), using the
 * real Speechify signing scheme confirmed against the console:
 *   X-Speechify-Signature = hex( HMAC-SHA256(secret, `${timestamp}.${body}`) )
 *   args under `arguments`; connection_test probe → 200 no-op.
 * Signed request → ≤3 UTM-tagged products; unsigned/tampered → 401.
 */

const SECRET = "toolsec_test"; // the search tool's own signing secret
const CONV_ID = "conv_test_abc";
const TS = "1781862411670";

function sign(body: string, ts = TS): string {
  return createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
}

const catalogProducts: ProductResult[] = [
  { upid: "u1", title: "Shoe 1", priceMinor: 19900, currency: "ZAR", checkoutUrl: "https://m.test/p1" },
  { upid: "u2", title: "Shoe 2", priceMinor: 22900, currency: "ZAR", checkoutUrl: "https://m.test/p2" },
  { upid: "u3", title: "Shoe 3", priceMinor: 25900, currency: "ZAR", checkoutUrl: "https://m.test/p3" },
  { upid: "u4", title: "Shoe 4", priceMinor: 30000, currency: "ZAR", checkoutUrl: "https://m.test/p4" },
];

describe("POST /v1/tools/search-products", () => {
  let ctx: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    ctx = buildApp({ catalog: createFakeCatalog(catalogProducts) });
    await ctx.repo.createSession({
      siteId: "site_1",
      categorySlug: "trail-running",
      userIdentity: null,
      origin: "shop.example.com",
      conversationId: CONV_ID,
    });
  });

  /** POST with a correct ts.body signature unless `unsigned`/`tamper` overrides. */
  function post(
    body: unknown,
    opts: { signed?: boolean; tamper?: boolean; extraHeaders?: Record<string, string> } = {},
  ) {
    const raw = JSON.stringify(body);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...opts.extraHeaders,
    };
    if (opts.signed !== false) {
      headers["x-speechify-timestamp"] = TS;
      headers["x-speechify-signature"] = `sha256=${sign(raw)}`;
    }
    return ctx.app.request("/v1/tools/search-products", {
      method: "POST",
      headers,
      body: opts.tamper ? raw + " " : raw,
    });
  }

  const validBody = {
    conversation_id: CONV_ID,
    arguments: { query: "trail shoes", max_price: 250 },
  };

  it("returns at most 3 UTM-tagged products for a signed request", async () => {
    const res = await post(validBody);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { products: Array<ProductResult & { price: string }> };
    expect(json.products).toHaveLength(3); // capped from 4
    for (const p of json.products) {
      const u = new URL(p.checkoutUrl);
      expect(u.searchParams.get("utm_source")).toBe("izimvo");
      expect(u.searchParams.get("utm_campaign")).toBe("trail-running");
      expect(u.searchParams.get("utm_content")).toMatch(/^sess_/);
      // spoken-ready price present (so the agent doesn't read raw minor units)
      expect(typeof p.price).toBe("string");
    }
    expect(json.products[0]?.price).toMatch(/199/); // 19900 minor → "…199…"
  });

  it("resolves the conversation id from the ?cid= query (real Speechify envelope)", async () => {
    // Real tool payload carries no conversation_id; it arrives via the tool URL.
    const realEnvelope = {
      tool_name: "search_products",
      tool_call_id: "tc_1",
      timestamp: Number(TS),
      arguments: { query: "trail shoes", max_price: 250 },
    };
    const raw = JSON.stringify(realEnvelope);
    const res = await ctx.app.request(`/v1/tools/search-products?cid=${CONV_ID}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-speechify-timestamp": TS,
        "x-speechify-signature": `sha256=${sign(raw)}`,
      },
      body: raw,
    });
    expect(res.status).toBe(200);
    expect(ctx.catalog.lastInput?.savedCatalogSlug).toBe("trail-running-za");
  });

  it("resolves the catalog scope server-side from the conversation id", async () => {
    await post(validBody);
    expect(ctx.catalog.lastInput?.savedCatalogSlug).toBe("trail-running-za");
    expect(ctx.catalog.lastInput?.maxPriceMinor).toBe(25000); // 250 ZAR → minor
    expect(ctx.catalog.lastInput?.limit).toBe(3);
  });

  it("records a tool_call usage event", async () => {
    await post(validBody);
    expect(ctx.repo.usage.some((u) => u.kind === "tool_call")).toBe(true);
  });

  it("stashes results for the conversation, readable via /v1/conversation-products", async () => {
    await post(validBody);
    const res = await ctx.app.request(`/v1/conversation-products?cid=${CONV_ID}`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { products: ProductResult[] };
    expect(json.products).toHaveLength(3);
    expect(json.products[0]?.checkoutUrl).toContain("utm_source=izimvo");
  });

  it("acks the connection-test probe with 200 and does no work", async () => {
    const body = { tool_name: "connection_test", arguments: {}, timestamp: Number(TS) };
    const res = await post(body, { extraHeaders: { "x-speechify-webhook-test": "true" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(ctx.catalog.lastInput).toBeNull();
  });

  it("rejects an unsigned request with 401", async () => {
    const res = await post(validBody, { signed: false });
    expect(res.status).toBe(401);
  });

  it("rejects a tampered body (signature mismatch) with 401", async () => {
    const res = await post(validBody, { tamper: true });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown conversation id with 404", async () => {
    const res = await post({ conversation_id: "conv_unknown", arguments: { query: "x" } });
    expect(res.status).toBe(404);
  });

  it("rejects a malformed arguments payload with 400", async () => {
    const res = await post({ conversation_id: CONV_ID, arguments: { notquery: 1 } });
    expect(res.status).toBe(400);
  });
});
