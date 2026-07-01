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

/** Header a webhook tool may (rarely) carry the conversation id on. */
export const CONVERSATION_HEADER = "x-speechify-conversation-id";

function firstString(values: unknown[]): string | null {
  for (const v of values) if (typeof v === "string" && v.length > 0) return v;
  return null;
}

/**
 * Resolve the conversation id for a Speechify webhook tool. Speechify carries NO
 * conversation context in the body/headers by default, so we inject it via the
 * tool URL: `?cid={{system__conversation_id}}` (interpolated per session). The
 * body/header spots are kept as fallbacks in case the contract changes. Shared
 * by every tool that must resolve scope server-side (search, add-to-cart, …).
 */
export function resolveConversationId(
  body: Record<string, unknown>,
  header: string | undefined,
  query: string | undefined,
): string | null {
  const conversation = body.conversation as { id?: unknown } | undefined;
  return firstString([
    query,
    body.conversation_id,
    body.conversationId,
    conversation?.id,
    header,
  ]);
}
