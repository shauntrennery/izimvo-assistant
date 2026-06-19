import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { ProductResult } from "../core/products.js";
import { createFakeCatalog } from "../test/fakes.js";
import { buildApp } from "../test/buildApp.js";

/**
 * Contract test for POST /v1/tools/search-products (PLAN §10 Phase 2):
 *   signed request → ≤3 structured products with UTM-tagged checkout URLs;
 *   unsigned request → rejected.
 */

const SECRET = "whsec_test";
const CONV_ID = "conv_test_abc";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
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
    // Seed a session correlated to the conversation id the webhook will carry.
    await ctx.repo.createSession({
      siteId: "site_1",
      categorySlug: "trail-running",
      userIdentity: null,
      origin: "shop.example.com",
      conversationId: CONV_ID,
    });
  });

  function call(body: unknown, headers: Record<string, string> = {}) {
    const raw = JSON.stringify(body);
    return ctx.app.request("/v1/tools/search-products", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: raw,
    });
  }

  const validBody = { conversation_id: CONV_ID, args: { query: "trail shoes", max_price: 250 } };

  it("returns at most 3 UTM-tagged products for a signed request", async () => {
    const raw = JSON.stringify(validBody);
    const res = await ctx.app.request("/v1/tools/search-products", {
      method: "POST",
      headers: { "content-type": "application/json", "x-speechify-signature": sign(raw) },
      body: raw,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { products: ProductResult[] };
    expect(json.products).toHaveLength(3); // capped from 4
    for (const p of json.products) {
      const u = new URL(p.checkoutUrl);
      expect(u.searchParams.get("utm_source")).toBe("izimvo");
      expect(u.searchParams.get("utm_campaign")).toBe("trail-running");
      expect(u.searchParams.get("utm_content")).toMatch(/^sess_/);
    }
  });

  it("resolves the catalog scope server-side from the conversation id", async () => {
    const raw = JSON.stringify(validBody);
    await ctx.app.request("/v1/tools/search-products", {
      method: "POST",
      headers: { "content-type": "application/json", "x-speechify-signature": sign(raw) },
      body: raw,
    });
    expect(ctx.catalog.lastInput?.savedCatalogSlug).toBe("trail-running-za");
    expect(ctx.catalog.lastInput?.maxPriceMinor).toBe(25000); // 250 ZAR → minor
    expect(ctx.catalog.lastInput?.limit).toBe(3);
  });

  it("records a tool_call usage event", async () => {
    const raw = JSON.stringify(validBody);
    await ctx.app.request("/v1/tools/search-products", {
      method: "POST",
      headers: { "content-type": "application/json", "x-speechify-signature": sign(raw) },
      body: raw,
    });
    expect(ctx.repo.usage.some((u) => u.kind === "tool_call")).toBe(true);
  });

  it("rejects an unsigned request with 401", async () => {
    const res = await call(validBody);
    expect(res.status).toBe(401);
  });

  it("rejects a tampered body (signature mismatch) with 401", async () => {
    const raw = JSON.stringify(validBody);
    const sig = sign(raw);
    const res = await ctx.app.request("/v1/tools/search-products", {
      method: "POST",
      headers: { "content-type": "application/json", "x-speechify-signature": sig },
      body: raw + " ",
    });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown conversation id with 404", async () => {
    const body = { conversation_id: "conv_unknown", args: { query: "x" } };
    const raw = JSON.stringify(body);
    const res = await ctx.app.request("/v1/tools/search-products", {
      method: "POST",
      headers: { "content-type": "application/json", "x-speechify-signature": sign(raw) },
      body: raw,
    });
    expect(res.status).toBe(404);
  });

  it("rejects a malformed args payload with 400", async () => {
    const body = { conversation_id: CONV_ID, args: { notquery: 1 } };
    const raw = JSON.stringify(body);
    const res = await ctx.app.request("/v1/tools/search-products", {
      method: "POST",
      headers: { "content-type": "application/json", "x-speechify-signature": sign(raw) },
      body: raw,
    });
    expect(res.status).toBe(400);
  });
});
