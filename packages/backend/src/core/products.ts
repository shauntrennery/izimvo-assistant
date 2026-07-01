/**
 * Product contracts (PLAN §7.4, §7.5). Money is always in minor units +
 * currency — never floats. `checkoutUrl` is UTM-tagged server-side before it
 * leaves the backend.
 */

export interface ProductResult {
  upid: string;
  title: string;
  priceMinor: number;
  currency: string;
  imageUrl?: string;
  bestOfferMerchant?: string;
  checkoutUrl: string;
  /** Purchasable variant GID (Storefront mode) — what the cart's add_items needs. */
  variantId?: string;
}

/** Convert a decimal money amount ("100.0" | 100) to integer minor units. */
export function decimalToMinor(amount: string | number): number {
  const n = typeof amount === "number" ? amount : parseFloat(amount);
  if (!Number.isFinite(n)) throw new Error(`invalid money amount: ${String(amount)}`);
  return Math.round(n * 100);
}

export interface ProductDetail extends ProductResult {
  description?: string;
  options?: Record<string, string[]>;
}

export interface CatalogSearchInput {
  query: string;
  savedCatalogSlug?: string; // hard boundary filter, resolved server-side
  maxPriceMinor?: number;
  shipsTo?: string;
  currency?: string; // buyer currency (e.g. ZAR) — preferred for pricing
  optionPreferences?: string[];
  limit: number; // always 3 (Guardrail §11.7)
}

export interface CatalogClient {
  search(input: CatalogSearchInput): Promise<ProductResult[]>;
  /** `options` selects a specific variant (Storefront mode); Global ignores it. */
  getProduct(upid: string, options?: Record<string, string>): Promise<ProductDetail>;
}

/**
 * Global Catalog returns products clustered by UPID, each with multiple
 * merchant offers. Selecting the best offer per cluster is pure domain logic,
 * kept here so it's testable without the MCP transport.
 */
export interface CatalogOffer {
  merchant: string;
  priceMinor: number;
  currency: string;
  checkoutUrl: string;
  shipsTo?: string[];
  /** Underlying variant GID (Storefront mode), carried onto the ProductResult. */
  variantId?: string;
}

export interface ClusteredProduct {
  upid: string;
  title: string;
  imageUrl?: string;
  offers: CatalogOffer[];
}

/**
 * Best offer for a product. Prefers the buyer's currency (so a ZA shopper sees
 * a ZAR price, not a numerically-smaller GBP one), then applies the budget and
 * ships-to filters, then picks the lowest price — only ever comparing prices
 * within a single currency. Falls back to other currencies if none match.
 */
export function selectBestOffer(
  offers: CatalogOffer[],
  filter: {
    maxPriceMinor?: number;
    shipsTo?: string;
    preferCurrency?: string;
    /** When true, only offers in preferCurrency qualify (product dropped otherwise). */
    strictCurrency?: boolean;
  },
): CatalogOffer | null {
  const shipsOk = offers.filter(
    (o) => !filter.shipsTo || !o.shipsTo || o.shipsTo.includes(filter.shipsTo),
  );

  // Prefer the buyer's currency; when strict, require it (drop otherwise).
  let pool = shipsOk;
  if (filter.preferCurrency) {
    const inCurrency = shipsOk.filter((o) => o.currency === filter.preferCurrency);
    if (filter.strictCurrency) pool = inCurrency;
    else if (inCurrency.length > 0) pool = inCurrency;
  }

  // Budget is expressed in the buyer's currency; only enforce it within the
  // preferred-currency pool (avoids comparing, say, a ZAR ceiling to USD).
  const samePoolCurrency = pool.every((o) => o.currency === pool[0]?.currency);
  const eligible =
    filter.maxPriceMinor !== undefined && samePoolCurrency
      ? pool.filter((o) => o.priceMinor <= filter.maxPriceMinor!)
      : pool;

  if (eligible.length === 0) return null;
  return eligible.reduce((best, o) => (o.priceMinor < best.priceMinor ? o : best));
}

/**
 * Reduce clustered products to at most `limit` ProductResults, one best offer
 * each. Products with no eligible offer are dropped. checkoutUrl here is the
 * raw merchant URL — UTM tagging happens in the search route, server-side.
 */
export function clusteredToResults(
  products: ClusteredProduct[],
  input: {
    maxPriceMinor?: number;
    shipsTo?: string;
    preferCurrency?: string;
    strictCurrency?: boolean;
    limit: number;
  },
): ProductResult[] {
  const out: ProductResult[] = [];
  for (const p of products) {
    if (out.length >= input.limit) break;
    const offer = selectBestOffer(p.offers, {
      maxPriceMinor: input.maxPriceMinor,
      shipsTo: input.shipsTo,
      preferCurrency: input.preferCurrency,
      strictCurrency: input.strictCurrency,
    });
    if (!offer) continue;
    out.push({
      upid: p.upid,
      title: p.title,
      priceMinor: offer.priceMinor,
      currency: offer.currency,
      imageUrl: p.imageUrl,
      bestOfferMerchant: offer.merchant,
      checkoutUrl: offer.checkoutUrl,
      variantId: offer.variantId,
    });
  }
  return out;
}
