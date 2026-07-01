import type { CartSummary } from "./types.js";

/**
 * Polls the backend for the current cart for this conversation, so the widget
 * reflects add_to_cart actions the agent takes server-side — without depending
 * on a client tool. Mirrors the product poller; the cart itself lives on Shopify,
 * this only surfaces the summary the add-to-cart tool stashed.
 */
export interface CartPoller {
  start(): void;
  stop(): void;
}

export function createCartPoller(opts: {
  apiBase: string;
  conversationId: string;
  onCart: (cart: CartSummary) => void;
  fetchImpl?: typeof fetch;
  intervalMs?: number;
}): CartPoller {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const intervalMs = opts.intervalMs ?? 1500;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastSig = "";

  async function tick(): Promise<void> {
    try {
      const url = `${opts.apiBase}/v1/conversation-cart?cid=${encodeURIComponent(opts.conversationId)}`;
      const res = await fetchImpl(url);
      if (!res.ok) return;
      const json = (await res.json()) as { cart?: CartSummary | null };
      const cart = json.cart;
      if (!cart || cart.totalQuantity <= 0) return;
      const sig = `${cart.cartId}:${cart.totalQuantity}:${cart.subtotalMinor}`;
      if (sig !== lastSig) {
        lastSig = sig;
        opts.onCart(cart);
      }
    } catch {
      /* transient; next tick retries */
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => void tick(), intervalMs);
      void tick();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
