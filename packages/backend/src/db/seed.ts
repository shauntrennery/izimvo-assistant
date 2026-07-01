import { loadEnv } from "../config/env.js";
import { loadDotEnv } from "../config/loadDotenv.js";
import { createDb } from "./client.js";
import { apiKeys, categories, sites } from "./schema.js";

/**
 * Seed one site + key + categories (PLAN §10 Phase 1, §12: seed via migration
 * for now — no self-serve dashboard in v1). Idempotent on the public key.
 */
async function main() {
  loadDotEnv();
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL);

  const [site] = await db
    .insert(sites)
    .values({
      name: "Danetti",
      status: "active",
      catalogMode: "storefront",
      merchantUrl: "https://www.danetti.com",
      defaultLocale: "en-GB",
      defaultCategorySlug: "furniture",
    })
    .returning({ id: sites.id });

  const siteId = site!.id;

  await db.insert(apiKeys).values({
    siteId,
    publicKey: "pk_live_danetti",
    allowedDomains: [
      "localhost",
      // the store itself, if the widget is embedded on the live site for testing
      "www.danetti.com",
      // the hosted demo storefront runs on the backend's own origin
      "izimvo-backend-production.up.railway.app",
    ],
    rateLimitRpm: 60,
  });

  // Storefront categories. savedCatalogSlug null → the store's whole catalog,
  // scoped only by the shopper's query (how the Storefront MCP search works).
  await db.insert(categories).values(
    [
      "furniture",
      "dining-chairs",
      "dining-tables",
      "sofas",
      "office-chairs",
      "desks",
      "bar-stools",
    ].map((slug) => ({ siteId, slug, taxonomyId: null, savedCatalogSlug: null })),
  );

  // eslint-disable-next-line no-console
  console.log(`Seeded site ${siteId} with key pk_live_danetti`);
  process.exit(0);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
