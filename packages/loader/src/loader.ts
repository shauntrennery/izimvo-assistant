import { parseConfig } from "./attributes.js";
import { createCart, type Cart } from "./cart.js";
import { createCartPoller, type CartPoller } from "./cartPoll.js";
import { createCheckoutReporter, type CheckoutReporter } from "./checkout.js";
import { createAudioGate, type AudioGate } from "./mic.js";
import { createProductPoller, type ProductPoller } from "./products.js";
import { loadSpeechifyRuntime, toOrbStatus, type AgentHandle, type AgentRuntime } from "./runtime.js";
import { fetchSession } from "./session.js";
import { registerClientTools } from "./tools.js";
import type { LoaderConfig } from "./types.js";
import { createWidget, type Widget } from "./widget.js";

/**
 * Loader entry (PLAN §10 Phase 3). Flow: capture config → render the orb →
 * on the first user tap (gesture, required for iOS mic/audio) unlock audio,
 * mint a session, boot the agent, register client tools, and drive the orb from
 * status events. Tears down cleanly on `ended`.
 *
 * No secrets ever live here — only the public site-key and the short-lived
 * session token (Guardrail §11.1, Loader conventions).
 */

// Baked at build time (tsup `define`); falls back to production. A test host
// page may override via `data-api-base` on the script tag.
declare const __IZIMVO_API_BASE__: string | undefined;
const DEFAULT_API_BASE =
  typeof __IZIMVO_API_BASE__ === "string" ? __IZIMVO_API_BASE__ : "https://api.izimvo.com";

export interface BootDeps {
  config: LoaderConfig;
  apiBase: string;
  pageUrl: string;
  widget: Widget;
  cart: Cart;
  audio: AudioGate;
  checkout: CheckoutReporter;
  loadRuntime: () => Promise<AgentRuntime>;
  fetchImpl?: typeof fetch;
}

export function boot(deps: BootDeps): void {
  let handle: AgentHandle | null = null;
  let poller: ProductPoller | null = null;
  let cartPoller: CartPoller | null = null;
  let connecting = false;

  function teardown(): void {
    deps.audio.teardown();
    deps.cart.clear();
    poller?.stop();
    poller = null;
    cartPoller?.stop();
    cartPoller = null;
    handle = null;
    connecting = false;
  }

  deps.widget.onActivate(async () => {
    // A tap while a session is live ends it (the disconnect affordance).
    if (handle) {
      const live = handle;
      handle = null;
      deps.widget.setStatus("ended");
      try {
        await live.stop();
      } catch {
        /* already gone */
      }
      teardown();
      return;
    }
    if (connecting) return; // mid-handshake; ignore extra taps
    connecting = true;
    deps.widget.setStatus("connecting");

    try {
      // Unlock audio inside the gesture, before any async work.
      await deps.audio.ensure();

      const session = await fetchSession({
        apiBase: deps.apiBase,
        config: deps.config,
        pageUrl: deps.pageUrl,
        fetchImpl: deps.fetchImpl,
      });

      const runtime = await deps.loadRuntime();
      handle = await runtime.startAgent({
        sessionToken: session.sessionToken,
        sessionUrl: session.sessionUrl,
        // The runtime drives the orb via status callbacks (idle→connecting→
        // listening→thinking→speaking→ended); teardown on `ended`.
        onStatus: (raw) => {
          const status = toOrbStatus(raw);
          deps.widget.setStatus(status);
          if (status === "ended") teardown();
        },
        onError: () => {
          deps.widget.setStatus("error");
          teardown();
        },
      });
      connecting = false;

      registerClientTools(handle, {
        widget: deps.widget,
        cart: deps.cart,
        checkout: deps.checkout,
      });

      // Render cards + cart by polling backend state — independent of the agent
      // calling render_products / a cart client tool.
      if (session.conversationId) {
        poller = createProductPoller({
          apiBase: deps.apiBase,
          conversationId: session.conversationId,
          fetchImpl: deps.fetchImpl,
          onProducts: (items) => {
            deps.checkout.index(items);
            deps.widget.showCards(items);
          },
        });
        poller.start();

        cartPoller = createCartPoller({
          apiBase: deps.apiBase,
          conversationId: session.conversationId,
          fetchImpl: deps.fetchImpl,
          onCart: (cart) => {
            // Map the cart's (UTM-tagged) checkout URL to a upid so a checkout
            // click is attributed, then render the cart.
            deps.checkout.index([
              {
                upid: cart.lines[0]?.productId ?? cart.cartId,
                title: "",
                priceMinor: cart.subtotalMinor,
                currency: cart.currency,
                checkoutUrl: cart.checkoutUrl,
              },
            ]);
            deps.widget.showCart(cart);
          },
        });
        cartPoller.start();
      }
    } catch {
      deps.widget.setStatus("error");
      teardown();
    }
  });
}

/**
 * Auto-initialise from a captured host `<script>` element. The element must be
 * captured synchronously at module eval — `document.currentScript` is null by
 * the time DOMContentLoaded fires.
 */
function autoInit(scriptEl: HTMLScriptElement): void {
  const config = parseConfig(scriptEl);
  if (!config) return; // no site-key → not our script / misconfigured; stay silent

  // API base resolution order: explicit data-api-base → the origin the loader
  // was served from (our backend serves /v1/loader.js, so it calls itself) →
  // the build-time baked default.
  const apiBase = scriptEl.dataset.apiBase?.trim() || scriptOrigin(scriptEl) || DEFAULT_API_BASE;
  const checkout = createCheckoutReporter({ apiBase });

  boot({
    config,
    apiBase,
    pageUrl: location.href,
    widget: createWidget({ onCheckout: (url) => checkout.report(url) }),
    cart: createCart(),
    audio: createAudioGate(),
    checkout,
    loadRuntime: loadSpeechifyRuntime,
  });
}

/** The origin the loader script was served from (e.g. our backend/CDN). */
function scriptOrigin(el: HTMLScriptElement): string | null {
  try {
    return new URL(el.src).origin;
  } catch {
    return null;
  }
}

// Capture currentScript synchronously at module eval, then defer DOM work.
const bootScript = document.currentScript as HTMLScriptElement | null;
if (bootScript) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => autoInit(bootScript), { once: true });
  } else {
    autoInit(bootScript);
  }
}
