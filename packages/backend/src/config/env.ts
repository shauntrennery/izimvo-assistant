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
  // The search_products tool mints its own signing secret on create (distinct
  // from the post-call webhook secret); shown once in the Speechify console.
  SPEECHIFY_TOOL_HMAC_SECRET: z.string().min(1),
  // Each Speechify webhook tool mints its OWN signing secret on create. These
  // hold the add_to_cart / product_info secrets; each falls back to
  // SPEECHIFY_TOOL_HMAC_SECRET when unset (single-secret setups / tests).
  SPEECHIFY_ADD_TO_CART_HMAC_SECRET: z.string().min(1).optional(),
  SPEECHIFY_PRODUCT_INFO_HMAC_SECRET: z.string().min(1).optional(),
  SPEECHIFY_API_BASE: z.string().url().default("https://api.speechify.ai"),

  SHOPIFY_CATALOG_CLIENT_ID: z.string().min(1),
  SHOPIFY_CATALOG_CLIENT_SECRET: z.string().min(1),
  SHOPIFY_CATALOG_TOKEN_URL: z.string().url(),
  SHOPIFY_CATALOG_MCP_URL: z.string().url(),
  // UCP agent profile sent on every catalog call. Defaults to Shopify's sample
  // profile; host our own at /.well-known/ucp for production.
  SHOPIFY_UCP_AGENT_PROFILE: z
    .string()
    .url()
    .default("https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json"),

  // Catalog scope for this deployment (PLAN §3). 'global' = cross-merchant Shopify
  // catalog (uses the SHOPIFY_CATALOG_* client credentials above). 'storefront' =
  // a single store's own catalog via its public /api/mcp endpoint (no auth).
  CATALOG_MODE: z.enum(["global", "storefront"]).default("global"),
  // Required when CATALOG_MODE=storefront: the store's Storefront MCP endpoint,
  // e.g. https://{store}.myshopify.com/api/mcp.
  SHOPIFY_STORE_MCP_URL: z.string().url().optional(),
  // Optional display name for the single store (Storefront mode); shown as the
  // offer merchant on product results. Falls back to blank if unset.
  STORE_DISPLAY_NAME: z.string().optional(),
  // Default ships-to country (ISO 3166-1 alpha-2) for this deployment. Drives the
  // catalog ships-to filter and the buyer currency when the LLM omits ships_to.
  // Defaults to ZA to preserve prior behavior; set GB for the Danetti store.
  STORE_DEFAULT_COUNTRY: z.string().length(2).default("ZA"),

  DATABASE_URL: z.string().min(1),

  ATTRIBUTION_UTM_SOURCE: z.string().min(1).default("izimvo"),
  PUBLIC_API_BASE: z.string().url(),
  LOADER_CDN_BASE: z.string().url(),

  PORT: z.coerce.number().int().positive().default(8787),
}).superRefine((env, ctx) => {
  if (env.CATALOG_MODE === "storefront" && !env.SHOPIFY_STORE_MCP_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SHOPIFY_STORE_MCP_URL"],
      message: "required when CATALOG_MODE=storefront",
    });
  }
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
