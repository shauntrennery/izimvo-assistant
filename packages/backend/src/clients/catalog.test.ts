import { describe, expect, it, vi } from "vitest";
import type { JwtProvider } from "./jwtCache.js";
import { createGlobalCatalogClient, CatalogError } from "./catalog.js";

const staticJwt: JwtProvider = {
  async getToken() {
    return "jwt-123";
  },
};
const config = {
  mcpUrl: "https://catalog.shopify.test/api/ucp/mcp",
  agentProfileUrl: "https://profile.test/agent.json",
};

/** JSON-RPC success envelope with the UCP structuredContent payload. */
function mcpResult(structuredContent: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const searchPayload = {
  products: [
    {
      id: "gid://shopify/p/u1",
      title: "Trail Shoe",
      media: [{ type: "image", url: "https://img.test/1.jpg" }],
      variants: [
        { id: "v1", price: { amount: 25000, currency: "ZAR" }, checkout_url: "https://a.test/p", availability: { available: true }, seller: { name: "A" } },
        { id: "v2", price: { amount: 19900, currency: "ZAR" }, checkout_url: "https://b.test/p", availability: { available: true }, seller: { name: "B" } },
        { id: "v3", price: { amount: 9900, currency: "ZAR" }, checkout_url: "https://c.test/p", availability: { available: false }, seller: { name: "C" } },
      ],
    },
  ],
};

describe("createGlobalCatalogClient.search", () => {
  it("calls search_catalog with bearer JWT + agent profile, maps the best available variant", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(config.mcpUrl);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer jwt-123");
      const payload = JSON.parse(String(init?.body));
      expect(payload.method).toBe("tools/call");
      expect(payload.params.name).toBe("search_catalog");
      expect(payload.params.arguments.catalog.query).toBe("trail shoes");
      expect(payload.params.arguments.catalog.saved_catalog_slug).toBe("trail-running-za");
      expect(payload.params.arguments.catalog.filters.ships_to).toEqual({ country: "ZA" });
      expect(payload.params.arguments.meta["ucp-agent"].profile).toBe(config.agentProfileUrl);
      return mcpResult(searchPayload);
    });

    const client = createGlobalCatalogClient(config, staticJwt, fetchImpl as unknown as typeof fetch);
    const results = await client.search({
      query: "trail shoes",
      savedCatalogSlug: "trail-running-za",
      shipsTo: "ZA",
      limit: 3,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      upid: "gid://shopify/p/u1",
      priceMinor: 19900, // v2 — lowest *available* (v3 is cheaper but unavailable)
      currency: "ZAR",
      bestOfferMerchant: "B",
      checkoutUrl: "https://b.test/p",
      imageUrl: "https://img.test/1.jpg",
    });
  });

  it("throws CatalogError on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const client = createGlobalCatalogClient(config, staticJwt, fetchImpl as unknown as typeof fetch);
    await expect(client.search({ query: "x", limit: 3 })).rejects.toBeInstanceOf(CatalogError);
  });

  it("throws CatalogError on a JSON-RPC error envelope", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32001, message: "UCP discovery failed" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const client = createGlobalCatalogClient(config, staticJwt, fetchImpl as unknown as typeof fetch);
    await expect(client.search({ query: "x", limit: 3 })).rejects.toBeInstanceOf(CatalogError);
  });

  it("throws CatalogError on an unexpected structuredContent shape", async () => {
    const fetchImpl = vi.fn(async () => mcpResult({ wrong: true }));
    const client = createGlobalCatalogClient(config, staticJwt, fetchImpl as unknown as typeof fetch);
    await expect(client.search({ query: "x", limit: 3 })).rejects.toBeInstanceOf(CatalogError);
  });
});

describe("createGlobalCatalogClient.getProduct", () => {
  it("calls get_product and maps detail incl. options", async () => {
    const detailPayload = {
      product: {
        id: "gid://shopify/p/u1",
        title: "Trail Shoe",
        description: { html: "<p>Grippy</p>" },
        options: [{ name: "Color", values: [{ label: "Black" }, { label: "Blue" }] }],
        variants: [
          { id: "v1", price: { amount: 19900, currency: "ZAR" }, checkout_url: "https://b.test/p", availability: { available: true }, seller: { name: "B" } },
        ],
      },
    };
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.params.name).toBe("get_product");
      expect(payload.params.arguments.catalog.id).toBe("gid://shopify/p/u1");
      return mcpResult(detailPayload);
    });
    const client = createGlobalCatalogClient(config, staticJwt, fetchImpl as unknown as typeof fetch);
    const detail = await client.getProduct("gid://shopify/p/u1");
    expect(detail).toMatchObject({
      upid: "gid://shopify/p/u1",
      priceMinor: 19900,
      bestOfferMerchant: "B",
      description: "<p>Grippy</p>",
      options: { Color: ["Black", "Blue"] },
    });
  });
});
