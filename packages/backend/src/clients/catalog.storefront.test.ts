import { describe, expect, it, vi } from "vitest";
import { createStorefrontCatalogClient, CatalogError } from "./catalog.js";

const config = {
  mcpUrl: "https://trend-furniture.myshopify.test/api/mcp",
  agentProfileUrl: "https://profile.test/agent.json",
  merchantName: "Trend Furniture",
};

/**
 * The Storefront MCP wraps the UCP payload as a JSON string in
 * `result.content[].text` (not `result.structuredContent` like the Global MCP).
 */
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

// The Storefront MCP returns NO checkout_url and NO seller on variants — only
// the variant GID. The client must synthesize a cart permalink from that id.
const searchPayload = {
  products: [
    {
      id: "gid://shopify/Product/7684101472315",
      title: "Oslo 3-Seater Sofa",
      media: [{ type: "image", url: "https://img.test/sofa.jpg" }],
      variants: [
        {
          id: "gid://shopify/ProductVariant/43700687994939",
          price: { amount: 1299900, currency: "ZAR" },
          availability: { available: true },
        },
      ],
    },
  ],
};

describe("createStorefrontCatalogClient.search", () => {
  it("synthesizes a cart permalink, sends no auth header, parses the content-text payload", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(config.mcpUrl);
      // Public storefront endpoint — no Bearer token may be sent.
      expect(new Headers(init?.headers).get("authorization")).toBeNull();
      const body = JSON.parse(String(init?.body));
      expect(body.params.name).toBe("search_catalog");
      expect(body.params.arguments.catalog.query).toBe("sofa");
      expect(body.params.arguments.meta["ucp-agent"].profile).toBe(config.agentProfileUrl);
      return storefrontResult(searchPayload);
    });

    const client = createStorefrontCatalogClient(config, fetchImpl as unknown as typeof fetch);
    const results = await client.search({ query: "sofa", limit: 3 });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      upid: "gid://shopify/Product/7684101472315",
      priceMinor: 1299900,
      currency: "ZAR",
      bestOfferMerchant: "Trend Furniture",
      // built from the variant GID's numeric id against the store origin
      checkoutUrl: "https://trend-furniture.myshopify.test/cart/43700687994939:1",
      imageUrl: "https://img.test/sofa.jpg",
    });
  });

  it("returns no results when the store catalog is empty", async () => {
    const fetchImpl = vi.fn(async () => storefrontResult({ products: [] }));
    const client = createStorefrontCatalogClient(config, fetchImpl as unknown as typeof fetch);
    await expect(client.search({ query: "sofa", limit: 3 })).resolves.toEqual([]);
  });

  it("throws CatalogError on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 }));
    const client = createStorefrontCatalogClient(config, fetchImpl as unknown as typeof fetch);
    await expect(client.search({ query: "x", limit: 3 })).rejects.toBeInstanceOf(CatalogError);
  });
});

describe("createStorefrontCatalogClient.getProduct", () => {
  // get_product_details uses the NATIVE Shopify shape (product_id request;
  // selectedOrFirstAvailableVariant + decimal price + string description +
  // options[].values), not the UCP search_catalog shape.
  const detailPayload = {
    product: {
      product_id: "gid://shopify/Product/7684101472315",
      title: "Oslo 3-Seater Sofa",
      description: "A deep, comfy three-seater.",
      image_url: "https://img.test/sofa.jpg",
      options: [{ name: "Fabric", values: ["Grey", "Charcoal"] }],
      total_variants: 2,
      selectedOrFirstAvailableVariant: {
        variant_id: "gid://shopify/ProductVariant/43700687994939",
        title: "Grey",
        price: "1299.0",
        currency: "GBP",
        available: true,
      },
    },
  };

  it("sends product_id (+ options + country) and maps the native detail shape", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.params.name).toBe("get_product_details");
      expect(body.params.arguments.product_id).toBe("gid://shopify/Product/7684101472315");
      expect(body.params.arguments.options).toEqual({ Fabric: "Grey" });
      expect(body.params.arguments.country).toBe("GB");
      return storefrontResult(detailPayload);
    });
    const client = createStorefrontCatalogClient(
      { ...config, defaultCountry: "GB" },
      fetchImpl as unknown as typeof fetch,
    );
    const detail = await client.getProduct("gid://shopify/Product/7684101472315", {
      Fabric: "Grey",
    });
    expect(detail).toMatchObject({
      upid: "gid://shopify/Product/7684101472315",
      title: "Oslo 3-Seater Sofa",
      priceMinor: 129900, // "1299.0" GBP → minor units
      currency: "GBP",
      description: "A deep, comfy three-seater.",
      options: { Fabric: ["Grey", "Charcoal"] },
      variantId: "gid://shopify/ProductVariant/43700687994939",
      checkoutUrl: "https://trend-furniture.myshopify.test/cart/43700687994939:1",
    });
  });
});
