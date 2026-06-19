import { describe, expect, it, vi } from "vitest";
import { createCheckoutReporter } from "./checkout.js";
import type { ProductResult } from "./types.js";

const items: ProductResult[] = [
  { upid: "u1", title: "A", priceMinor: 1000, currency: "ZAR", checkoutUrl: "https://m.test/p1?utm_content=sess_1" },
];

describe("createCheckoutReporter", () => {
  it("reports a checkout with the upid resolved from the rendered products", () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 204 }),
    );
    const r = createCheckoutReporter({ apiBase: "https://api.test", fetchImpl: fetchImpl as unknown as typeof fetch });
    r.index(items);
    r.report("https://m.test/p1?utm_content=sess_1");

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://api.test/v1/checkout");
    expect(JSON.parse(String(init?.body))).toEqual({
      checkoutUrl: "https://m.test/p1?utm_content=sess_1",
      upid: "u1",
    });
  });

  it("does not report a URL that was never rendered", () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const r = createCheckoutReporter({ apiBase: "https://api.test", fetchImpl: fetchImpl as unknown as typeof fetch });
    r.report("https://m.test/unknown");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("swallows network errors (fire-and-forget)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    const r = createCheckoutReporter({ apiBase: "https://api.test", fetchImpl: fetchImpl as unknown as typeof fetch });
    r.index(items);
    expect(() => r.report("https://m.test/p1?utm_content=sess_1")).not.toThrow();
  });
});
