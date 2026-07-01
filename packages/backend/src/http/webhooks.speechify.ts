import { Hono } from "hono";
import { z } from "zod";
import { verifyHmacSignature } from "../clients/speechify.js";
import type { AppDeps } from "./deps.js";
import { speechifySignatureParts } from "./util.js";

/**
 * POST /v1/webhooks/speechify (PLAN §10 Phase 5). The post-call webhook:
 * HMAC-verify the raw body (Guardrail §11.10), correlate the conversation id
 * back to the minted session, and persist a `call_ended` usage event carrying
 * the evaluation / transcript ref / duration for billing + analytics.
 *
 * We ACK with 200 even when the conversation can't be correlated, so Speechify
 * does not retry indefinitely; the `recorded` flag signals what happened.
 */

const SIGNATURE_HEADER = "x-speechify-signature";
const TIMESTAMP_HEADER = "x-speechify-timestamp";
const COMBINED_SIGNATURE_HEADER = "speechify-signature";

// Tolerant envelope matching the real post-call payload (event
// `conversation.completed`): the conversation id is nested at `conversation.id`
// (the `conv_…` form), with a flat `conversation_id` kept as a fallback. We keep
// a compact summary rather than storing the whole transcript/agent snapshot.
const webhookSchema = z
  .object({
    event: z.string().optional(),
    conversation_id: z.string().optional(), // legacy/flat fallback
    conversation: z
      .object({
        id: z.string().optional(),
        status: z.string().optional(),
        end_reason: z.string().optional(),
        duration_ms: z.number().optional(),
        message_count: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export function speechifyWebhookRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const rawBody = await c.req.text();
    // Accept both Speechify's live combined `Speechify-Signature: t=,v0=` header
    // and the split X-Speechify-Signature/-Timestamp form.
    const { signature, timestamp } = speechifySignatureParts({
      combined: c.req.header(COMBINED_SIGNATURE_HEADER),
      signature: c.req.header(SIGNATURE_HEADER),
      timestamp: c.req.header(TIMESTAMP_HEADER),
    });
    const ok = verifyHmacSignature({
      rawBody,
      signature,
      secret: deps.webhookHmacSecret,
      timestamp,
    });
    if (!ok) return c.json({ error: "invalid_signature" }, 401);

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }
    const parsed = webhookSchema.safeParse(json);
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

    const conv = parsed.data.conversation;
    const conversationId = conv?.id ?? parsed.data.conversation_id;
    // Ack (200) even when we can't correlate, so Speechify does not retry; the
    // `recorded` flag says whether it landed against a session. NOTE: the
    // post-call `conversation.id` is the `conv_…` form, distinct from the
    // `system__conversation_id` UUID sessions are keyed by — so this correlates
    // only when they coincide (see the conv-ref follow-up).
    if (!conversationId) return c.json({ recorded: false }, 200);

    const session = await deps.repo.findSessionByConversationId(conversationId);
    if (!session) return c.json({ recorded: false }, 200);

    await deps.repo.recordUsageEvent({
      sessionId: session.id,
      kind: "call_ended",
      payload: {
        event: parsed.data.event ?? null,
        conversationRef: conversationId,
        status: conv?.status ?? null,
        endReason: conv?.end_reason ?? null,
        durationMs: conv?.duration_ms ?? null,
        messageCount: conv?.message_count ?? null,
      },
    });

    return c.json({ recorded: true }, 200);
  });

  return app;
}
