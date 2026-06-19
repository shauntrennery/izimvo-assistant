import type { Cart } from "./cart.js";
import type { CheckoutReporter } from "./checkout.js";
import type { AgentHandle } from "./runtime.js";
import type { ProductResult } from "./types.js";
import type { Widget } from "./widget.js";

/**
 * Client tools the agent calls in the browser (PLAN §7.6). Tool args arrive as
 * `unknown` from the runtime, so each is shape-checked before use — the agent
 * is not trusted to send well-formed payloads. We deliberately keep this guard
 * code dependency-free (no zod) to protect the loader's size budget.
 */

function isProduct(v: unknown): v is ProductResult {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.upid === "string" &&
    typeof o.title === "string" &&
    typeof o.priceMinor === "number" &&
    typeof o.currency === "string" &&
    typeof o.checkoutUrl === "string"
  );
}

function parseItems(args: unknown): ProductResult[] {
  if (typeof args !== "object" || args === null) return [];
  let items = (args as { items?: unknown }).items;
  // Speechify client-tool params are scalars, so an array is delivered as a
  // JSON-encoded string. Accept either the string or an already-parsed array.
  if (typeof items === "string") {
    try {
      items = JSON.parse(items);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(items)) return [];
  return items.filter(isProduct);
}

export interface ToolDeps {
  widget: Widget;
  cart: Cart;
  checkout: CheckoutReporter;
  /** TEMP wiring beacon: reports each client-tool invocation's raw args. */
  report?: (name: string, args: unknown) => void;
}

export function registerClientTools(handle: AgentHandle, deps: ToolDeps): void {
  handle.registerTool("render_products", (args) => {
    deps.report?.("render_products", args);
    const items = parseItems(args);
    deps.checkout.index(items);
    deps.widget.showCards(items);
  });

  handle.registerTool("update_cart", (args) => {
    if (typeof args !== "object" || args === null) return;
    const o = args as Record<string, unknown>;
    if (typeof o.upid === "string" && typeof o.qty === "number") {
      deps.cart.set(o.upid, o.qty);
    }
  });

  handle.registerTool("open_checkout", (args) => {
    if (typeof args !== "object" || args === null) return;
    const url = (args as { url?: unknown }).url;
    // Only open same-safety http(s) URLs the backend already UTM-tagged.
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      deps.widget.openCheckout(url);
      deps.checkout.report(url);
    }
  });
}
