import { describe, expect, it } from "vitest";
import { buildApp } from "../test/buildApp.js";

/**
 * App-level concerns: CORS for the cross-origin widget calls, and serving the
 * embeddable loader bundle from our own origin.
 */
describe("CORS", () => {
  it("answers a preflight for /v1/session with permissive headers", async () => {
    const { app } = buildApp();
    const res = await app.request("/v1/session", {
      method: "OPTIONS",
      headers: {
        origin: "https://shop.example.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });
});

describe("GET /v1/loader.js", () => {
  it("serves the bundle as javascript when present", async () => {
    const { app } = buildApp({ loaderBundle: { js: "/*izimvo loader*/", map: null } });
    const res = await app.request("/v1/loader.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toBe("/*izimvo loader*/");
  });

  it("404s when no bundle is configured", async () => {
    const { app } = buildApp();
    const res = await app.request("/v1/loader.js");
    expect(res.status).toBe(404);
  });
});

describe("hosted demo", () => {
  it("serves /demo as HTML and redirects / to it", async () => {
    const { app } = buildApp({ demoHtml: "<!doctype html><title>demo</title>" });
    const demo = await app.request("/demo");
    expect(demo.status).toBe(200);
    expect(demo.headers.get("content-type")).toContain("text/html");
    expect(await demo.text()).toContain("demo");

    const root = await app.request("/", { redirect: "manual" });
    expect([301, 302]).toContain(root.status);
    expect(root.headers.get("location")).toBe("/demo");
  });

  it("404s /demo when no demo html is configured", async () => {
    const { app } = buildApp();
    expect((await app.request("/demo")).status).toBe(404);
  });
});
