import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Postgres schema (PLAN §6). Drizzle is the single source of truth for the
 * table shapes; migrations are generated from this file via drizzle-kit.
 */

export const sites = pgTable("sites", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: text("status", { enum: ["active", "suspended"] })
    .notNull()
    .default("active"),
  catalogMode: text("catalog_mode", { enum: ["global", "storefront"] })
    .notNull()
    .default("global"),
  merchantUrl: text("merchant_url"),
  defaultVoiceId: text("default_voice_id"),
  defaultLocale: text("default_locale").notNull().default("en-ZA"),
  defaultCategorySlug: text("default_category_slug"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id),
  publicKey: text("public_key").notNull().unique(),
  secretHash: text("secret_hash"),
  allowedDomains: text("allowed_domains").array().notNull(),
  rateLimitRpm: integer("rate_limit_rpm").notNull().default(60),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),
    slug: text("slug").notNull(),
    taxonomyId: text("taxonomy_id"),
    savedCatalogSlug: text("saved_catalog_slug"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    siteSlug: unique("categories_site_slug_unique").on(t.siteId, t.slug),
  }),
);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id),
  speechifyConversationId: text("speechify_conversation_id"),
  categorySlug: text("category_slug").notNull(),
  userIdentity: text("user_identity"),
  origin: text("origin").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const usageEvents = pgTable("usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id),
  kind: text("kind", {
    enum: ["session_start", "tool_call", "call_ended"],
  }).notNull(),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const attributions = pgTable("attributions", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id),
  upid: text("upid").notNull(),
  checkoutUrl: text("checkout_url").notNull(),
  utm: jsonb("utm").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
