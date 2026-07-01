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

/**
 * Normalize a Speechify webhook signature into `{ signature, timestamp }` for
 * `verifyHmacSignature`. Speechify's documented live format is a single
 * `Speechify-Signature: t=<unix-sec>,v0=<hex>` header; the console's test-webhook
 * (what the search tool was first built against) instead sends split
 * `X-Speechify-Signature` + `X-Speechify-Timestamp`. Accept both so a tool
 * verifies whichever the platform sends.
 */
export function speechifySignatureParts(headers: {
  combined?: string | null; // Speechify-Signature: t=..,v0=..
  signature?: string | null; // X-Speechify-Signature
  timestamp?: string | null; // X-Speechify-Timestamp
}): { signature: string | undefined; timestamp: string | undefined } {
  const combined = headers.combined;
  if (combined && combined.includes("v0=")) {
    const parts: Record<string, string> = {};
    for (const seg of combined.split(",")) {
      const i = seg.indexOf("=");
      if (i > 0) parts[seg.slice(0, i).trim()] = seg.slice(i + 1).trim();
    }
    return { signature: parts.v0, timestamp: parts.t };
  }
  return {
    signature: headers.signature ?? undefined,
    timestamp: headers.timestamp ?? undefined,
  };
}

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
