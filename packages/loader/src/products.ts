import type { ProductResult } from "./types.js";

/**
 * Polls the backend for the latest search results for this conversation and
 * surfaces them when they change. This renders cards independently of the agent
 * calling the `render_products` client tool (which is unreliable) — the search
 * tool stashes results server-side and we pull them here.
 */
export interface ProductPoller {
  start(): void;
  stop(): void;
}

export function createProductPoller(opts: {
  apiBase: string;
  conversationId: string;
  onProducts: (items: ProductResult[]) => void;
  fetchImpl?: typeof fetch;
  intervalMs?: number;
}): ProductPoller {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const intervalMs = opts.intervalMs ?? 1500;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastSig = "";

  async function tick(): Promise<void> {
    try {
      const url = `${opts.apiBase}/v1/conversation-products?cid=${encodeURIComponent(opts.conversationId)}`;
      const res = await fetchImpl(url);
      if (!res.ok) return;
      const json = (await res.json()) as { products?: ProductResult[] };
      const items = Array.isArray(json.products) ? json.products : [];
      const sig = items.map((i) => `${i.upid}:${i.priceMinor}`).join("|");
      if (items.length > 0 && sig !== lastSig) {
        lastSig = sig;
        opts.onProducts(items);
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
