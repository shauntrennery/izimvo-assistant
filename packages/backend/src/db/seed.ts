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
      name: "Demo Outdoor Co",
      status: "active",
      catalogMode: "global",
      defaultLocale: "en-ZA",
      defaultCategorySlug: "trail-running",
    })
    .returning({ id: sites.id });

  const siteId = site!.id;

  await db.insert(apiKeys).values({
    siteId,
    publicKey: "pk_live_demo",
    allowedDomains: ["shop.example.com", "www.example.com", "localhost"],
    rateLimitRpm: 60,
  });

  // Demo categories. savedCatalogSlug null → unscoped global-catalog search
  // (scoped only by the shopper's query); set a real Shopify saved-catalog slug
  // to hard-bound a category to a curated catalog.
  await db.insert(categories).values(
    ["trail-running", "hiking-boots", "rain-shells", "backpacks", "sleeping-bags", "tents"].map(
      (slug) => ({ siteId, slug, taxonomyId: null, savedCatalogSlug: null }),
    ),
  );

  // eslint-disable-next-line no-console
  console.log(`Seeded site ${siteId} with key pk_live_demo`);
  process.exit(0);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
