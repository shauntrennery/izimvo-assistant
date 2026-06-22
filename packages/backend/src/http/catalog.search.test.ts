import { describe, expect, it } from "vitest";
import type { ProductResult } from "../core/products.js";
import { createFakeCatalog } from "../test/fakes.js";
import { buildApp } from "../test/buildApp.js";

/**
 * Contract for GET /v1/catalog/search — the browse endpoint behind the search
 * page. Country is the primary filter (defaults to South Africa) and drives the
 * buyer currency; max_price is converted to minor units like the voice tool.
 */

const sample: ProductResult[] = [
  {
    upid: "p1",
    title: "Trail Shoe",
    priceMinor: 199900,
    currency: "ZAR",
    bestOfferMerchant: "Acme",
    checkoutUrl: "https://shop.example/p1",
  },
];

describe("GET /v1/catalog/search", () => {
  it("returns products and defaults the country to South Africa (ZAR)", async () => {
    const catalog = createFakeCatalog(sample);
    const { app } = buildApp({ catalog });

    const res = await app.request("/v1/catalog/search?q=shoes");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { products: ProductResult[]; country: string; currency: string };
    expect(body.products).toHaveLength(1);
    expect(body.country).toBe("ZA");
    expect(body.currency).toBe("ZAR");
    expect(catalog.lastInput?.shipsTo).toBe("ZA");
    expect(catalog.lastInput?.currency).toBe("ZAR");
  });

  it("honours the selected country and its currency", async () => {
    const catalog = createFakeCatalog(sample);
    const { app } = buildApp({ catalog });

    const res = await app.request("/v1/catalog/search?q=shoes&country=gb");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { country: string; currency: string };
    expect(body.country).toBe("GB");
    expect(body.currency).toBe("GBP");
    expect(catalog.lastInput?.shipsTo).toBe("GB");
    expect(catalog.lastInput?.currency).toBe("GBP");
  });

  it("converts max_price from major to minor units", async () => {
    const catalog = createFakeCatalog(sample);
    const { app } = buildApp({ catalog });

    await app.request("/v1/catalog/search?q=shoes&max_price=2000");
    expect(catalog.lastInput?.maxPriceMinor).toBe(200000);
  });

  it("400s when the query is missing", async () => {
    const { app } = buildApp({ catalog: createFakeCatalog(sample) });
    const res = await app.request("/v1/catalog/search");
    expect(res.status).toBe(400);
  });

  it("502s with an empty list when the catalog fails", async () => {
    const failing = {
      lastInput: null,
      async search() {
        throw new Error("mcp down");
      },
      async getProduct() {
        throw new Error("unused");
      },
    };
    const { app } = buildApp({ catalog: failing as never });

    const res = await app.request("/v1/catalog/search?q=shoes");
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; products: ProductResult[] };
    expect(body.error).toBe("catalog_unavailable");
    expect(body.products).toEqual([]);
  });
});

describe("GET /search", () => {
  it("serves the search page as HTML with the country filter", async () => {
    const { app } = buildApp();
    const res = await app.request("/search");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("South Africa");
    expect(html).toContain('id="country"');
  });
});
