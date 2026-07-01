import { z } from "zod";
import type { CartClient, CartLine, CartSummary } from "../core/cart.js";
import { decimalToMinor } from "../core/products.js";
import { callMcpTool, McpError } from "./mcp.js";

/**
 * Single-store cart client over the Storefront MCP's `update_cart` / `get_cart`
 * tools (PLAN §3 swap point). Both return the same `{ instructions, cart, errors }`
 * envelope (confirmed by probing the live server). Cart money is reported as
 * decimal strings ("100.0"), which we normalize to minor units so the rest of
 * the codebase's money convention holds.
 */

const moneySchema = z.object({
  amount: z.union([z.string(), z.number()]),
  currency: z.string(),
});
const costSchema = z
  .object({ total_amount: moneySchema, subtotal_amount: moneySchema.optional() })
  .passthrough();
const lineSchema = z
  .object({
    id: z.string(),
    quantity: z.number(),
    cost: costSchema,
    merchandise: z
      .object({
        id: z.string(),
        title: z.string().optional(),
        product: z
          .object({ id: z.string().optional(), title: z.string().optional() })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();
const cartSchema = z
  .object({
    id: z.string(),
    lines: z.array(lineSchema),
    cost: costSchema,
    total_quantity: z.number(),
    checkout_url: z.string(),
  })
  .passthrough();
const responseSchema = z
  .object({ cart: cartSchema.nullable().optional(), errors: z.array(z.unknown()).optional() })
  .passthrough();

type Cart = z.infer<typeof cartSchema>;

export class CartError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CartError";
  }
}

export interface StorefrontCartConfig {
  mcpUrl: string;
}

function toSummary(cart: Cart): CartSummary {
  const lines: CartLine[] = cart.lines.map((l) => ({
    lineId: l.id,
    variantId: l.merchandise.id,
    productId: l.merchandise.product?.id,
    title: l.merchandise.product?.title ?? l.merchandise.title ?? "",
    quantity: l.quantity,
    subtotalMinor: decimalToMinor(l.cost.total_amount.amount),
    currency: l.cost.total_amount.currency,
  }));
  return {
    cartId: cart.id,
    lines,
    totalQuantity: cart.total_quantity,
    subtotalMinor: decimalToMinor(cart.cost.total_amount.amount),
    currency: cart.cost.total_amount.currency,
    checkoutUrl: cart.checkout_url,
  };
}

export function createStorefrontCartClient(
  config: StorefrontCartConfig,
  fetchImpl: typeof fetch = fetch,
): CartClient {
  async function callCart(tool: string, args: Record<string, unknown>): Promise<CartSummary> {
    let structured: unknown;
    try {
      structured = await callMcpTool({ url: config.mcpUrl, fetchImpl }, tool, args);
    } catch (e) {
      throw new CartError(
        e instanceof Error ? e.message : `${tool} failed`,
        e instanceof McpError ? e.status : undefined,
      );
    }
    const parsed = responseSchema.safeParse(structured);
    if (!parsed.success) throw new CartError(`unexpected cart response: ${parsed.error.message}`);
    if (parsed.data.errors && parsed.data.errors.length > 0) {
      throw new CartError(`cart update failed: ${JSON.stringify(parsed.data.errors)}`);
    }
    if (!parsed.data.cart) throw new CartError(`${tool} returned no cart`);
    return toSummary(parsed.data.cart);
  }

  return {
    async addItems(cartId, items) {
      const args: Record<string, unknown> = {
        add_items: items.map((i) => ({ product_variant_id: i.variantId, quantity: i.quantity })),
      };
      if (cartId) args.cart_id = cartId;
      return callCart("update_cart", args);
    },
    async get(cartId) {
      return callCart("get_cart", { cart_id: cartId });
    },
  };
}
