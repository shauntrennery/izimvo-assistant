import { serve } from "@hono/node-server";
import { createGlobalCatalogClient } from "./clients/catalog.js";
import { createJwtCache } from "./clients/jwtCache.js";
import { createSpeechifyClient } from "./clients/speechify.js";
import { loadEnv } from "./config/env.js";
import { createDb } from "./db/client.js";
import { createRepo } from "./db/repo.js";
import { createApp } from "./http/app.js";
import { createMemoryRateLimiter } from "./infra/rateLimiter.js";

/**
 * Production composition root: parse env (fail-fast), wire real adapters, serve.
 */
const env = loadEnv();

const jwt = createJwtCache({
  tokenUrl: env.SHOPIFY_CATALOG_TOKEN_URL,
  clientId: env.SHOPIFY_CATALOG_CLIENT_ID,
  clientSecret: env.SHOPIFY_CATALOG_CLIENT_SECRET,
});

const app = createApp({
  repo: createRepo(createDb(env.DATABASE_URL)),
  speechify: createSpeechifyClient({
    apiKey: env.SPEECHIFY_API_KEY,
    agentId: env.SPEECHIFY_AGENT_ID,
    baseUrl: env.SPEECHIFY_API_BASE,
  }),
  catalog: createGlobalCatalogClient({ mcpUrl: env.SHOPIFY_CATALOG_MCP_URL }, jwt),
  rateLimiter: createMemoryRateLimiter(),
  webhookHmacSecret: env.SPEECHIFY_WEBHOOK_HMAC_SECRET,
  utmSource: env.ATTRIBUTION_UTM_SOURCE,
  sessionIpRateLimitPerMin: 30,
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`izimvo backend listening on :${info.port}`);
});
