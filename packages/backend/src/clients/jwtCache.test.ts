import { describe, expect, it, vi } from "vitest";
import { createJwtCache } from "./jwtCache.js";

const config = {
  tokenUrl: "https://api.shopify.test/auth/access_token",
  clientId: "cid",
  clientSecret: "secret",
};

/** A minimal JWT whose payload carries `exp` (epoch seconds). */
function makeJwt(expSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString("base64url");
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`;
}

function tokenResponse(jwt: string) {
  return new Response(JSON.stringify({ access_token: jwt, token_type: "Bearer" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("createJwtCache", () => {
  it("mints once and reuses the cached token until near JWT expiry", async () => {
    const fetchImpl = vi.fn(async () => tokenResponse(makeJwt(3600)));
    const jwt = createJwtCache(config, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 0,
    });
    expect(await jwt.getToken()).toBe(makeJwt(3600));
    expect(await jwt.getToken()).toBe(makeJwt(3600));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refreshes after the token nears its exp claim", async () => {
    let t = 0;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse(makeJwt(3600)))
      .mockResolvedValueOnce(tokenResponse(makeJwt(7200)));
    const jwt = createJwtCache(config, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => t,
    });
    expect(await jwt.getToken()).toBe(makeJwt(3600));
    // exp=3600s → 3,600,000ms; refresh margin 60,000ms → refresh past 3,540,000
    t = 3_541_000;
    expect(await jwt.getToken()).toBe(makeJwt(7200));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent refreshes into a single mint", async () => {
    const fetchImpl = vi.fn(async () => tokenResponse(makeJwt(3600)));
    const jwt = createJwtCache(config, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 0,
    });
    const [a, b] = await Promise.all([jwt.getToken(), jwt.getToken()]);
    expect(a).toBe(b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends a JSON client-credentials body", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        grant_type: "client_credentials",
        client_id: "cid",
        client_secret: "secret",
      });
      return tokenResponse(makeJwt(3600));
    });
    const jwt = createJwtCache(config, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 0,
    });
    await jwt.getToken();
  });
});
