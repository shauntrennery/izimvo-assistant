import type { ProductResult } from "./types.js";

/**
 * Reports a pursued checkout to the backend so the attribution row is recorded
 * (PLAN §10 Phase 4). The chosen product's UPID is resolved from the products
 * the agent last rendered — the agent's `open_checkout` only carries a URL. The
 * report is fire-and-forget: a failed beacon must never block opening checkout.
 */
export interface CheckoutReporter {
  index(items: ProductResult[]): void;
  report(checkoutUrl: string): void;
}

export function createCheckoutReporter(opts: {
  apiBase: string;
  fetchImpl?: typeof fetch;
}): CheckoutReporter {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const urlToUpid = new Map<string, string>();

  return {
    index(items) {
      for (const item of items) urlToUpid.set(item.checkoutUrl, item.upid);
    },
    report(checkoutUrl) {
      const upid = urlToUpid.get(checkoutUrl);
      if (!upid) return; // not one of our tagged results — nothing to attribute
      void fetchImpl(`${opts.apiBase}/v1/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        keepalive: true, // survive the navigation away to checkout
        body: JSON.stringify({ checkoutUrl, upid }),
      }).catch(() => undefined);
    },
  };
}
