import {
  evaluateWindow,
  type RateLimiter,
  type WindowState,
} from "../core/rateLimit.js";

/**
 * In-memory fixed-window rate limiter. Adequate for a single instance; swap for
 * a Redis-backed store when the backend scales horizontally (Phase 6). The pure
 * window policy lives in core/rateLimit.ts; this only owns the mutable map and
 * the clock.
 */
export function createMemoryRateLimiter(
  now: () => number = () => Date.now(),
): RateLimiter {
  const windows = new Map<string, WindowState>();

  return {
    take(key, limit, windowMs) {
      const decision = evaluateWindow({
        prev: windows.get(key),
        nowMs: now(),
        limit,
        windowMs,
      });
      windows.set(key, decision.state);
      return decision.allowed;
    },
  };
}
