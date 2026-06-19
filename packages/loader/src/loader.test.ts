import { describe, expect, it, vi } from "vitest";
import { boot } from "./loader.js";
import { createCart } from "./cart.js";
import { createCheckoutReporter } from "./checkout.js";
import type { AgentHandle, AgentRuntime } from "./runtime.js";
import type { OrbStatus } from "./types.js";
import type { Widget } from "./widget.js";

/**
 * End-to-end boot wiring (PLAN §10 Phase 3): tap → unlock audio → mint session
 * → start agent → register tools → drive orb from status → teardown on ended.
 */
function harness() {
  let activate: (() => void) | undefined;
  const statuses: OrbStatus[] = [];
  const widget: Widget = {
    setStatus: (s) => statuses.push(s),
    showCards: vi.fn(),
    openCheckout: vi.fn(),
    onActivate: (cb) => {
      activate = cb;
    },
    destroy: vi.fn(),
  };

  // Captures the onStatus callback passed to startAgent so the test can emit
  // status transitions the way the real runtime does.
  let onStatus: ((s: string) => void) | undefined;
  const handle = {
    registerTool: vi.fn(),
    setMicEnabled: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  } as unknown as AgentHandle;
  const startAgent = vi.fn(async (opts: { onStatus?: (s: string) => void }) => {
    onStatus = opts.onStatus;
    return handle;
  });
  const runtime: AgentRuntime = { startAgent: startAgent as unknown as AgentRuntime["startAgent"] };

  const audio = { ensure: vi.fn(async () => undefined), teardown: vi.fn() };
  const cart = createCart();

  const fetchImpl = vi.fn(
    async () =>
      new Response(JSON.stringify({ sessionToken: "tok", sessionUrl: "wss://rt.test/s" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );

  boot({
    config: { siteKey: "pk_live_x", category: "trail-running" },
    apiBase: "https://api.test",
    pageUrl: "https://host.test/p",
    widget,
    cart,
    audio,
    checkout: createCheckoutReporter({ apiBase: "https://api.test", fetchImpl: vi.fn() as unknown as typeof fetch }),
    loadRuntime: async () => runtime,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });

  return {
    activate: () => activate?.(),
    statuses,
    handle,
    runtime,
    audio,
    cart,
    fetchImpl,
    emitStatus: (s: string) => onStatus?.(s),
  };
}

describe("boot", () => {
  it("runs the full activation flow on tap", async () => {
    const h = harness();
    await h.activate();

    expect(h.audio.ensure).toHaveBeenCalledOnce();
    expect(h.fetchImpl).toHaveBeenCalledOnce();
    expect(h.runtime.startAgent).toHaveBeenCalledWith(
      expect.objectContaining({ sessionToken: "tok", sessionUrl: "wss://rt.test/s" }),
    );
    expect(h.handle.registerTool).toHaveBeenCalledTimes(3);
    // boot itself only sets "connecting"; the runtime drives the rest via onStatus
    expect(h.statuses).toEqual(["connecting"]);
  });

  it("drives the orb from status events and tears down on ended", async () => {
    const h = harness();
    await h.activate();
    h.cart.set("u1", 1);

    h.emitStatus("speaking");
    expect(h.statuses.at(-1)).toBe("speaking");

    h.emitStatus("ended");
    expect(h.statuses.at(-1)).toBe("ended");
    expect(h.audio.teardown).toHaveBeenCalled();
    expect(h.cart.entries()).toEqual([]);
  });

  it("shows an error and tears down audio if the session mint fails", async () => {
    let activate: (() => void) | undefined;
    const statuses: OrbStatus[] = [];
    const widget: Widget = {
      setStatus: (s) => statuses.push(s),
      showCards: vi.fn(),
      openCheckout: vi.fn(),
      onActivate: (cb) => { activate = cb; },
      destroy: vi.fn(),
    };
    const audio = { ensure: vi.fn(async () => undefined), teardown: vi.fn() };

    boot({
      config: { siteKey: "pk_live_x" },
      apiBase: "https://api.test",
      pageUrl: "https://host.test/p",
      widget,
      cart: createCart(),
      audio,
      checkout: createCheckoutReporter({ apiBase: "https://api.test", fetchImpl: vi.fn() as unknown as typeof fetch }),
      loadRuntime: async () => ({ startAgent: vi.fn() }) as unknown as AgentRuntime,
      fetchImpl: (async () => new Response("forbidden", { status: 403 })) as unknown as typeof fetch,
    });

    await activate?.();
    expect(statuses.at(-1)).toBe("error");
    expect(audio.teardown).toHaveBeenCalled();
  });

  it("ignores re-taps while a session is starting", async () => {
    const h = harness();
    await Promise.all([h.activate(), h.activate()]);
    expect(h.runtime.startAgent).toHaveBeenCalledTimes(1);
  });

  it("a tap while live disconnects the session", async () => {
    const h = harness();
    await h.activate(); // start
    expect(h.runtime.startAgent).toHaveBeenCalledTimes(1);

    await h.activate(); // tap again → end
    expect(h.handle.stop).toHaveBeenCalledOnce();
    expect(h.statuses.at(-1)).toBe("ended");
    expect(h.audio.teardown).toHaveBeenCalled();

    await h.activate(); // a fresh tap starts a new session
    expect(h.runtime.startAgent).toHaveBeenCalledTimes(2);
  });
});
