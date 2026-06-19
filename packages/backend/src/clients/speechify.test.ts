import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createSpeechifyClient,
  SpeechifyError,
  verifyHmacSignature,
} from "./speechify.js";

const config = {
  apiKey: "sk_test",
  agentId: "agent_42",
  baseUrl: "https://api.speechify.test",
};

describe("createSpeechifyClient.mintSession", () => {
  it("POSTs to the agent sessions endpoint with the resolved variables", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.speechify.test/v1/agents/agent_42/sessions");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer sk_test");
      const body = JSON.parse(String(init?.body));
      expect(body.dynamic_variables).toEqual({
        category: "trail running",
        merchant_scope: "global",
        locale: "en-ZA",
      });
      expect(body.user_identity).toBe("user-1");
      expect(body).not.toHaveProperty("override_language");
      // CreateConversationResponse shape: token + url + conversation.id
      return new Response(
        JSON.stringify({
          token: "tok",
          url: "wss://rt.test/s/1",
          conversation: { id: "conv_42" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const client = createSpeechifyClient(config, fetchImpl as unknown as typeof fetch);
    const minted = await client.mintSession({
      category: "trail running",
      merchantScope: "global",
      locale: "en-ZA",
      userIdentity: "user-1",
    });
    expect(minted).toEqual({
      sessionToken: "tok",
      sessionUrl: "wss://rt.test/s/1",
      conversationId: "conv_42",
    });
  });

  it("throws SpeechifyError on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    const client = createSpeechifyClient(config, fetchImpl as unknown as typeof fetch);
    await expect(
      client.mintSession({ category: "x", merchantScope: "global", locale: "en-ZA", userIdentity: null }),
    ).rejects.toBeInstanceOf(SpeechifyError);
  });

  it("throws when the response shape is unexpected", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ wrong: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const client = createSpeechifyClient(config, fetchImpl as unknown as typeof fetch);
    await expect(
      client.mintSession({ category: "x", merchantScope: "global", locale: "en-ZA", userIdentity: null }),
    ).rejects.toBeInstanceOf(SpeechifyError);
  });
});

describe("verifyHmacSignature", () => {
  const secret = "whsec_test";
  const rawBody = '{"query":"trail shoes"}';
  const valid = createHmac("sha256", secret).update(rawBody).digest("hex");

  it("accepts a correct signature", () => {
    expect(verifyHmacSignature({ rawBody, signature: valid, secret })).toBe(true);
  });
  it("accepts a sha256= prefixed hex signature", () => {
    expect(verifyHmacSignature({ rawBody, signature: `sha256=${valid}`, secret })).toBe(true);
  });

  it("accepts Speechify's sha256=<base64> signature", () => {
    const b64 = createHmac("sha256", secret).update(rawBody).digest("base64");
    expect(verifyHmacSignature({ rawBody, signature: `sha256=${b64}`, secret })).toBe(true);
  });

  it("verifies the real scheme: hex of `${timestamp}.${body}`", () => {
    const timestamp = "1781862411670";
    const sig = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
    expect(verifyHmacSignature({ rawBody, signature: `sha256=${sig}`, secret, timestamp })).toBe(true);
    // ...and rejects when the timestamp is omitted (payload differs)
    expect(verifyHmacSignature({ rawBody, signature: `sha256=${sig}`, secret })).toBe(false);
  });
  it("rejects a tampered body", () => {
    expect(verifyHmacSignature({ rawBody: rawBody + " ", signature: valid, secret })).toBe(false);
  });
  it("rejects a missing signature", () => {
    expect(verifyHmacSignature({ rawBody, signature: null, secret })).toBe(false);
  });
  it("rejects a malformed (non-hex) signature", () => {
    expect(verifyHmacSignature({ rawBody, signature: "zzzz", secret })).toBe(false);
  });
});
