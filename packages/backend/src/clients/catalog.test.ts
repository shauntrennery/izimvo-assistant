import { describe, expect, it, vi } from "vitest";
import type { JwtProvider } from "./jwtCache.js";
import { createGlobalCatalogClient, CatalogError } from "./catalog.js";

const staticJwt: JwtProvider = { async getToken() { return "jwt-123"; } };
const config = { mcpUrl: "https://catalog.shopify.test/mcp" };

function mcpResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const clustered = {
  result: {
    products: [
      {
        upid: "u1",
        title: "Trail Shoe",
        imageUrl: "https://img.test/1.jpg",
        offers: [
          { merchant: "A", priceMinor: 25000, currency: "ZAR", checkoutUrl: "https://a.test/p", shipsTo: ["ZA"] },
          { merchant: "B", priceMinor: 19900, currency: "ZAR", checkoutUrl: "https://b.test/p", shipsTo: ["ZA"] },
        ],
      },
    ],
  },
};

describe("createGlobalCatalogClient.search", () => {
  it("calls the MCP tool with the bearer JWT and maps clustered offers", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(config.mcpUrl);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer jwt-123");
      const payload = JSON.parse(String(init?.body));
      expect(payload.method).toBe("tools/call");
      expect(payload.params.name).toBe("search_global_products");
      expect(payload.params.arguments.saved_catalog).toBe("trail-running-za");
      return mcpResponse(clustered);
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
      upid: "u1",
      priceMinor: 19900, // best (lowest) offer
      bestOfferMerchant: "B",
      checkoutUrl: "https://b.test/p",
    });
  });

  it("throws CatalogError on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const client = createGlobalCatalogClient(config, staticJwt, fetchImpl as unknown as typeof fetch);
    await expect(client.search({ query: "x", limit: 3 })).rejects.toBeInstanceOf(CatalogError);
  });

  it("throws CatalogError on an unexpected response shape", async () => {
    const fetchImpl = vi.fn(async () => mcpResponse({ result: { wrong: true } }));
    const client = createGlobalCatalogClient(config, staticJwt, fetchImpl as unknown as typeof fetch);
    await expect(client.search({ query: "x", limit: 3 })).rejects.toBeInstanceOf(CatalogError);
  });
});
