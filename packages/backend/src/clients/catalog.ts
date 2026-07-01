import { z } from "zod";
import {
  clusteredToResults,
  decimalToMinor,
  type CatalogClient,
  type CatalogSearchInput,
  type ClusteredProduct,
  type ProductDetail,
} from "../core/products.js";
import type { JwtProvider } from "./jwtCache.js";
import { callMcpTool, McpError, pick } from "./mcp.js";

/**
 * Global Catalog client (PLAN §7.5), implemented against Shopify's UCP Catalog
 * MCP (`https://catalog.shopify.com/api/ucp/mcp`). The wire contract below was
 * confirmed by probing the live server, not just the docs:
 *  - JSON-RPC 2.0 `tools/call`; tools `search_catalog` / `get_product`.
 *  - tool args are wrapped in a `catalog` object.
 *  - EVERY call must carry the agent's UCP profile at
 *    `params.arguments.meta["ucp-agent"].profile` (not params.meta / _meta).
 *  - results: `result.structuredContent.products[]`, each product clustering
 *    multi-seller `variants[]` with `price.{amount(minor),currency}`,
 *    `checkout_url`, `availability.available`, `seller.name`.
 * Best-offer selection + the ≤limit cap stay in core/products. Swapping to the
 * Storefront Catalog is a one-file change behind the CatalogClient interface.
 */

