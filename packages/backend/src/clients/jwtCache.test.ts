import { describe, expect, it, vi } from "vitest";
import { createJwtCache } from "./jwtCache.js";

const config = {
  tokenUrl: "https://auth.shopify.test/token",
  clientId: "cid",
  clientSecret: "secret",
};

function tokenResponse(token: string, expiresIn = 3600) {
  return new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("createJwtCache", () => {
  it("mints once and reuses the cached token", async () => {
    const fetchImpl = vi.fn(async () => tokenResponse("tok-1"));
    const jwt = createJwtCache(config, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(await jwt.getToken()).toBe("tok-1");
    expect(await jwt.getToken()).toBe("tok-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refreshes after the token nears expiry", async () => {
    let t = 0;
    const now = () => t;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("tok-1", 3600))
      .mockResolvedValueOnce(tokenResponse("tok-2", 3600));
    const jwt = createJwtCache(config, { fetchImpl: fetchImpl as unknown as typeof fetch, now });

    expect(await jwt.getToken()).toBe("tok-1");
    // advance past (expiry - margin): 3600s - 60s = 3540s
    t = 3_541_000;
    expect(await jwt.getToken()).toBe("tok-2");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent refreshes into a single mint", async () => {
    const fetchImpl = vi.fn(async () => tokenResponse("tok-1"));
    const jwt = createJwtCache(config, { fetchImpl: fetchImpl as unknown as typeof fetch });

    const [a, b] = await Promise.all([jwt.getToken(), jwt.getToken()]);
    expect(a).toBe("tok-1");
    expect(b).toBe("tok-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends client-credentials grant params", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("client_credentials");
      expect(body.get("client_id")).toBe("cid");
      expect(body.get("client_secret")).toBe("secret");
      return tokenResponse("tok-1");
    });
    const jwt = createJwtCache(config, { fetchImpl: fetchImpl as unknown as typeof fetch });
    await jwt.getToken();
  });
});
