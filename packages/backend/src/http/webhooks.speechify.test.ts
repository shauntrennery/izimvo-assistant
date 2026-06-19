import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../test/buildApp.js";

/**
 * Contract test for POST /v1/webhooks/speechify (PLAN §10 Phase 5):
 *   after a call, usage + evaluation land keyed to the correct site/session;
 *   an unsigned webhook is rejected.
 */
const SECRET = "whsec_test";
const CONV_ID = "conv_post_1";

function sign(body: string): string {
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
    const raw = JSON.stringify(body);
    return ctx.app.request("/v1/webhooks/speechify", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: raw,
    });
  }

  const payload = {
    conversation_id: CONV_ID,
    transcript_ref: "tr_abc",
    evaluation: { intent: "buy", category: "trail-running" },
    duration_seconds: 92,
    turns: 7,
    checkout_issued: true,
  };

  it("records a call_ended usage event keyed to the correlated session", async () => {
    const raw = JSON.stringify(payload);
    const res = await send(payload, { "x-speechify-signature": sign(raw) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: true });

    const ended = ctx.repo.usage.filter((u) => u.kind === "call_ended");
    expect(ended).toHaveLength(1);
    expect(ended[0]?.sessionId).toBe(sessionId);
    expect(ended[0]?.payload).toMatchObject({
      transcript_ref: "tr_abc",
      evaluation: { intent: "buy" },
      checkout_issued: true,
    });
  });

  it("rejects an unsigned webhook with 401", async () => {
    const res = await send(payload);
    expect(res.status).toBe(401);
    expect(ctx.repo.usage.filter((u) => u.kind === "call_ended")).toHaveLength(0);
  });

  it("rejects a tampered body with 401", async () => {
    const raw = JSON.stringify(payload);
    const res = await ctx.app.request("/v1/webhooks/speechify", {
      method: "POST",
      headers: { "content-type": "application/json", "x-speechify-signature": sign(raw) },
      body: raw + " ",
    });
    expect(res.status).toBe(401);
  });

  it("acks but does not record an uncorrelated conversation", async () => {
    const body = { ...payload, conversation_id: "conv_unknown" };
    const raw = JSON.stringify(body);
    const res = await send(body, { "x-speechify-signature": sign(raw) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: false });
    expect(ctx.repo.usage.filter((u) => u.kind === "call_ended")).toHaveLength(0);
  });

  it("400s on a payload missing conversation_id", async () => {
    const body = { evaluation: {} };
    const raw = JSON.stringify(body);
    const res = await send(body, { "x-speechify-signature": sign(raw) });
    expect(res.status).toBe(400);
  });
});
