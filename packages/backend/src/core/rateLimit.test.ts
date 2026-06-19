import { describe, expect, it } from "vitest";
import { evaluateWindow } from "./rateLimit.js";

describe("evaluateWindow", () => {
  it("allows up to the limit within a window", () => {
    let state;
    const d1 = evaluateWindow({ prev: undefined, nowMs: 0, limit: 2, windowMs: 1000 });
    expect(d1.allowed).toBe(true);
    state = d1.state;
    const d2 = evaluateWindow({ prev: state, nowMs: 100, limit: 2, windowMs: 1000 });
    expect(d2.allowed).toBe(true);
    state = d2.state;
    const d3 = evaluateWindow({ prev: state, nowMs: 200, limit: 2, windowMs: 1000 });
    expect(d3.allowed).toBe(false);
    expect(d3.retryAfterMs).toBe(800);
  });

  it("resets after the window elapses", () => {
    const d1 = evaluateWindow({ prev: undefined, nowMs: 0, limit: 1, windowMs: 1000 });
    expect(d1.allowed).toBe(true);
    const d2 = evaluateWindow({ prev: d1.state, nowMs: 500, limit: 1, windowMs: 1000 });
    expect(d2.allowed).toBe(false);
    const d3 = evaluateWindow({ prev: d2.state, nowMs: 1500, limit: 1, windowMs: 1000 });
    expect(d3.allowed).toBe(true);
  });
});
