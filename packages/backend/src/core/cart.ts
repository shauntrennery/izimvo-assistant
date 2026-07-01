/**
 * Cart contracts (Storefront mode). Like ProductResult, money is always integer
 * minor units + currency — the Storefront MCP reports decimal strings, which the
 * cart client normalizes via `decimalToMinor` before it reaches the core types.
 * `checkoutUrl` is the store's real cart checkout URL; the add-to-cart route
 * UTM-tags it server-side before it leaves the backend.
 */

export interface CartLine {
  lineId: string;
  variantId: string;
  productId?: string;
  title: string;
  quantity: number;
  subtotalMinor: number;
  currency: string;
}

export interface CartSummary {
  cartId: string;
  lines: CartLine[];
  totalQuantity: number;
  subtotalMinor: number;
  currency: string;
  checkoutUrl: string;
}

export interface CartAddItem {
  variantId: string;
  quantity: number;
}

export interface CartClient {
  /** Add items to an existing cart, or create one when `cartId` is null. */
  addItems(cartId: string | null, items: CartAddItem[]): Promise<CartSummary>;
  get(cartId: string): Promise<CartSummary>;
}
