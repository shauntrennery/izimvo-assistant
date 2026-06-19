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

// Speechify returns at least these fields; tolerate extras. The exact names are
// the thing to confirm against the API reference — isolated to this schema.
const mintResponseSchema = z.object({
  sessionToken: z.string().min(1),
  sessionUrl: z.string().url(),
  conversationId: z.string().min(1).optional(),
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
          dynamic_variables: {
            category: input.category,
            merchant_scope: input.merchantScope,
            locale: input.locale,
          },
          user_identity: input.userIdentity,
          override_language: input.locale,
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
        sessionToken: parsed.data.sessionToken,
        sessionUrl: parsed.data.sessionUrl,
        conversationId: parsed.data.conversationId ?? null,
      };
    },
  };
}

/**
 * Verify an HMAC-SHA256 signature over the exact raw request body
 * (Guardrails §11.10). Used by the search tool and the post-call webhook.
 * Constant-time comparison; tolerant of an optional `sha256=` prefix.
 */
export function verifyHmacSignature(input: {
  rawBody: string;
  signature: string | null | undefined;
  secret: string;
}): boolean {
  const { rawBody, signature, secret } = input;
  if (!signature) return false;

  const provided = signature.startsWith("sha256=")
    ? signature.slice("sha256=".length)
    : signature;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

  // Both hex strings of equal length when valid; bail before timingSafeEqual
  // (which throws on length mismatch) to keep the comparison constant-time on
  // the happy path without leaking length via an exception.
  const a = Buffer.from(expected, "hex");
  let b: Buffer;
  try {
    b = Buffer.from(provided, "hex");
  } catch {
    return false;
  }
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}
