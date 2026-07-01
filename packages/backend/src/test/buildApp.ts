import { createMemoryRateLimiter } from "../infra/rateLimiter.js";
import type { AppDeps } from "../http/deps.js";
import { createApp } from "../http/app.js";
import {
  createFakeCatalog,
  createFakeRepo,
  createFakeSpeechify,
  type FakeCatalog,
  type FakeRepo,
} from "./fakes.js";
import { seedData } from "./fixtures.js";

/** Build the full app with in-memory fakes; override any dep per test. */
export function buildApp(overrides: Partial<AppDeps> = {}) {
  // Honour overridden repo/catalog so the returned references match what the
  // app actually uses (tests inspect them after a request).
  const repo = (overrides.repo as FakeRepo | undefined) ?? createFakeRepo(seedData());
  const catalog = (overrides.catalog as FakeCatalog | undefined) ?? createFakeCatalog();
  const deps: AppDeps = {
    speechify: createFakeSpeechify(),
    rateLimiter: createMemoryRateLimiter(),
    webhookHmacSecret: "whsec_test",
    toolHmacSecret: "toolsec_test",
    utmSource: "izimvo",
    storeDefaultCountry: "ZA",
    sessionIpRateLimitPerMin: 30,
    ...overrides,
    repo,
    catalog,
  };
  return { app: createApp(deps), repo, catalog, deps };
}
