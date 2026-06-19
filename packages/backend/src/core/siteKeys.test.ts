import { describe, expect, it } from "vitest";
import { bindRequest, hostnameFromHeaders, type ApiKey, type Site } from "./siteKeys.js";

const key: ApiKey = {
  id: "k",
  siteId: "s",
  publicKey: "pk_live_demo",
  allowedDomains: ["shop.example.com"],
  rateLimitRpm: 60,
  revokedAt: null,
};
const site: Site = {
  id: "s",
  status: "active",
  catalogMode: "global",
  defaultLocale: "en-ZA",
  defaultVoiceId: null,
};

describe("hostnameFromHeaders", () => {
  it("prefers Origin", () => {
    expect(
      hostnameFromHeaders({ origin: "https://shop.example.com", referer: "https://other.com/x" }),
    ).toBe("shop.example.com");
  });
  it("falls back to Referer", () => {
    expect(hostnameFromHeaders({ referer: "https://shop.example.com/x" })).toBe("shop.example.com");
  });
  it("returns null for garbage", () => {
    expect(hostnameFromHeaders({ origin: "not a url" })).toBeNull();
  });
});

describe("bindRequest", () => {
  it("binds an allowlisted host", () => {
    const r = bindRequest({ apiKey: key, site, hostname: "shop.example.com" });
    expect(r.ok).toBe(true);
  });
  it("rejects a non-allowlisted host", () => {
    const r = bindRequest({ apiKey: key, site, hostname: "evil.com" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe("origin_forbidden");
  });
  it("requires a hostname", () => {
    const r = bindRequest({ apiKey: key, site, hostname: null });
    expect(!r.ok && r.error.kind).toBe("origin_missing");
  });
  it("rejects an unknown key", () => {
    const r = bindRequest({ apiKey: null, site, hostname: "shop.example.com" });
    expect(!r.ok && r.error.kind).toBe("unknown_key");
  });
  it("rejects a revoked key", () => {
    const r = bindRequest({ apiKey: { ...key, revokedAt: new Date() }, site, hostname: "shop.example.com" });
    expect(!r.ok && r.error.kind).toBe("revoked_key");
  });
  it("rejects a suspended site", () => {
    const r = bindRequest({ apiKey: key, site: { ...site, status: "suspended" }, hostname: "shop.example.com" });
    expect(!r.ok && r.error.kind).toBe("site_suspended");
  });
  it("does not suffix-match (subdomain attack)", () => {
    const r = bindRequest({ apiKey: key, site, hostname: "shop.example.com.evil.com" });
    expect(r.ok).toBe(false);
  });
});
