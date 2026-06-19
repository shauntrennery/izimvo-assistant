import { describe, expect, it, vi } from "vitest";
import { createProductPoller } from "./products.js";
import type { ProductResult } from "./types.js";

const products: ProductResult[] = [
  { upid: "u1", title: "Shoe", priceMinor: 19900, currency: "ZAR", checkoutUrl: "https://m.test/p1" },
];

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("createProductPoller", () => {
  it("surfaces products on the first poll, once", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ products }));
    const seen: ProductResult[][] = [];
    const p = createProductPoller({
      apiBase: "https://api.test",
      conversationId: "cid-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      intervalMs: 10,
      onProducts: (items) => seen.push(items),
    });
    p.start();
    await vi.waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(1));
    p.stop();
    expect(seen[0]).toEqual(products);
    // same results on later polls don't re-fire
    const count = seen.length;
    await new Promise((r) => setTimeout(r, 30));
    expect(seen.length).toBe(count);
  });

  it("queries the conversation-products endpoint with the cid", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request) => jsonResponse({ products: [] }));
    const p = createProductPoller({
      apiBase: "https://api.test",
      conversationId: "cid-xyz",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onProducts: () => undefined,
    });
    p.start();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    p.stop();
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      "https://api.test/v1/conversation-products?cid=cid-xyz",
    );
  });
});
