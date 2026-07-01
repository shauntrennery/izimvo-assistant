import { describe, expect, it, vi } from "vitest";
import { CartError, createStorefrontCartClient } from "./cart.storefront.js";

const config = { mcpUrl: "https://www.danetti.test/api/mcp" };

/** The Storefront MCP wraps the payload as a JSON string in result.content[].text. */
function storefrontResult(payload: unknown) {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: JSON.stringify(payload) }], isError: false },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

// Real shape (captured from the live server): money as decimal strings, a real
// checkout_url, lines carrying merchandise (variant + product).
function cartPayload(cartId: string, quantity: number) {
  const amount = (100 * quantity).toFixed(1); // "100.0", "200.0"
  return {
    instructions: "…",
    cart: {
      id: cartId,
      lines: [
        {
          id: `gid://shopify/CartLine/line-1?cart=${cartId}`,
          quantity,
          cost: {
            total_amount: { amount, currency: "GBP" },
            subtotal_amount: { amount, currency: "GBP" },
          },
          merchandise: {
            id: "gid://shopify/ProductVariant/41846609969337",
            title: "Default Title",
            product: {
              id: "gid://shopify/Product/7174546686137",
              title: "Form Dark Grey Velvet Dining Chair",
            },
          },
        },
      ],
      cost: {
        total_amount: { amount, currency: "GBP" },
        subtotal_amount: { amount, currency: "GBP" },
      },
      total_quantity: quantity,
      checkout_url: `https://www.danetti.test/cart/c/${cartId}?key=abc`,
    },
    errors: [],
  };
}

describe("createStorefrontCartClient.addItems", () => {
  it("creates a cart (no cart_id), maps decimal money to minor units", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(config.mcpUrl);
      expect(new Headers(init?.headers).get("authorization")).toBeNull();
      const body = JSON.parse(String(init?.body));
      expect(body.params.name).toBe("update_cart");
      expect(body.params.arguments.cart_id).toBeUndefined();
      expect(body.params.arguments.add_items).toEqual([
        { product_variant_id: "gid://shopify/ProductVariant/41846609969337", quantity: 1 },
      ]);
      return storefrontResult(cartPayload("cart-1", 1));
    });

    const client = createStorefrontCartClient(config, fetchImpl as unknown as typeof fetch);
    const summary = await client.addItems(null, [
      { variantId: "gid://shopify/ProductVariant/41846609969337", quantity: 1 },
    ]);

    expect(summary).toMatchObject({
      cartId: "cart-1",
      totalQuantity: 1,
      subtotalMinor: 10000, // "100.0" GBP → minor
      currency: "GBP",
      checkoutUrl: "https://www.danetti.test/cart/c/cart-1?key=abc",
    });
    expect(summary.lines[0]).toMatchObject({
      variantId: "gid://shopify/ProductVariant/41846609969337",
      productId: "gid://shopify/Product/7174546686137",
      quantity: 1,
      subtotalMinor: 10000,
    });
  });

  it("appends to an existing cart by passing cart_id", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.params.arguments.cart_id).toBe("cart-1");
      return storefrontResult(cartPayload("cart-1", 2));
    });
    const client = createStorefrontCartClient(config, fetchImpl as unknown as typeof fetch);
    const summary = await client.addItems("cart-1", [
      { variantId: "gid://shopify/ProductVariant/41846609969337", quantity: 1 },
    ]);
    expect(summary.totalQuantity).toBe(2);
    expect(summary.subtotalMinor).toBe(20000);
  });

  it("throws CartError when the MCP returns errors", async () => {
    const fetchImpl = vi.fn(async () =>
      storefrontResult({ cart: null, errors: [{ message: "variant not found" }] }),
    );
    const client = createStorefrontCartClient(config, fetchImpl as unknown as typeof fetch);
    await expect(
      client.addItems(null, [{ variantId: "bad", quantity: 1 }]),
    ).rejects.toBeInstanceOf(CartError);
  });

  it("throws CartError on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const client = createStorefrontCartClient(config, fetchImpl as unknown as typeof fetch);
    await expect(
      client.addItems(null, [{ variantId: "v", quantity: 1 }]),
    ).rejects.toBeInstanceOf(CartError);
  });
});

describe("createStorefrontCartClient.get", () => {
  it("calls get_cart with the cart id", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.params.name).toBe("get_cart");
      expect(body.params.arguments.cart_id).toBe("cart-1");
      return storefrontResult(cartPayload("cart-1", 1));
    });
    const client = createStorefrontCartClient(config, fetchImpl as unknown as typeof fetch);
    const summary = await client.get("cart-1");
    expect(summary.cartId).toBe("cart-1");
  });
});
