import { describe, expect, it, vi } from "vitest";
import { createCart } from "./cart.js";
import { createCheckoutReporter } from "./checkout.js";
import { registerClientTools } from "./tools.js";
import type { AgentHandle } from "./runtime.js";
import type { Widget } from "./widget.js";

const noopCheckout = () =>
  createCheckoutReporter({ apiBase: "https://api.test", fetchImpl: vi.fn() as unknown as typeof fetch });

function fakeHandle() {
  const tools = new Map<string, (a: unknown) => unknown>();
  const handle: AgentHandle = {
    registerTool: (name, h) => tools.set(name, h),
    on: () => undefined,
    end: () => undefined,
  };
  return { handle, call: (n: string, a: unknown) => tools.get(n)?.(a) };
}

function fakeWidget() {
  return {
    setStatus: vi.fn(),
    showCards: vi.fn(),
    openCheckout: vi.fn(),
    onActivate: vi.fn(),
    destroy: vi.fn(),
  } satisfies Widget;
}

const product = {
  upid: "u1",
  title: "Shoe",
  priceMinor: 1000,
  currency: "ZAR",
  checkoutUrl: "https://m.test/p",
};

describe("registerClientTools", () => {
  it("render_products forwards valid items, drops malformed ones", () => {
    const { handle, call } = fakeHandle();
    const widget = fakeWidget();
    registerClientTools(handle, { widget, cart: createCart(), checkout: noopCheckout() });

    call("render_products", { items: [product, { bogus: true }, 42] });
    expect(widget.showCards).toHaveBeenCalledWith([product]);
  });

  it("update_cart updates quantities", () => {
    const { handle, call } = fakeHandle();
    const cart = createCart();
    registerClientTools(handle, { widget: fakeWidget(), cart, checkout: noopCheckout() });

    call("update_cart", { upid: "u1", qty: 3 });
    expect(cart.get("u1")).toBe(3);
    call("update_cart", { upid: "u1", qty: "nope" }); // ignored
    expect(cart.get("u1")).toBe(3);
  });

  it("open_checkout only opens http(s) URLs", () => {
    const { handle, call } = fakeHandle();
    const widget = fakeWidget();
    registerClientTools(handle, { widget, cart: createCart(), checkout: noopCheckout() });

    call("open_checkout", { url: "https://m.test/p?utm_source=izimvo" });
    expect(widget.openCheckout).toHaveBeenCalledWith("https://m.test/p?utm_source=izimvo");

    widget.openCheckout.mockClear();
    call("open_checkout", { url: "javascript:alert(1)" });
    expect(widget.openCheckout).not.toHaveBeenCalled();
  });
});
