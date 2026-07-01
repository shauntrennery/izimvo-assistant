import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../test/buildApp.js";

/**
 * Contract test for POST /v1/webhooks/speechify (PLAN §10 Phase 5). The real
 * post-call payload (event `conversation.completed`) nests the id at
 * `conversation.id`; signature is Speechify's live `t=,v0=` header (with the
 * split header still accepted). A valid delivery is always ACKed (200) so
 * Speechify doesn't retry; usage records only when it correlates to a session.
 */
const SECRET = "whsec_test";
const CONV_ID = "conv_post_1";

/** Split-header signature (body alone). */
function signSplit(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

describe("POST /v1/webhooks/speechify", () => {
  let ctx: ReturnType<typeof buildApp>;
  let sessionId: string;

  beforeEach(async () => {
    ctx = buildApp();
    const { id } = await ctx.repo.createSession({
      siteId: "site_1",
      categorySlug: "trail-running",
      userIdentity: null,
      origin: "shop.example.com",
      conversationId: CONV_ID,
    });
    sessionId = id;
  });

  function send(body: unknown, headers: Record<string, string> = {}) {
    return ctx.app.request("/v1/webhooks/speechify", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  /** Real post-call shape: id nested under `conversation`. */
  const payload = (convId: string) => ({
    event: "conversation.completed",
    conversation: {
      id: convId,
      status: "completed",
      end_reason: "caller_hangup",
      duration_ms: 61000,
      message_count: 9,
    },
    messages: [{ role: "assistant", content: "…" }],
    evaluations: null,
  });

  it("records a call_ended usage event for a correlated conversation", async () => {
    const body = payload(CONV_ID);
    const raw = JSON.stringify(body);
    const res = await send(body, { "x-speechify-signature": signSplit(raw) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: true });

    const ended = ctx.repo.usage.filter((u) => u.kind === "call_ended");
    expect(ended).toHaveLength(1);
    expect(ended[0]?.sessionId).toBe(sessionId);
    expect(ended[0]?.payload).toMatchObject({
      event: "conversation.completed",
      conversationRef: CONV_ID,
      status: "completed",
      endReason: "caller_hangup",
      durationMs: 61000,
    });
  });

  it("accepts Speechify's live combined signature (Speechify-Signature: t=,v0=)", async () => {
    const body = payload(CONV_ID);
    const raw = JSON.stringify(body);
    const t = "1782917631";
    const v0 = createHmac("sha256", SECRET).update(`${t}.${raw}`).digest("hex");
    const res = await send(body, { "speechify-signature": `t=${t},v0=${v0}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: true });
  });

  it("rejects an unsigned webhook with 401", async () => {
    const res = await send(payload(CONV_ID));
    expect(res.status).toBe(401);
    expect(ctx.repo.usage.filter((u) => u.kind === "call_ended")).toHaveLength(0);
  });

  it("rejects a tampered body with 401", async () => {
    const raw = JSON.stringify(payload(CONV_ID));
    const res = await ctx.app.request("/v1/webhooks/speechify", {
      method: "POST",
      headers: { "content-type": "application/json", "x-speechify-signature": signSplit(raw) },
      body: raw + " ",
    });
    expect(res.status).toBe(401);
  });

  it("acks (200) but does not record an uncorrelated conversation", async () => {
    const body = payload("conv_unknown");
    const raw = JSON.stringify(body);
    const res = await send(body, { "x-speechify-signature": signSplit(raw) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: false });
    expect(ctx.repo.usage.filter((u) => u.kind === "call_ended")).toHaveLength(0);
  });

  it("acks (200) a signed payload with no conversation id rather than 400", async () => {
    const body = { event: "conversation.completed", messages: [] };
    const raw = JSON.stringify(body);
    const res = await send(body, { "x-speechify-signature": signSplit(raw) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: false });
  });
});
