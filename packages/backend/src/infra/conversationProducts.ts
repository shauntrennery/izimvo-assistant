import type { ProductResult } from "../core/products.js";

/**
 * Latest search results per conversation, so the loader can render cards by
 * polling rather than depending on the LLM to call the `render_products` client
 * tool (which it does not do reliably). The search tool writes here; the loader
 * reads via GET /v1/conversation-products?cid=. In-memory + TTL is fine for a
 * single instance; move to Redis when scaling horizontally.
 */
interface Entry {
  products: ProductResult[];
  ts: number;
}

const store = new Map<string, Entry>();
const TTL_MS = 15 * 60_000;

export function putConversationProducts(cid: string, products: ProductResult[]): void {
  store.set(cid, { products, ts: Date.now() });
}

export function getConversationProducts(cid: string): ProductResult[] {
  const entry = store.get(cid);
  if (!entry) return [];
  if (Date.now() - entry.ts > TTL_MS) {
    store.delete(cid);
    return [];
  }
  return entry.products;
}
