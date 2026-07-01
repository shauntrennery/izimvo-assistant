import { afterEach, describe, expect, it, vi } from "vitest";
import { createWidget } from "./widget.js";
import type { CartSummary, ProductResult } from "./types.js";

function getShadow() {
  const host = document.querySelector("[data-izimvo-widget]");
  return (host as HTMLElement | null)?.shadowRoot ?? null;
}

afterEach(() => {
  document.querySelectorAll("[data-izimvo-widget]").forEach((n) => n.remove());
});

const items: ProductResult[] = [
  { upid: "u1", title: "Cloud Trail", priceMinor: 199900, currency: "ZAR", checkoutUrl: "https://m.test/p1?utm_source=izimvo", bestOfferMerchant: "RunCo" },
];

describe("createWidget", () => {
  it("mounts inside a Shadow DOM (host CSS isolation)", () => {
    createWidget({ reducedMotion: true });
    const host = document.querySelector("[data-izimvo-widget]");
    expect(host).not.toBeNull();
    expect((host as HTMLElement).shadowRoot).not.toBeNull();
    // The orb lives in the shadow tree, not the light DOM.
    expect(document.querySelector(".orb")).toBeNull();
    expect(getShadow()?.querySelector(".orb")).not.toBeNull();
  });

  it("reflects status onto the orb", () => {
    const w = createWidget({ reducedMotion: true });
    w.setStatus("listening");
    const orb = getShadow()?.querySelector(".orb") as HTMLElement;
    expect(orb.dataset.status).toBe("listening");
    expect(orb.textContent).toContain("Listening");
  });

  it("renders product cards with formatted price; click opens + beacons checkout", () => {
    const openUrl = vi.fn();
    const onCheckout = vi.fn();
    const w = createWidget({ reducedMotion: true, openUrl, onCheckout });
    w.showCards(items);
    const shadow = getShadow()!;
    const cards = shadow.querySelectorAll(".card");
    expect(cards).toHaveLength(1);
    expect(shadow.querySelector(".title")?.textContent).toBe("Cloud Trail");
    expect(shadow.querySelector(".price")?.textContent).toContain("1");
    expect(shadow.querySelector(".panel")?.classList.contains("open")).toBe(true);

    (shadow.querySelector(".card button") as HTMLButtonElement).click();
    expect(openUrl).toHaveBeenCalledWith("https://m.test/p1?utm_source=izimvo");
    expect(onCheckout).toHaveBeenCalledWith("https://m.test/p1?utm_source=izimvo");
  });

  it("renders the cart with a total and a checkout button that opens + beacons", () => {
    const openUrl = vi.fn();
    const onCheckout = vi.fn();
    const w = createWidget({ reducedMotion: true, openUrl, onCheckout });
    const cart: CartSummary = {
      cartId: "cart-1",
      lines: [
        { productId: "p1", title: "Form Dining Chair", quantity: 2, subtotalMinor: 20000, currency: "GBP" },
      ],
      totalQuantity: 2,
      subtotalMinor: 20000,
      currency: "GBP",
      checkoutUrl: "https://www.danetti.test/cart/c/cart-1?key=abc&utm_source=izimvo",
    };
    w.showCart(cart);
    const shadow = getShadow()!;
    expect(shadow.querySelector(".cart-title")?.textContent).toBe("Your cart (2)");
    expect(shadow.querySelector(".cart .line .name")?.textContent).toContain("×2");
    expect(shadow.querySelector(".cart .total")?.textContent).toContain("Total");
    expect(shadow.querySelector(".panel")?.classList.contains("open")).toBe(true);

    (shadow.querySelector(".cart .checkout") as HTMLButtonElement).click();
    expect(openUrl).toHaveBeenCalledWith(cart.checkoutUrl);
    expect(onCheckout).toHaveBeenCalledWith(cart.checkoutUrl);
  });

  it("hides the cart section when the cart is empty", () => {
    const w = createWidget({ reducedMotion: true });
    w.showCart({ cartId: "c", lines: [], totalQuantity: 0, subtotalMinor: 0, currency: "GBP", checkoutUrl: "" });
    const shadow = getShadow()!;
    expect(shadow.querySelector(".cart")?.classList.contains("open")).toBe(false);
    expect(shadow.querySelector(".panel")?.classList.contains("open")).toBe(false);
  });

  it("invokes the activate callback on orb tap", () => {
    const cb = vi.fn();
    const w = createWidget({ reducedMotion: true });
    w.onActivate(cb);
    (getShadow()?.querySelector(".orb") as HTMLButtonElement).click();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("destroy removes the host", () => {
    const w = createWidget({ reducedMotion: true });
    w.destroy();
    expect(document.querySelector("[data-izimvo-widget]")).toBeNull();
  });
});
