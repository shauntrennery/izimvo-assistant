import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../test/buildApp.js";

/**
 * Contract test for POST /v1/checkout (PLAN §10 Phase 4):
 *   clicking through carries UTM params; an attribution row is recorded,
 *   keyed to the session re-derived from utm_content and origin-bound.
 */
describe("POST /v1/checkout", () => {
  let ctx: ReturnType<typeof buildApp>;
  let sessionId: string;

  beforeEach(async () => {
    ctx = buildApp();
    const { id } = await ctx.repo.createSession({
      siteId: "site_1",
      categorySlug: "trail-running",
      userIdentity: null,
      origin: "shop.example.com",
      conversationId: "conv_1",
    });
    sessionId = id;
  });

  const taggedUrl = (sid: string) =>
    `https://m.test/p?utm_source=izimvo&utm_medium=voice&utm_campaign=trail-running&utm_content=${sid}`;

  function post(body: unknown, headers: Record<string, string> = {}) {
    return ctx.app.request("/v1/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  it("records an attribution row from an origin-bound tagged URL", async () => {
    const res = await post(
      { checkoutUrl: taggedUrl(sessionId), upid: "u1" },
      { origin: "https://shop.example.com" },
    );
    expect(res.status).toBe(204);
    expect(ctx.repo.attributions).toHaveLength(1);
    expect(ctx.repo.attributions[0]).toMatchObject({
      sessionId,
      upid: "u1",
      utm: { utm_source: "izimvo", utm_campaign: "trail-running", utm_content: sessionId },
    });
  });

  it("rejects a URL with no utm_content with 400", async () => {
    const res = await post(
      { checkoutUrl: "https://m.test/p?utm_source=izimvo", upid: "u1" },
      { origin: "https://shop.example.com" },
    );
    expect(res.status).toBe(400);
  });

  it("404s when the session is unknown", async () => {
    const res = await post(
      { checkoutUrl: taggedUrl("sess_does_not_exist"), upid: "u1" },
      { origin: "https://shop.example.com" },
    );
    expect(res.status).toBe(404);
  });

  it("403s when the origin does not match the session's origin", async () => {
    const res = await post(
      { checkoutUrl: taggedUrl(sessionId), upid: "u1" },
      { origin: "https://evil.example.net" },
    );
    expect(res.status).toBe(403);
    expect(ctx.repo.attributions).toHaveLength(0);
  });

  it("400s on a malformed body", async () => {
    const res = await post({ upid: "u1" }, { origin: "https://shop.example.com" });
    expect(res.status).toBe(400);
  });
});
