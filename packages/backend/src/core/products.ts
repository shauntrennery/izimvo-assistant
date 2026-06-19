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
  optionPreferences?: string[];
  limit: number; // always 3 (Guardrail §11.7)
}

export interface CatalogClient {
  search(input: CatalogSearchInput): Promise<ProductResult[]>;
  getProduct(upid: string): Promise<ProductDetail>;
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
}

export interface ClusteredProduct {
  upid: string;
  title: string;
  imageUrl?: string;
  offers: CatalogOffer[];
}

/** Lowest-priced offer that ships to the requested country and is within budget. */
export function selectBestOffer(
  offers: CatalogOffer[],
  filter: { maxPriceMinor?: number; shipsTo?: string },
): CatalogOffer | null {
  const eligible = offers.filter((o) => {
    if (filter.maxPriceMinor !== undefined && o.priceMinor > filter.maxPriceMinor) {
      return false;
    }
    if (filter.shipsTo && o.shipsTo && !o.shipsTo.includes(filter.shipsTo)) {
      return false;
    }
    return true;
  });
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
  input: { maxPriceMinor?: number; shipsTo?: string; limit: number },
): ProductResult[] {
  const out: ProductResult[] = [];
  for (const p of products) {
    if (out.length >= input.limit) break;
    const offer = selectBestOffer(p.offers, {
      maxPriceMinor: input.maxPriceMinor,
      shipsTo: input.shipsTo,
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
    });
  }
  return out;
}
