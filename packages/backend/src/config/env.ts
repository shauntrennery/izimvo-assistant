import { z } from "zod";

/**
 * Environment schema (PLAN §9). Validated once at startup; the process refuses
 * to boot if anything required is missing or malformed. Domain code never reads
 * process.env directly — it receives the parsed Env (or a narrower slice).
 */
const envSchema = z.object({
  SPEECHIFY_API_KEY: z.string().min(1),
  SPEECHIFY_AGENT_ID: z.string().min(1),
  SPEECHIFY_WEBHOOK_HMAC_SECRET: z.string().min(1),
  SPEECHIFY_API_BASE: z.string().url().default("https://api.speechify.ai"),

  SHOPIFY_CATALOG_CLIENT_ID: z.string().min(1),
  SHOPIFY_CATALOG_CLIENT_SECRET: z.string().min(1),
  SHOPIFY_CATALOG_TOKEN_URL: z.string().url(),
  SHOPIFY_CATALOG_MCP_URL: z.string().url(),

  DATABASE_URL: z.string().min(1),

  ATTRIBUTION_UTM_SOURCE: z.string().min(1).default("izimvo"),
  PUBLIC_API_BASE: z.string().url(),
  LOADER_CDN_BASE: z.string().url(),

  PORT: z.coerce.number().int().positive().default(8787),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
