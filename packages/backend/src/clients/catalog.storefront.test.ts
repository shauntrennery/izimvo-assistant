import { describe, expect, it, vi } from "vitest";
import { createStorefrontCatalogClient, CatalogError } from "./catalog.js";

const config = {
  mcpUrl: "https://trend-furniture.myshopify.test/api/mcp",
  agentProfileUrl: "https://profile.test/agent.json",
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

const searchPayload = {
  products: [
    {
      id: "gid://shopify/Product/1",
      title: "Oslo 3-Seater Sofa",
      media: [{ type: "image", url: "https://img.test/sofa.jpg" }],
      variants: [
        {
          id: "v1",
          price: { amount: 1299900, currency: "ZAR" },
          checkout_url: "https://trend-furniture.myshopify.test/cart/1:1",
          availability: { available: true },
          seller: { name: "Trend Furniture" },
        },
      ],
    },
  ],
};

describe("createStorefrontCatalogClient.search", () => {
  it("calls search_catalog with NO auth header and parses the content-text payload", async () => {
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
      upid: "gid://shopify/Product/1",
      priceMinor: 1299900,
      currency: "ZAR",
      bestOfferMerchant: "Trend Furniture",
      checkoutUrl: "https://trend-furniture.myshopify.test/cart/1:1",
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
  it("calls get_product_details (the storefront detail tool)", async () => {
    const detailPayload = {
      product: {
        id: "gid://shopify/Product/1",
        title: "Oslo 3-Seater Sofa",
        variants: [
          {
            id: "v1",
            price: { amount: 1299900, currency: "ZAR" },
            checkout_url: "https://trend-furniture.myshopify.test/cart/1:1",
            availability: { available: true },
            seller: { name: "Trend Furniture" },
          },
        ],
      },
    };
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.params.name).toBe("get_product_details");
      expect(body.params.arguments.catalog.id).toBe("gid://shopify/Product/1");
      return storefrontResult(detailPayload);
    });
    const client = createStorefrontCatalogClient(config, fetchImpl as unknown as typeof fetch);
    const detail = await client.getProduct("gid://shopify/Product/1");
    expect(detail).toMatchObject({ upid: "gid://shopify/Product/1", priceMinor: 1299900 });
  });
});
