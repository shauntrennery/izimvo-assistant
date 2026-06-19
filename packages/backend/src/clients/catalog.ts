import { z } from "zod";
import {
  clusteredToResults,
  type CatalogClient,
  type CatalogSearchInput,
  type ClusteredProduct,
  type ProductDetail,
} from "../core/products.js";
import type { JwtProvider } from "./jwtCache.js";

/**
 * Global Catalog client (PLAN §7.5). Wraps the Shopify Global Catalog MCP
 * (`search_global_products` / `get_global_product_details`), authenticated with
 * the cached client-credentials JWT. Results arrive clustered by UPID with
 * multi-merchant offers; best-offer selection + the ≤limit cap live in core.
 *
 * NOTE: the MCP wire shape (JSON-RPC tools/call envelope + result schema) is
 * modelled here from the documented tool names and must be confirmed against
 * the live MCP server. It is fully isolated to this file (CLAUDE.md: one typed
 * client per external service); swapping to Storefront Catalog is a one-file
 * change behind the CatalogClient interface.
 */

const offerSchema = z.object({
  merchant: z.string(),
  priceMinor: z.number().int().nonnegative(),
  currency: z.string().length(3),
  checkoutUrl: z.string().url(),
  shipsTo: z.array(z.string()).optional(),
});

const clusteredProductSchema = z.object({
  upid: z.string(),
  title: z.string(),
  imageUrl: z.string().url().optional(),
  offers: z.array(offerSchema),
});

// JSON-RPC tools/call response envelope: { result: { products: [...] } }.
const searchResultSchema = z.object({
  result: z.object({ products: z.array(clusteredProductSchema) }),
});

const detailResultSchema = z.object({
  result: z.object({
    product: clusteredProductSchema.extend({
      description: z.string().optional(),
      options: z.record(z.array(z.string())).optional(),
    }),
  }),
});

export interface CatalogConfig {
  mcpUrl: string;
}

export class CatalogError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CatalogError";
  }
}

export function createGlobalCatalogClient(
  config: CatalogConfig,
  jwt: JwtProvider,
  fetchImpl: typeof fetch = fetch,
): CatalogClient {
  async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const token = await jwt.getToken();
    const res = await fetchImpl(config.mcpUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    if (!res.ok) {
      throw new CatalogError(`catalog ${name} failed: ${res.status}`, res.status);
    }
    return res.json();
  }

  return {
    async search(input: CatalogSearchInput) {
      const raw = await call("search_global_products", {
        query: input.query,
        saved_catalog: input.savedCatalogSlug,
        max_price_minor: input.maxPriceMinor,
        ships_to: input.shipsTo,
        option_preferences: input.optionPreferences,
        limit: input.limit,
      });
      const parsed = searchResultSchema.safeParse(raw);
      if (!parsed.success) {
        throw new CatalogError(`unexpected catalog search response: ${parsed.error.message}`);
      }
      const products: ClusteredProduct[] = parsed.data.result.products;
      return clusteredToResults(products, {
        maxPriceMinor: input.maxPriceMinor,
        shipsTo: input.shipsTo,
        limit: input.limit,
      });
    },

    async getProduct(upid: string): Promise<ProductDetail> {
      const raw = await call("get_global_product_details", { upid });
      const parsed = detailResultSchema.safeParse(raw);
      if (!parsed.success) {
        throw new CatalogError(`unexpected catalog detail response: ${parsed.error.message}`);
      }
      const p = parsed.data.result.product;
      const offer = p.offers[0];
      if (!offer) throw new CatalogError(`product ${upid} has no offers`);
      return {
        upid: p.upid,
        title: p.title,
        priceMinor: offer.priceMinor,
        currency: offer.currency,
        imageUrl: p.imageUrl,
        bestOfferMerchant: offer.merchant,
        checkoutUrl: offer.checkoutUrl,
        description: p.description,
        options: p.options,
      };
    },
  };
}
