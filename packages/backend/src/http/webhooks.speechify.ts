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

// Tolerant envelope — store whatever the post-call payload carries. The exact
// field set is confirmed against the Speechify post-call schema; only
// conversation_id is required for correlation.
const webhookSchema = z
  .object({
    conversation_id: z.string().min(1),
    transcript_ref: z.string().optional(),
    evaluation: z.unknown().optional(),
    duration_seconds: z.number().nonnegative().optional(),
    turns: z.number().int().nonnegative().optional(),
    checkout_issued: z.boolean().optional(),
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

    const session = await deps.repo.findSessionByConversationId(parsed.data.conversation_id);
    if (!session) {
      // Acknowledge to stop retries, but flag that we could not attribute it.
      return c.json({ recorded: false }, 200);
    }

    await deps.repo.recordUsageEvent({
      sessionId: session.id,
      kind: "call_ended",
      payload: parsed.data,
    });

    return c.json({ recorded: true }, 200);
  });

  return app;
}
