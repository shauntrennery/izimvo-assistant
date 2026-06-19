import { loadEnv } from "../config/env.js";
import { createDb } from "./client.js";
import { apiKeys, categories, sites } from "./schema.js";

/**
 * Seed one site + key + categories (PLAN §10 Phase 1, §12: seed via migration
 * for now — no self-serve dashboard in v1). Idempotent on the public key.
 */
async function main() {
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

  await db.insert(categories).values([
    { siteId, slug: "trail-running", taxonomyId: null, savedCatalogSlug: "trail-running-za" },
    { siteId, slug: "hiking-boots", taxonomyId: null, savedCatalogSlug: "hiking-boots-za" },
  ]);

  // eslint-disable-next-line no-console
  console.log(`Seeded site ${siteId} with key pk_live_demo`);
  process.exit(0);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
