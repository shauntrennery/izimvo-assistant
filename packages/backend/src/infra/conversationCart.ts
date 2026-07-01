import type { CartSummary } from "../core/cart.js";

/**
 * The Storefront cart id + last summary per conversation. The add-to-cart tool
 * needs the cart id to append to an existing cart across turns; the loader polls
 * the summary via GET /v1/conversation-cart?cid= to render the cart. In-memory +
 * TTL matches conversationProducts — fine for a single instance; move to Redis
 * when scaling horizontally (the cart itself lives on Shopify, so only this
 * cid→cartId mapping is lost on restart).
 */
interface Entry {
  cartId: string;
  summary: CartSummary;
  ts: number;
}

const store = new Map<string, Entry>();
const TTL_MS = 60 * 60_000; // 1h — a shopping session may span longer than a search

export function putConversationCart(cid: string, summary: CartSummary): void {
  store.set(cid, { cartId: summary.cartId, summary, ts: Date.now() });
}

export function getConversationCartId(cid: string): string | null {
  const entry = store.get(cid);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) {
    store.delete(cid);
    return null;
  }
  return entry.cartId;
}

export function getConversationCart(cid: string): CartSummary | null {
  const entry = store.get(cid);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) {
    store.delete(cid);
    return null;
  }
  return entry.summary;
}
