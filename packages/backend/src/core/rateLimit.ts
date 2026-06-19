/**
 * Fixed-window rate limiting, expressed as a pure transition so the policy is
 * unit-testable without a clock or a store. The stateful adapter (the Map that
 * holds per-key windows) lives in the shell — see infra/rateLimiter.ts.
 */

export interface WindowState {
  windowStartMs: number;
  count: number;
}

export interface RateDecision {
  allowed: boolean;
  state: WindowState;
  retryAfterMs: number;
}

/**
 * Evaluate one request against a fixed window. When the window has elapsed it
 * resets; otherwise the count increments and is checked against the limit.
 */
export function evaluateWindow(input: {
  prev: WindowState | undefined;
  nowMs: number;
  limit: number;
  windowMs: number;
}): RateDecision {
  const { prev, nowMs, limit, windowMs } = input;

  const inWindow = prev !== undefined && nowMs - prev.windowStartMs < windowMs;
  const windowStartMs = inWindow ? prev.windowStartMs : nowMs;
  const count = (inWindow ? prev.count : 0) + 1;
  const state: WindowState = { windowStartMs, count };

  if (count > limit) {
    return {
      allowed: false,
      state,
      retryAfterMs: windowStartMs + windowMs - nowMs,
    };
  }
  return { allowed: true, state, retryAfterMs: 0 };
}

/** Injectable rate limiter the shell wires to a concrete store. */
export interface RateLimiter {
  /** Returns true when the request is permitted under `key`'s limit. */
  take(key: string, limit: number, windowMs: number): boolean;
}
