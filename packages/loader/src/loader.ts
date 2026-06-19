import { parseConfig } from "./attributes.js";
import { createCart, type Cart } from "./cart.js";
import { createCheckoutReporter, type CheckoutReporter } from "./checkout.js";
import { createAudioGate, type AudioGate } from "./mic.js";
import { type AgentRuntime } from "./runtime.js";
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
  let starting = false;

  deps.widget.onActivate(async () => {
    if (starting) return;
    starting = true;
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
      const handle = await runtime.startAgent({
        sessionToken: session.sessionToken,
        sessionUrl: session.sessionUrl,
      });

      registerClientTools(handle, {
        widget: deps.widget,
        cart: deps.cart,
        checkout: deps.checkout,
      });

      handle.on("status", (status) => deps.widget.setStatus(status));
      handle.on("ended", () => {
        deps.widget.setStatus("ended");
        deps.audio.teardown();
        deps.cart.clear();
        starting = false;
      });

      deps.widget.setStatus("listening");
    } catch {
      deps.widget.setStatus("error");
      deps.audio.teardown();
      starting = false;
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

  const apiBase = scriptEl.dataset.apiBase?.trim() || DEFAULT_API_BASE;
  const checkout = createCheckoutReporter({ apiBase });

  boot({
    config,
    apiBase,
    pageUrl: location.href,
    widget: createWidget({ onCheckout: (url) => checkout.report(url) }),
    cart: createCart(),
    audio: createAudioGate(),
    checkout,
    loadRuntime: () =>
      Promise.reject(
        new Error(
          "Izimvo: Speechify runtime not configured. Wire loadSpeechifyRuntime() to the SDK.",
        ),
      ),
  });
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
