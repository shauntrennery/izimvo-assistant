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

const pick = (o: unknown, k: string): unknown =>
  typeof o === "object" && o !== null ? (o as Record<string, unknown>)[k] : undefined;

/** Pull the first UCP error message (`messages[].content`) from structuredContent, if any. */
function ucpErrorMessage(structured: unknown): string | null {
  const messages = pick(structured, "messages");
  if (!Array.isArray(messages)) return null;
  const err = messages.find((m) => (m as { type?: unknown })?.type === "error");
  const content = (err as { content?: unknown } | undefined)?.content;
  return typeof content === "string" ? content : null;
}

/** Streamable-HTTP MCP may answer as JSON or as an SSE `data:` frame. */
function parseEnvelope(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const data = text
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("");
    if (data) {
      try {
        return JSON.parse(data);
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

/**
 * Extract the UCP payload from a JSON-RPC tool result. The cross-merchant Global
 * Catalog MCP returns it as `result.structuredContent`; the per-store Storefront
 * MCP returns the same payload as a JSON string in `result.content[].text`.
 * Accept either so both catalogs share one client.
 */
function extractStructured(env: unknown): unknown {
  const result = pick(env, "result");
  const structured = pick(result, "structuredContent");
  if (structured !== undefined) return structured;
  const content = pick(result, "content");
  if (Array.isArray(content)) {
    const node = content.find((c) => pick(c, "type") === "text");
    const text = pick(node, "text");
    if (typeof text === "string") return parseEnvelope(text);
  }
  return undefined;
}

/** Map a UCP product (multi-seller variants) to a core ClusteredProduct. */
function toClustered(p: Product): ClusteredProduct {
  const image = p.media?.find((m) => m.type === "image")?.url;
  const offers = p.variants
    .filter((v) => v.availability?.available !== false && !!v.checkout_url)
    .map((v) => ({
      merchant: v.seller?.name ?? "Unknown",
      priceMinor: v.price.amount,
      currency: v.price.currency,
      checkoutUrl: v.checkout_url as string,
    }));
  return { upid: p.id, title: p.title, imageUrl: image, offers };
}

interface UcpClientOptions extends CatalogConfig {
  /** Bearer-token provider (Global Catalog). Omit for the public Storefront MCP. */
  jwt?: JwtProvider;
  /** Detail tool name: `get_product` (Global) vs `get_product_details` (Storefront). */
  detailTool: string;
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
  async function call(name: string, catalogArgs: Record<string, unknown>): Promise<unknown> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (o.jwt) headers.authorization = `Bearer ${await o.jwt.getToken()}`;
    const res = await fetchImpl(o.mcpUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name,
          arguments: { ...catalogArgs, meta: { "ucp-agent": { profile: o.agentProfileUrl } } },
        },
      }),
    });
    if (!res.ok) {
      throw new CatalogError(`catalog ${name} failed: ${res.status}`, res.status);
    }
    const env = parseEnvelope(await res.text());
    const rpcError = pick(env, "error");
    if (rpcError) {
      throw new CatalogError(`catalog ${name} error: ${JSON.stringify(rpcError)}`);
    }
    return extractStructured(env);
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
      return clusteredToResults(parsed.data.products.map(toClustered), {
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
      const [best] = clusteredToResults([toClustered(p)], { limit: 1 });
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
 * Single-store Storefront Catalog client (PLAN §3 swap point): the store's own
 * public `{store}.myshopify.com/api/mcp` endpoint — no auth, `get_product_details`
 * for detail. Scopes the adviser to one merchant's catalog so recommendations and
 * checkout stay on that store.
 */
export function createStorefrontCatalogClient(
  config: CatalogConfig,
  fetchImpl: typeof fetch = fetch,
): CatalogClient {
  return createUcpCatalogClient({ ...config, detailTool: "get_product_details", fetchImpl });
}
