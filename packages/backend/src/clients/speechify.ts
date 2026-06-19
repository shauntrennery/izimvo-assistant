import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * The one typed integration point for Speechify (CLAUDE.md: every external
 * service is reached through a single client with a contract test). Both the
 * session-mint shape and the webhook HMAC scheme are isolated here so the
 * "confirm exact field names against the API reference" note in PLAN §7.3 is a
 * one-file change.
 */

export interface MintSessionInput {
  /** Resolved, safe category label — never the raw host attribute. */
  category: string;
  merchantScope: "global" | "storefront";
  locale: string;
  userIdentity: string | null;
}

export interface MintedSession {
  sessionToken: string;
  sessionUrl: string;
  /**
   * The Speechify conversation id, when the mint response carries it. We store
   * it so the signed search-tool webhook can be correlated back to this
   * session's scope server-side (PLAN §7.4). Null if not yet known — Phase 5's
   * post-call webhook is the fallback correlation point.
   */
  conversationId: string | null;
}

export interface SpeechifyClient {
  mintSession(input: MintSessionInput): Promise<MintedSession>;
}

// CreateConversationResponse (confirmed via docs.speechify.ai): the realtime
// `token` + `url`, plus the created `conversation` (whose id we store so the
// search-tool webhook can be correlated back to this session's scope). Extra
// fields are tolerated.
const mintResponseSchema = z.object({
  token: z.string().min(1),
  url: z.string().min(1),
  conversation: z.object({ id: z.string().min(1) }).optional(),
});

export interface SpeechifyConfig {
  apiKey: string;
  agentId: string;
  baseUrl: string; // e.g. https://api.speechify.ai
}

export class SpeechifyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SpeechifyError";
  }
}

/**
 * Live client. `fetchImpl` is injectable purely so the contract test can drive
 * it without a network; production passes the global fetch.
 */
export function createSpeechifyClient(
  config: SpeechifyConfig,
  fetchImpl: typeof fetch = fetch,
): SpeechifyClient {
  return {
    async mintSession(input) {
      const url = `${config.baseUrl}/v1/agents/${config.agentId}/sessions`;
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          // These vars must be declared on the agent (PLAN §8) or they're
          // rejected. Locale rides as a dynamic variable; there is no top-level
          // override_language field in the documented API.
          dynamic_variables: {
            category: input.category,
            merchant_scope: input.merchantScope,
            locale: input.locale,
          },
          user_identity: input.userIdentity,
        }),
      });

      if (!res.ok) {
        throw new SpeechifyError(
          `session mint failed: ${res.status}`,
          res.status,
        );
      }

      const json: unknown = await res.json();
      const parsed = mintResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new SpeechifyError(
          `unexpected session mint response: ${parsed.error.message}`,
        );
      }
      return {
        sessionToken: parsed.data.token,
        sessionUrl: parsed.data.url,
        // The search-tool webhook receives `system__conversation_id`, which is
        // the conversation UUID embedded in the session token's metadata — NOT
        // the `conv_…` form on `conversation.id`. Store the UUID so the tool
        // call (cid={{system__conversation_id}}) correlates back to this session.
        conversationId:
          conversationIdFromToken(parsed.data.token) ?? parsed.data.conversation?.id ?? null,
      };
    },
  };
}

/** Extract `metadata.conversation_id` (the conversation UUID) from a session token. */
function conversationIdFromToken(token: string): string | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as {
      metadata?: unknown;
    };
    const meta =
      typeof payload.metadata === "string" ? JSON.parse(payload.metadata) : payload.metadata;
    const cid = (meta as { conversation_id?: unknown } | null)?.conversation_id;
    return typeof cid === "string" ? cid : null;
  } catch {
    return null;
  }
}

/**
 * Verify a Speechify webhook signature (Guardrails §11.10). Used by the search
 * tool and the post-call webhook.
 *
 * Confirmed empirically against the live Speechify console: the signed payload
 * is `${timestamp}.${rawBody}` (Stripe-style, timestamp from the
 * `X-Speechify-Timestamp` header) and the digest is hex — NOT base64-of-body as
 * the UI note claims. When no timestamp is supplied we fall back to signing the
 * body alone, and we accept hex/base64/base64url, so the verifier also serves
 * hex/base64-signing callers and our own tests. Constant-time comparison.
 */
export function verifyHmacSignature(input: {
  rawBody: string;
  signature: string | null | undefined;
  secret: string;
  /** X-Speechify-Timestamp header; when present, the signed payload is `${ts}.${body}`. */
  timestamp?: string | null;
}): boolean {
  const { rawBody, signature, secret, timestamp } = input;
  if (!signature) return false;

  const provided = signature.startsWith("sha256=")
    ? signature.slice("sha256=".length)
    : signature;

  const payload = timestamp ? `${timestamp}.${rawBody}` : rawBody;
  const expected = createHmac("sha256", secret).update(payload).digest(); // raw bytes

  // Decode the provided signature under each encoding and compare to the raw
  // digest. base64 (44 chars) / base64url / hex (64 chars) have distinct
  // lengths, so trying all is unambiguous. Length-guard before timingSafeEqual
  // (it throws on mismatched lengths).
  for (const encoding of ["hex", "base64", "base64url"] as const) {
    const candidate = Buffer.from(provided, encoding);
    if (candidate.length === expected.length && timingSafeEqual(expected, candidate)) {
      return true;
    }
  }
  return false;
}
