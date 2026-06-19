import { afterEach, describe, expect, it, vi } from "vitest";
import { createWidget } from "./widget.js";
import type { ProductResult } from "./types.js";

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

  it("renders product cards with formatted price and opens checkout on click", () => {
    const openUrl = vi.fn();
    const w = createWidget({ reducedMotion: true, openUrl });
    w.showCards(items);
    const shadow = getShadow()!;
    const cards = shadow.querySelectorAll(".card");
    expect(cards).toHaveLength(1);
    expect(shadow.querySelector(".title")?.textContent).toBe("Cloud Trail");
    expect(shadow.querySelector(".price")?.textContent).toContain("1");
    expect(shadow.querySelector(".panel")?.classList.contains("open")).toBe(true);

    (shadow.querySelector(".card button") as HTMLButtonElement).click();
    expect(openUrl).toHaveBeenCalledWith("https://m.test/p1?utm_source=izimvo");
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
