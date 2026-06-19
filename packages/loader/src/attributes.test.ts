import { describe, expect, it } from "vitest";
import { parseConfig } from "./attributes.js";

function scriptWith(attrs: Record<string, string>): HTMLScriptElement {
  const el = document.createElement("script");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

describe("parseConfig", () => {
  it("parses all documented attributes", () => {
    const el = scriptWith({
      "data-site-key": "pk_live_x",
      "data-category": "trail-running",
      "data-user-id": "u-123",
      "data-locale": "en-ZA",
    });
    expect(parseConfig(el)).toEqual({
      siteKey: "pk_live_x",
      category: "trail-running",
      userId: "u-123",
      locale: "en-ZA",
    });
  });

  it("requires a site-key", () => {
    expect(parseConfig(scriptWith({ "data-category": "x" }))).toBeNull();
    expect(parseConfig(null)).toBeNull();
  });

  it("omits empty optional attributes", () => {
    const el = scriptWith({ "data-site-key": "pk_live_x", "data-category": "  " });
    expect(parseConfig(el)).toEqual({ siteKey: "pk_live_x" });
  });
});
