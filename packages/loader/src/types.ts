/**
 * Browser-side contracts. ProductResult mirrors the backend's shape (PLAN §7.4)
 * — the loader receives these already UTM-tagged and ≤3 in count; it never
 * computes prices, scopes, or checkout URLs itself.
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

/** Parsed from the host `<script>` data-* attributes (PLAN §7.1). */
export interface LoaderConfig {
  siteKey: string;
  category?: string;
  userId?: string;
  locale?: string;
}

/** Orb visual states, driven by the agent runtime's status events. */
export type OrbStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "ended" | "error";