const moneySchema = z.object({ amount: z.number(), currency: z.string() });
const variantSchema = z
  .object({
    id: z.string(),
    price: moneySchema,
    checkout_url: z.string().optional(),
    availability: z.object({ available: z.boolean().optional() }).optional(),
    seller: z.object({ name: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();
const mediaSchema = z.object({ type: z.string(), url: z.string() }).passthrough();
const optionSchema = z
  .object({ name: z.string(), values: z.array(z.object({ label: z.string() }).passthrough()) })
  .passthrough();
const productSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.object({ html: z.string().optional() }).passthrough().optional(),
    media: z.array(mediaSchema).optional(),
    options: z.array(optionSchema).optional(),
    variants: z.array(variantSchema),
  })
  .passthrough();

const searchStructured = z.object({ products: z.array(productSchema) }).passthrough();
const detailStructured = z.object({ product: productSchema }).passthrough();

type Product = z.infer<typeof productSchema>;

export interface CatalogConfig {
  mcpUrl: string;
  /** UCP agent profile URL sent on every call for capability negotiation. */
  agentProfileUrl: string;
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

/** Pull the first UCP error message (`messages[].content`) from structuredContent, if any. */
function ucpErrorMessage(structured: unknown): string | null {
  const messages = pick(structured, "messages");
  if (!Array.isArray(messages)) return null;
  const err = messages.find((m) => (m as { type?: unknown })?.type === "error");
  const content = (err as { content?: unknown } | undefined)?.content;
  return typeof content === "string" ? content : null;
}

interface ClusterOpts {
  /**
   * Synthesize a checkout URL for variants the catalog returns without one. The
   * Global Catalog ships per-merchant `checkout_url`; the single-store Storefront
   * MCP omits it (you build a cart permalink from the variant id instead).
   */
  checkoutUrlFor?: (variantId: string) => string | undefined;
  /** Fallback merchant when a variant carries no seller (single-store Storefront). */
  defaultMerchant?: string;
}

/** Map a UCP product (multi-seller variants) to a core ClusteredProduct. */
function toClustered(p: Product, opts: ClusterOpts = {}): ClusteredProduct {
  const image = p.media?.find((m) => m.type === "image")?.url;
  const offers = p.variants
    .map((v) => ({ v, url: v.checkout_url ?? opts.checkoutUrlFor?.(v.id) }))
    .filter(({ v, url }) => v.availability?.available !== false && !!url)
    .map(({ v, url }) => ({
      merchant: v.seller?.name ?? opts.defaultMerchant ?? "",
      priceMinor: v.price.amount,
      currency: v.price.currency,
      checkoutUrl: url as string,
      variantId: v.id,
    }));
  return { upid: p.id, title: p.title, imageUrl: image, offers };
}

interface UcpClientOptions extends CatalogConfig {
  /** Bearer-token provider (Global Catalog). Omit for the public Storefront MCP. */
  jwt?: JwtProvider;
  /** Detail tool name: `get_product` (Global) vs `get_product_details` (Storefront). */
  detailTool: string;
  /** Build a checkout URL from a variant id when the catalog omits one (Storefront). */
  checkoutUrlFor?: (variantId: string) => string | undefined;
  /** Fallback merchant name when variants carry no seller (single-store Storefront). */
  defaultMerchant?: string;
  fetchImpl: typeof fetch;
}

/**
 * Shared client over the `dev.ucp.shopping.catalog.search` capability. Both
 * Shopify catalogs — cross-merchant Global and single-store Storefront — speak
 * the same wire contract; they differ only in URL, auth (Bearer JWT vs none),
 * the detail tool name, and how the payload is wrapped. All four are parameters.
 */
function createUcpCatalogClient(o: UcpClientOptions): CatalogClient {
  const { fetchImpl } = o;
  const jwt = o.jwt;
  async function call(name: string, catalogArgs: Record<string, unknown>): Promise<unknown> {
    const args = { ...catalogArgs, meta: { "ucp-agent": { profile: o.agentProfileUrl } } };
    try {
      return await callMcpTool(
        { url: o.mcpUrl, fetchImpl, authToken: jwt ? () => jwt.getToken() : undefined },
        name,
        args,
      );
    } catch (e) {
      throw new CatalogError(
        e instanceof Error ? e.message : `catalog ${name} failed`,
        e instanceof McpError ? e.status : undefined,
      );
    }
  }

  return {
    async search(input: CatalogSearchInput) {
      const context: Record<string, unknown> = {};
      if (input.shipsTo) context.address_country = input.shipsTo;
      if (input.currency) context.currency = input.currency;

      const catalog: Record<string, unknown> = {
        query: input.query,
        filters: {
          available: true,
          ...(input.shipsTo ? { ships_to: { country: input.shipsTo } } : {}),
          ...(input.maxPriceMinor !== undefined ? { price: { max: input.maxPriceMinor } } : {}),
        },
        pagination: { limit: input.limit },
      };
      if (Object.keys(context).length > 0) catalog.context = context;
      if (input.savedCatalogSlug) catalog.saved_catalog_slug = input.savedCatalogSlug;

      const structured = await call("search_catalog", { catalog });
      const parsed = searchStructured.safeParse(structured);
      if (!parsed.success) {
        // Surface a UCP error message (e.g. unknown saved_catalog_slug) if present.
        const msg = ucpErrorMessage(structured) ?? parsed.error.message;
        throw new CatalogError(`catalog search response not usable: ${msg}`);
      }
      const clustered = parsed.data.products.map((pp) =>
        toClustered(pp, { checkoutUrlFor: o.checkoutUrlFor, defaultMerchant: o.defaultMerchant }),
      );
      return clusteredToResults(clustered, {
        maxPriceMinor: input.maxPriceMinor,
        shipsTo: undefined, // already filtered server-side via filters.ships_to
        preferCurrency: input.currency,
        strictCurrency: input.currency !== undefined, // only show the buyer's currency
        limit: input.limit,
      });
    },

    async getProduct(upid: string): Promise<ProductDetail> {
      const structured = await call(o.detailTool, { catalog: { id: upid } });
      const parsed = detailStructured.safeParse(structured);
      if (!parsed.success) {
        throw new CatalogError(`unexpected catalog detail response: ${parsed.error.message}`);
      }
      const p = parsed.data.product;
      const clustered = toClustered(p, {
        checkoutUrlFor: o.checkoutUrlFor,
        defaultMerchant: o.defaultMerchant,
      });
      const [best] = clusteredToResults([clustered], { limit: 1 });
      if (!best) throw new CatalogError(`product ${upid} has no available offers`);

      const options = p.options
        ? Object.fromEntries(p.options.map((opt) => [opt.name, opt.values.map((v) => v.label)]))
        : undefined;
      return { ...best, description: p.description?.html, options };
    },
  };
}

/**
 * Cross-merchant Global Catalog client (PLAN §7.5): Bearer-JWT auth against the
 * shared `catalog.shopify.com` MCP, `get_product` for detail.
 */
export function createGlobalCatalogClient(
  config: CatalogConfig,
  jwt: JwtProvider,
  fetchImpl: typeof fetch = fetch,
): CatalogClient {
  return createUcpCatalogClient({ ...config, jwt, detailTool: "get_product", fetchImpl });
}

/**
 * Storefront `get_product_details` uses the native Shopify shape, NOT the UCP
 * `search_catalog` one: `product_id` request; `selectedOrFirstAvailableVariant`
 * (variant GID + decimal price), plain-string description, `options[].values`.
 * (Confirmed by probing the live server — sending `catalog.id` errors with
 * "Missing required arguments: product_id".)
 */
const storefrontVariantSchema = z
  .object({
    variant_id: z.string(),
    price: z.union([z.string(), z.number()]),
    currency: z.string(),
    available: z.boolean().optional(),
    image_url: z.string().optional(),
  })
  .passthrough();
const storefrontDetailSchema = z
  .object({
    product: z
      .object({
        product_id: z.string(),
        title: z.string(),
        description: z.string().optional(),
        image_url: z.string().optional(),
        options: z
          .array(z.object({ name: z.string(), values: z.array(z.string()) }).passthrough())
          .optional(),
        selectedOrFirstAvailableVariant: storefrontVariantSchema.optional(),
      })
      .passthrough(),
  })
  .passthrough();

interface StorefrontDetailOpts {
  mcpUrl: string;
  fetchImpl: typeof fetch;
  merchantName?: string;
  defaultCountry?: string;
  checkoutUrlFor: (variantId: string) => string | undefined;
}

async function storefrontGetProduct(
  o: StorefrontDetailOpts,
  upid: string,
  selectedOptions?: Record<string, string>,
): Promise<ProductDetail> {
  const args: Record<string, unknown> = { product_id: upid };
  if (selectedOptions && Object.keys(selectedOptions).length > 0) args.options = selectedOptions;
  if (o.defaultCountry) args.country = o.defaultCountry;

  let structured: unknown;
  try {
    structured = await callMcpTool(
      { url: o.mcpUrl, fetchImpl: o.fetchImpl },
      "get_product_details",
      args,
    );
  } catch (e) {
    throw new CatalogError(
      e instanceof Error ? e.message : "get_product_details failed",
      e instanceof McpError ? e.status : undefined,
    );
  }

  const parsed = storefrontDetailSchema.safeParse(structured);
  if (!parsed.success) {
    const msg = ucpErrorMessage(structured) ?? parsed.error.message;
    throw new CatalogError(`unexpected product detail response: ${msg}`);
  }
  const p = parsed.data.product;
  const variant = p.selectedOrFirstAvailableVariant;
  if (!variant) throw new CatalogError(`product ${upid} has no available variant`);

  const options = p.options
    ? Object.fromEntries(p.options.map((opt) => [opt.name, opt.values]))
    : undefined;
  return {
    upid: p.product_id,
    title: p.title,
    priceMinor: decimalToMinor(variant.price),
    currency: variant.currency,
    imageUrl: variant.image_url ?? p.image_url,
    bestOfferMerchant: o.merchantName ?? "",
    checkoutUrl: o.checkoutUrlFor(variant.variant_id) ?? "",
    variantId: variant.variant_id,
    description: p.description,
    options,
  };
}

/**
 * Single-store Storefront Catalog client (PLAN §3 swap point): the store's own
 * public `/api/mcp` endpoint — no auth. Search uses the UCP `search_catalog`
 * capability (shared client); detail uses the native `get_product_details` tool
 * (different wire shape, handled by `storefrontGetProduct`). Scopes the adviser
 * to one merchant so recommendations and checkout stay on that store.
 */
export function createStorefrontCatalogClient(
  config: CatalogConfig & { merchantName?: string; defaultCountry?: string },
  fetchImpl: typeof fetch = fetch,
): CatalogClient {
  // The Storefront MCP returns no checkout_url; build a Shopify cart permalink
  // (`/cart/{variantId}:{qty}`) from the variant GID's numeric id instead.
  const origin = new URL(config.mcpUrl).origin;
  const checkoutUrlFor = (variantId: string): string | undefined => {
    const numeric = variantId.split("/").pop()?.split("?")[0];
    return numeric && /^\d+$/.test(numeric) ? `${origin}/cart/${numeric}:1` : undefined;
  };
  const ucp = createUcpCatalogClient({
    mcpUrl: config.mcpUrl,
    agentProfileUrl: config.agentProfileUrl,
    detailTool: "get_product_details", // unused: storefront overrides getProduct below
    checkoutUrlFor,
    defaultMerchant: config.merchantName,
    fetchImpl,
  });
  return {
    search: ucp.search,
    getProduct: (upid, options) =>
      storefrontGetProduct(
        {
          mcpUrl: config.mcpUrl,
          fetchImpl,
          merchantName: config.merchantName,
          defaultCountry: config.defaultCountry,
          checkoutUrlFor,
        },
        upid,
        options,
      ),
  };
}
