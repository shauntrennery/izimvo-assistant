import { describe, expect, it, vi } from "vitest";
import { fetchSession, SessionError } from "./session.js";

const config = { siteKey: "pk_live_x", category: "trail-running", userId: "u1", locale: "en-ZA" };

describe("fetchSession", () => {
  it("POSTs the config and maps userId → userIdentity", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.test/v1/session");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        siteKey: "pk_live_x",
        category: "trail-running",
        userIdentity: "u1",
        locale: "en-ZA",
        pageUrl: "https://host.test/p",
      });
      return new Response(
        JSON.stringify({ sessionToken: "tok", sessionUrl: "wss://rt.test/s" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const out = await fetchSession({
      apiBase: "https://api.test",
      config,
      pageUrl: "https://host.test/p",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out).toEqual({ sessionToken: "tok", sessionUrl: "wss://rt.test/s" });
  });

  it("throws SessionError on 403 (non-allowlisted origin)", async () => {
    const fetchImpl = vi.fn(async () => new Response("forbidden", { status: 403 }));
    await expect(
      fetchSession({
        apiBase: "https://api.test",
        config,
        pageUrl: "https://host.test/p",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(SessionError);
  });

  it("throws on a malformed response", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ sessionToken: "tok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      fetchSession({
        apiBase: "https://api.test",
        config,
        pageUrl: "https://host.test/p",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(SessionError);
  });
});
