import type { OrbStatus, ProductResult } from "./types.js";

/**
 * The widget UI. Everything lives inside a Shadow DOM (Guardrail §11.11) so the
 * host page's CSS can neither bleed in nor leak out. The orb is the only
 * affordance until a user gesture; product cards are painted as the adviser
 * talks (≤3 from the backend, though the card list itself imposes no cap).
 */

export interface Widget {
  setStatus(status: OrbStatus): void;
  showCards(items: ProductResult[]): void;
  openCheckout(url: string): void;
  /** Register the user-gesture handler (orb tap) — required for mic/audio. */
  onActivate(cb: () => void): void;
  destroy(): void;
}

export interface WidgetOptions {
  doc?: Document;
  /** Injectable so tests can assert without a real popup; defaults to window.open. */
  openUrl?: (url: string) => void;
  /** Invoked when the user pursues a checkout from a card (attribution beacon). */
  onCheckout?: (url: string) => void;
  reducedMotion?: boolean;
}

const STATUS_LABEL: Record<OrbStatus, string> = {
  idle: "Tap to talk",
  connecting: "Connecting…",
  listening: "Listening — tap to end",
  thinking: "Thinking…",
  speaking: "Speaking — tap to end",
  ended: "Tap to talk again",
  error: "Tap to retry",
};

function styles(reducedMotion: boolean): string {
  return `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
    .root { position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
      display: flex; flex-direction: column; align-items: flex-end; gap: 12px; }
    .panel { display: none; width: 320px; max-width: calc(100vw - 40px);
      background: #fff; color: #16181d; border-radius: 16px; padding: 12px;
      box-shadow: 0 12px 40px rgba(0,0,0,.18); max-height: 60vh; overflow: auto; }
    .panel.open { display: block; }
    .cards { display: flex; flex-direction: column; gap: 10px; }
    .card { display: flex; gap: 10px; padding: 8px; border: 1px solid #eceef2; border-radius: 12px; }
    .card img { width: 56px; height: 56px; object-fit: cover; border-radius: 8px; background: #f2f3f5; }
    .card .meta { flex: 1; min-width: 0; }
    .card .title { font-weight: 600; font-size: 14px; line-height: 1.25; }
    .card .price { font-size: 13px; color: #3a3f48; margin-top: 2px; }
    .card .merchant { font-size: 12px; color: #8a909a; }
    .card button { align-self: center; border: 0; background: #111827; color: #fff;
      border-radius: 999px; padding: 8px 12px; font-size: 13px; cursor: pointer; }
    .orb { display: flex; align-items: center; gap: 10px; background: #111827; color: #fff;
      border: 0; border-radius: 999px; padding: 10px 16px; cursor: pointer;
      box-shadow: 0 8px 24px rgba(0,0,0,.22); font-size: 14px; }
    .dot { width: 12px; height: 12px; border-radius: 50%; background: #6ee7b7; }
    .orb[data-status="connecting"] .dot,
    .orb[data-status="thinking"] .dot { background: #fbbf24; }
    .orb[data-status="listening"] .dot { background: #34d399; }
    .orb[data-status="speaking"] .dot { background: #60a5fa; }
    .orb[data-status="error"] .dot { background: #f87171; }
    ${reducedMotion ? "" : `
    .orb[data-status="listening"] .dot,
    .orb[data-status="speaking"] .dot { animation: pulse 1.2s ease-in-out infinite; }
    @keyframes pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.5); opacity: .6; } }`}
  `;
}

function formatPrice(priceMinor: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(priceMinor / 100);
  } catch {
    return `${currency} ${(priceMinor / 100).toFixed(2)}`;
  }
}

export function createWidget(opts: WidgetOptions = {}): Widget {
  const doc = opts.doc ?? document;
  const reducedMotion =
    opts.reducedMotion ??
    (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const openUrl =
    opts.openUrl ?? ((url: string) => void window.open(url, "_blank", "noopener,noreferrer"));
  const locale = doc.documentElement.lang || "en-ZA";

  const host = doc.createElement("div");
  host.setAttribute("data-izimvo-widget", "");
  const shadow = host.attachShadow({ mode: "open" });

  const style = doc.createElement("style");
  style.textContent = styles(reducedMotion);

  const root = doc.createElement("div");
  root.className = "root";

  const panel = doc.createElement("div");
  panel.className = "panel";
  const cards = doc.createElement("div");
  cards.className = "cards";
  panel.appendChild(cards);

  const orb = doc.createElement("button");
  orb.className = "orb";
  orb.type = "button";
  orb.setAttribute("aria-label", "Talk to the shopping adviser");
  orb.dataset.status = "idle";
  const dot = doc.createElement("span");
  dot.className = "dot";
  const label = doc.createElement("span");
  label.className = "label";
  label.textContent = STATUS_LABEL.idle;
  orb.append(dot, label);

  root.append(panel, orb);
  shadow.append(style, root);
  doc.body.appendChild(host);

  return {
    setStatus(status) {
      orb.dataset.status = status;
      label.textContent = STATUS_LABEL[status];
    },

    showCards(items) {
      cards.replaceChildren();
      for (const item of items) {
        const card = doc.createElement("div");
        card.className = "card";

        if (item.imageUrl) {
          const img = doc.createElement("img");
          img.src = item.imageUrl;
          img.alt = "";
          card.appendChild(img);
        }

        const meta = doc.createElement("div");
        meta.className = "meta";
        const title = doc.createElement("div");
        title.className = "title";
        title.textContent = item.title;
        const price = doc.createElement("div");
        price.className = "price";
        price.textContent = formatPrice(item.priceMinor, item.currency, locale);
        meta.append(title, price);
        if (item.bestOfferMerchant) {
          const merchant = doc.createElement("div");
          merchant.className = "merchant";
          merchant.textContent = item.bestOfferMerchant;
          meta.appendChild(merchant);
        }

        const buy = doc.createElement("button");
        buy.type = "button";
        buy.textContent = "View";
        buy.addEventListener("click", () => {
          openUrl(item.checkoutUrl);
          opts.onCheckout?.(item.checkoutUrl);
        });

        card.append(meta, buy);
        cards.appendChild(card);
      }
      panel.classList.toggle("open", items.length > 0);
    },

    openCheckout(url) {
      openUrl(url);
    },

    onActivate(cb) {
      orb.addEventListener("click", cb);
    },

    destroy() {
      host.remove();
    },
  };
}
