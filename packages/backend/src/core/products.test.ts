import { describe, expect, it } from "vitest";
import {
  clusteredToResults,
  selectBestOffer,
  type ClusteredProduct,
} from "./products.js";

const offers = [
  { merchant: "A", priceMinor: 25000, currency: "ZAR", checkoutUrl: "https://a.test/p", shipsTo: ["ZA"] },
  { merchant: "B", priceMinor: 19900, currency: "ZAR", checkoutUrl: "https://b.test/p", shipsTo: ["ZA", "NA"] },
  { merchant: "C", priceMinor: 15000, currency: "ZAR", checkoutUrl: "https://c.test/p", shipsTo: ["US"] },
];

describe("selectBestOffer", () => {
  it("picks the lowest-priced eligible offer", () => {
    expect(selectBestOffer(offers, { shipsTo: "ZA" })?.merchant).toBe("B");
  });
  it("respects the budget ceiling", () => {
    // ceiling 20000: A (25000) excluded, B (19900) wins
    expect(selectBestOffer(offers, { shipsTo: "ZA", maxPriceMinor: 20000 })?.merchant).toBe("B");
    // ceiling below every ZA offer → none eligible
    expect(selectBestOffer(offers, { shipsTo: "ZA", maxPriceMinor: 10000 })).toBeNull();
  });
  it("excludes offers that do not ship to the country", () => {
    // C is cheapest but US-only.
    expect(selectBestOffer(offers, { shipsTo: "ZA" })?.merchant).not.toBe("C");
  });
});

describe("clusteredToResults", () => {
  const products: ClusteredProduct[] = [
    { upid: "u1", title: "Shoe 1", offers: [offers[1]!] },
    { upid: "u2", title: "Shoe 2", offers: [offers[2]!] }, // US-only → dropped for ZA
    { upid: "u3", title: "Shoe 3", offers: [offers[0]!] },
    { upid: "u4", title: "Shoe 4", offers: [offers[1]!] },
  ];

  it("caps to the limit and drops products with no eligible offer", () => {
    const r = clusteredToResults(products, { shipsTo: "ZA", limit: 3 });
    expect(r.map((x) => x.upid)).toEqual(["u1", "u3", "u4"]);
  });

  it("maps the best offer fields onto the result", () => {
    const [first] = clusteredToResults(products, { shipsTo: "ZA", limit: 3 });
    expect(first).toMatchObject({
      upid: "u1",
      priceMinor: 19900,
      currency: "ZAR",
      bestOfferMerchant: "B",
      checkoutUrl: "https://b.test/p",
    });
  });
});
