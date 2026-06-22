/**
 * Country → buyer-currency mapping and the country list offered by the catalogue
 * search page. Kept in core (framework-free, no I/O) so both the voice
 * `search_products` tool and the browse endpoint resolve currency the same way —
 * a single source of truth, not two drifting maps.
 *
 * Prices always surface in the buyer's local currency for the selected country,
 * so a ZA shopper sees ZAR rather than a numerically-smaller GBP price.
 */

/** Buyer currency by ships-to country (ISO 3166-1 alpha-2; `EU` is a convenience alias). */
export const CURRENCY_BY_COUNTRY: Record<string, string> = {
  ZA: "ZAR",
  US: "USD",
  GB: "GBP",
  AU: "AUD",
  CA: "CAD",
  NZ: "NZD",
  EU: "EUR",
  DE: "EUR",
  FR: "EUR",
  IE: "EUR",
  NL: "EUR",
};

/** Currency for a country code, or undefined if we don't map it. Case-insensitive. */
export function currencyForCountry(code: string): string | undefined {
  return CURRENCY_BY_COUNTRY[code.toUpperCase()];
}

export interface Country {
  code: string;
  name: string;
}

/**
 * Countries selectable on the search page. South Africa is first because it is
 * the default; the rest are alphabetical by name. Real ISO countries only (no
 * `EU` alias) so the catalogue's `ships_to.country` filter stays valid.
 */
export const SEARCH_COUNTRIES: readonly Country[] = [
  { code: "ZA", name: "South Africa" },
  { code: "AU", name: "Australia" },
  { code: "CA", name: "Canada" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "IE", name: "Ireland" },
  { code: "NL", name: "Netherlands" },
  { code: "NZ", name: "New Zealand" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
];

/** The default ships-to country for an unscoped search (Guardrail-aligned with the voice tool). */
export const DEFAULT_COUNTRY = "ZA";
