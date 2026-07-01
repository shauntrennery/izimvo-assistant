import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { FaqClient, PolicyAnswer } from "../clients/faq.storefront.js";
import type { CatalogClient, ProductDetail } from "../core/products.js";
import { buildApp } from "../test/buildApp.js";

/**
 * Contract test for POST /v1/tools/product-info. Signed request → grounded
 * product facts (from the catalog) and/or policy answers (from the FAQ client);
 * unsigned → 401; neither product_id nor question → 400.
 */

const SECRET = "toolsec_test";
const CONV_ID = "conv_info_1";
const TS = "1781862411670";

function sign(body: string, ts = TS): string {
  return createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
}

const detail: ProductDetail = {
  upid: "gid://shopify/Product/7174546686137",
  title: "Form Dining Chair",
  priceMinor: 10000,
  currency: "GBP",
  checkoutUrl: "https://www.danetti.test/cart/41846609969337:1",
  variantId: "gid://shopify/ProductVariant/41846609969337",
  description: "A velvet cantilever dining chair.",
  options: { Title: ["Default Title"] },
};

const catalog: CatalogClient = {
  async search() {
    return [];
  },
  async getProduct(upid) {
    if (upid !== detail.upid) throw new Error("no such product");
    return detail;
  },
};

const faq: FaqClient = {
  async searchPolicies(query) {
    return query.toLowerCase().includes("return")
      ? [{ question: "What is the return policy?", answer: "Returns accepted within 30 days." }]
      : [];
  },
};

describe("POST /v1/tools/product-info", () => {
  let ctx: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    ctx = buildApp({ catalog, faq });
    await ctx.repo.createSession({
      siteId: "site_1",
      categorySlug: "trail-running",
      userIdentity: null,
      origin: "shop.example.com",
      conversationId: CONV_ID,
    });
  });

  function post(body: unknown, opts: { signed?: boolean; extraHeaders?: Record<string, string> } = {}) {
    const raw = JSON.stringify(body);
    const headers: Record<string, string> = { "content-type": "application/json", ...opts.extraHeaders };
    if (opts.signed !== false) {
      headers["x-speechify-timestamp"] = TS;
      headers["x-speechify-signature"] = `sha256=${sign(raw)}`;
    }
    return ctx.app.request(`/v1/tools/product-info?cid=${CONV_ID}`, { method: "POST", headers, body: raw });
  }

  it("returns grounded product facts for a product_id", async () => {
    const res = await post({ arguments: { product_id: detail.upid } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { product?: { title: string; description?: string }; policies: PolicyAnswer[] };
    expect(json.product?.title).toBe("Form Dining Chair");
    expect(json.product?.description).toContain("velvet");
    expect(json.policies).toEqual([]);
  });

  it("returns policy answers for a question", async () => {
    const res = await post({ arguments: { question: "what is your returns policy?" } });
    const json = (await res.json()) as { product?: unknown; policies: PolicyAnswer[] };
    expect(json.policies).toHaveLength(1);
    expect(json.policies[0]?.answer).toContain("30 days");
    expect(json.product).toBeUndefined();
  });

  it("records a tool_call usage event", async () => {
    await post({ arguments: { product_id: detail.upid } });
    expect(ctx.repo.usage.some((u) => u.kind === "tool_call")).toBe(true);
  });

  it("acks the connection-test probe with 200", async () => {
    const res = await post({ arguments: {} }, { extraHeaders: { "x-speechify-webhook-test": "true" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects an unsigned request with 401", async () => {
    const res = await post({ arguments: { product_id: detail.upid } }, { signed: false });
    expect(res.status).toBe(401);
  });

  it("rejects a payload with neither product_id nor question (400)", async () => {
    const res = await post({ arguments: { options: { Title: "Default Title" } } });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown conversation id with 404", async () => {
    const raw = JSON.stringify({ arguments: { product_id: detail.upid } });
    const res = await ctx.app.request(`/v1/tools/product-info?cid=conv_unknown`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-speechify-timestamp": TS,
        "x-speechify-signature": `sha256=${sign(raw)}`,
      },
      body: raw,
    });
    expect(res.status).toBe(404);
  });
});
