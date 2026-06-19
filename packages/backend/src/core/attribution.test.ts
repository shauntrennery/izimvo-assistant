import { describe, expect, it } from "vitest";
import { buildUtm, extractUtm, tagUrl, tagCheckoutUrl } from "./attribution.js";

const ctx = { source: "izimvo", categorySlug: "trail-running", sessionId: "sess_1" };

describe("attribution", () => {
  it("builds the UTM record from context", () => {
    expect(buildUtm(ctx)).toEqual({
      utm_source: "izimvo",
      utm_medium: "voice",
      utm_campaign: "trail-running",
      utm_content: "sess_1",
    });
  });

  it("tags a URL, preserving existing non-utm params", () => {
    const tagged = tagUrl("https://shop.test/p?variant=42", buildUtm(ctx));
    const u = new URL(tagged);
    expect(u.searchParams.get("variant")).toBe("42");
    expect(u.searchParams.get("utm_source")).toBe("izimvo");
    expect(u.searchParams.get("utm_campaign")).toBe("trail-running");
  });

  it("overwrites pre-existing utm params with ours", () => {
    const tagged = tagUrl("https://shop.test/p?utm_source=evil", buildUtm(ctx));
    expect(new URL(tagged).searchParams.get("utm_source")).toBe("izimvo");
  });

  it("returns the raw string when the URL is unparseable", () => {
    expect(tagUrl("not a url", buildUtm(ctx))).toBe("not a url");
  });

  it("tagCheckoutUrl returns both the tagged url and the utm record", () => {
    const { url, utm } = tagCheckoutUrl("https://shop.test/p", ctx);
    expect(url).toContain("utm_source=izimvo");
    expect(utm.utm_content).toBe("sess_1");
  });

  it("extractUtm round-trips the session id and utm params back out", () => {
    const { url } = tagCheckoutUrl("https://shop.test/p?variant=9", ctx);
    const { sessionId, utm } = extractUtm(url);
    expect(sessionId).toBe("sess_1");
    expect(utm).toEqual({
      utm_source: "izimvo",
      utm_medium: "voice",
      utm_campaign: "trail-running",
      utm_content: "sess_1",
    });
  });

  it("extractUtm returns null sessionId for an untagged url", () => {
    expect(extractUtm("https://shop.test/p").sessionId).toBeNull();
    expect(extractUtm("garbage").sessionId).toBeNull();
  });
});
