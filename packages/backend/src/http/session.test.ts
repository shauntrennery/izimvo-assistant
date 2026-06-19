import { beforeEach, describe, expect, it } from "vitest";
import { createFakeRepo, createFakeSpeechify, type FakeRepo } from "../test/fakes.js";
import { seedData } from "../test/fixtures.js";
import { buildApp as makeApp } from "../test/buildApp.js";
import type { createApp } from "./app.js";

/**
 * Contract test for POST /v1/session (PLAN §10 Phase 1 acceptance):
 *   allowlisted origin → token;  non-allowlisted origin → 403.
 * Plus the negative auth paths CLAUDE.md requires as first-class tests.
 */

function post(
  app: ReturnType<typeof createApp>,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return app.request("/v1/session", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const validBody = {
  siteKey: "pk_live_demo",
  category: "trail-running",
  pageUrl: "https://shop.example.com/shoes",
};

describe("POST /v1/session", () => {
  let app: ReturnType<typeof createApp>;
  let repo: FakeRepo;

  beforeEach(() => {
    ({ app, repo } = makeApp());
  });

  it("mints a session from an allowlisted origin", async () => {
    const res = await post(app, validBody, { origin: "https://shop.example.com" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      sessionToken: "tok_test_123",
      sessionUrl: "wss://realtime.speechify.test/session/abc",
    });
    expect(repo.sessions).toHaveLength(1);
    expect(repo.sessions[0]).toMatchObject({
      siteId: "site_1",
      categorySlug: "trail-running",
      origin: "shop.example.com",
    });
  });

  it("records a session_start usage event on mint", async () => {
    await post(app, validBody, { origin: "https://shop.example.com" });
    const starts = repo.usage.filter((u) => u.kind === "session_start");
    expect(starts).toHaveLength(1);
  });

  it("accepts the Referer header when Origin is absent", async () => {
    const res = await post(app, validBody, {
      referer: "https://www.example.com/page",
    });
    expect(res.status).toBe(200);
  });

  it("rejects a non-allowlisted origin with 403", async () => {
    const res = await post(app, validBody, { origin: "https://evil.example.net" });
    expect(res.status).toBe(403);
    expect(repo.sessions).toHaveLength(0);
  });

  it("rejects a request with no Origin or Referer with 403", async () => {
    const res = await post(app, validBody);
    expect(res.status).toBe(403);
  });

  it("rejects an unknown site-key with 403 (no key disclosure)", async () => {
    const res = await post(
      app,
      { ...validBody, siteKey: "pk_live_nope" },
      { origin: "https://shop.example.com" },
    );
    expect(res.status).toBe(403);
  });

  it("rejects an unknown category with 400", async () => {
    const res = await post(
      app,
      { ...validBody, category: "weapons-grade-plutonium" },
      { origin: "https://shop.example.com" },
    );
    expect(res.status).toBe(400);
  });

  it("falls back to the site default category when none supplied", async () => {
    const res = await post(
      app,
      { siteKey: "pk_live_demo", pageUrl: "https://shop.example.com/x" },
      { origin: "https://shop.example.com" },
    );
    expect(res.status).toBe(200);
    expect(repo.sessions[0]?.categorySlug).toBe("trail-running");
  });

  it("validates the request body shape with 400", async () => {
    const res = await post(
      app,
      { siteKey: "pk_live_demo" }, // missing pageUrl
      { origin: "https://shop.example.com" },
    );
    expect(res.status).toBe(400);
  });

  it("passes the safe resolved label (not the raw slug) to the mint", async () => {
    let mintedCategory = "";
    const { app: app2 } = makeApp({
      speechify: createFakeSpeechify((i) => {
        mintedCategory = i.category;
      }),
    });
    await post(app2, validBody, { origin: "https://shop.example.com" });
    expect(mintedCategory).toBe("trail running");
  });

  it("rate-limits per key with 429 once rpm is exceeded", async () => {
    const data = seedData();
    data.apiKeys[0]!.rateLimitRpm = 2;
    const { app: app2 } = makeApp({ repo: createFakeRepo(data) });
    const hdr = { origin: "https://shop.example.com" };
    expect((await post(app2, validBody, hdr)).status).toBe(200);
    expect((await post(app2, validBody, hdr)).status).toBe(200);
    expect((await post(app2, validBody, hdr)).status).toBe(429);
  });
});
