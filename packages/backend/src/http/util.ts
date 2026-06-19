/**
 * Best-effort client IP for rate limiting. Trusts the left-most
 * `x-forwarded-for` hop; falls back to a sentinel so the limiter still keys
 * something rather than letting unknown-IP traffic bypass the gate.
 */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
