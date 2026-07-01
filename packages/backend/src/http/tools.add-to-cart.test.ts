import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { CartAddItem, CartClient, CartSummary } from "../core/cart.js";
import type { ProductResult } from "../core/products.js";
import { createFakeCatalog } from "../test/fakes.js";
import { buildApp } from "../test/buildApp.js";

/**
 * Contract test for POST /v1/tools/add-to-cart. Same signing scheme as the
 * search tool. Signed request → item added to the conversation's cart with a
 * UTM-tagged real checkout URL; the cart id is reused across turns; unsigned →
 * 401; Global mode (no cart dep) → 503.
 */

const SECRET = "toolsec_test";
const CONV_ID = "conv_cart_1";
const TS = "1781862411670";
const VARIANT = "gid://shopify/ProductVariant/41846609969337";

function sign(body: string, ts = TS): string {
  return createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
}

/** In-memory cart double that records calls and accumulates quantity per cart. */
function createFakeCart() {
  const calls: Array<{ cartId: string | null; items: CartAddItem[] }> = [];
  const carts = new Map<string, CartSummary>();
  let created = 0;
  const cart: CartClient & { calls: typeof calls } = {
    calls,
    async addItems(cartId, items) {
      calls.push({ cartId, items });
      const id = cartId ?? `cart_${++created}`;
      const prev = carts.get(id);
      const lines = [...(prev?.lines ?? [])];
      for (const it of items) {
        lines.push({
          lineId: `line_${lines.length + 1}`,
          variantId: it.variantId,
          title: "Form Dining Chair",
          quantity: it.quantity,
          subtotalMinor: 10000 * it.quantity,
          currency: "GBP",
        });
      }
      const totalQuantity = lines.reduce((n, l) => n + l.quantity, 0);
      const summary: CartSummary = {
        cartId: id,
        lines,
        totalQuantity,
        subtotalMinor: lines.reduce((n, l) => n + l.subtotalMinor, 0),
        currency: "GBP",
        checkoutUrl: `https://www.danetti.test/cart/c/${id}?key=abc`,
      };
      carts.set(id, summary);
      return summary;
    },
    async get(cartId) {
      const s = carts.get(cartId);
      if (!s) throw new Error("no cart");
      return s;
    },
  };
  return cart;
}

const products: ProductResult[] = [
  {
    upid: "gid://shopify/Product/7174546686137",
    title: "Form Dining Chair",
    priceMinor: 10000,
    currency: "GBP",
    checkoutUrl: "https://www.danetti.test/cart/41846609969337:1",
    variantId: VARIANT,
  },
];

describe("POST /v1/tools/add-to-cart", () => {
  let ctx: ReturnType<typeof buildApp>;
  let cart: ReturnType<typeof createFakeCart>;

  beforeEach(async () => {
    cart = createFakeCart();
    ctx = buildApp({ catalog: createFakeCatalog(products), cart });
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
    return ctx.app.request(`/v1/tools/add-to-cart?cid=${CONV_ID}`, { method: "POST", headers, body: raw });
  }

  it("adds the resolved variant and returns a UTM-tagged real checkout URL", async () => {
    const res = await post({ arguments: { product_id: "gid://shopify/Product/7174546686137" } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; cart: CartSummary };
    expect(json.ok).toBe(true);
    expect(json.cart.totalQuantity).toBe(1);
    expect(cart.calls[0]).toEqual({ cartId: null, items: [{ variantId: VARIANT, quantity: 1 }] });
    const u = new URL(json.cart.checkoutUrl);
    expect(u.origin + u.pathname).toBe("https://www.danetti.test/cart/c/cart_1");
    expect(u.searchParams.get("utm_source")).toBe("izimvo");
    expect(u.searchParams.get("utm_campaign")).toBe("trail-running");
    expect(u.searchParams.get("utm_content")).toMatch(/^sess_/);
  });

  it("reuses the conversation's cart id across turns and accumulates quantity", async () => {
    // Fresh cid: the conversationCart store is module-level and persists across
    // cases in this file, so an earlier test's cart must not leak in here.
    const cid = "conv_cart_reuse";
    await ctx.repo.createSession({
      siteId: "site_1",
      categorySlug: "trail-running",
      userIdentity: null,
      origin: "shop.example.com",
      conversationId: cid,
    });
    const call = (args: unknown) => {
      const raw = JSON.stringify({ arguments: args });
      return ctx.app.request(`/v1/tools/add-to-cart?cid=${cid}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-speechify-timestamp": TS,
          "x-speechify-signature": `sha256=${sign(raw)}`,
        },
        body: raw,
      });
    };
    await call({ product_id: "gid://shopify/Product/7174546686137" });
    const res = await call({ product_id: "gid://shopify/Product/7174546686137", quantity: 2 });
    const json = (await res.json()) as { cart: CartSummary };
    expect(cart.calls[0]?.cartId).toBeNull();
    expect(cart.calls[1]?.cartId).toBe("cart_1"); // second add appends to the same cart
    expect(json.cart.totalQuantity).toBe(3);
  });

  it("records a tool_call usage event", async () => {
    await post({ arguments: { product_id: "gid://shopify/Product/7174546686137" } });
    expect(ctx.repo.usage.some((u) => u.kind === "tool_call")).toBe(true);
  });

  it("acks the connection-test probe with 200 and does no work", async () => {
    const res = await post({ arguments: {} }, { extraHeaders: { "x-speechify-webhook-test": "true" } });
    expect(res.status).toBe(200);
    expect(cart.calls).toHaveLength(0);
  });

  it("accepts Speechify's live signature header (Speechify-Signature: t=,v0=)", async () => {
    const raw = JSON.stringify({ arguments: { product_id: "gid://shopify/Product/7174546686137" } });
    const t = "1781862411"; // unix seconds
    const v0 = createHmac("sha256", SECRET).update(`${t}.${raw}`).digest("hex");
    const res = await ctx.app.request(`/v1/tools/add-to-cart?cid=${CONV_ID}`, {
      method: "POST",
      headers: { "content-type": "application/json", "speechify-signature": `t=${t},v0=${v0}` },
      body: raw,
    });
    expect(res.status).toBe(200);
  });

  it("rejects an unsigned request with 401", async () => {
    const res = await post({ arguments: { product_id: "x" } }, { signed: false });
    expect(res.status).toBe(401);
  });

  it("returns 503 when cart is unavailable (Global mode)", async () => {
    const noCart = buildApp({ catalog: createFakeCatalog(products) }); // no cart dep
    await noCart.repo.createSession({
      siteId: "site_1",
      categorySlug: "trail-running",
      userIdentity: null,
      origin: "shop.example.com",
      conversationId: CONV_ID,
    });
    const raw = JSON.stringify({ arguments: { product_id: "x" } });
    const res = await noCart.app.request(`/v1/tools/add-to-cart?cid=${CONV_ID}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-speechify-timestamp": TS,
        "x-speechify-signature": `sha256=${sign(raw)}`,
      },
      body: raw,
    });
    expect(res.status).toBe(503);
  });

  it("rejects an unknown conversation id with 404", async () => {
    const raw = JSON.stringify({ arguments: { product_id: "x" } });
    const res = await ctx.app.request(`/v1/tools/add-to-cart?cid=conv_unknown`, {
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

  it("rejects a malformed arguments payload with 400", async () => {
    const res = await post({ arguments: { quantity: 1 } }); // no product_id
    expect(res.status).toBe(400);
  });
});
