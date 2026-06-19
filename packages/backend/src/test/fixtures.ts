import type { FakeData } from "./fakes.js";

/** A single seeded site with one key, two allowed domains, two categories. */
export function seedData(): FakeData {
  const siteId = "site_1";
  return {
    apiKeys: [
      {
        id: "key_1",
        siteId,
        publicKey: "pk_live_demo",
        allowedDomains: ["shop.example.com", "www.example.com"],
        rateLimitRpm: 60,
        revokedAt: null,
      },
    ],
    sites: [
      {
        site: {
          id: siteId,
          status: "active",
          catalogMode: "global",
          defaultLocale: "en-ZA",
          defaultVoiceId: null,
        },
        defaultCategorySlug: "trail-running",
      },
    ],
    categories: [
      {
        id: "cat_1",
        siteId,
        slug: "trail-running",
        taxonomyId: "tax-123",
        savedCatalogSlug: "trail-running-za",
      },
      {
        id: "cat_2",
        siteId,
        slug: "hiking-boots",
        taxonomyId: "tax-456",
        savedCatalogSlug: "hiking-boots-za",
      },
    ],
  };
}
