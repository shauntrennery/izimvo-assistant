import { and, eq } from "drizzle-orm";
import type { ApiKey, Site } from "../core/siteKeys.js";
import type { Category } from "../core/category.js";
import type { Db } from "./client.js";
import {
  apiKeys,
  attributions,
  categories,
  sessions,
  sites,
  usageEvents,
} from "./schema.js";

/**
 * Persistence boundary. Route handlers depend on this interface, never on
 * Drizzle directly, so contract tests run against an in-memory fake and
 * production runs against Postgres. Domain types (Site/ApiKey/Category) are
 * returned, not raw rows.
 */
export interface Repo {
  findApiKeyByPublicKey(publicKey: string): Promise<ApiKey | null>;
  findSiteById(siteId: string): Promise<{ site: Site; defaultCategorySlug: string | null } | null>;
  listCategoriesForSite(siteId: string): Promise<Category[]>;
  createSession(input: NewSession): Promise<{ id: string }>;
  recordUsageEvent(input: NewUsageEvent): Promise<void>;
  findSessionByConversationId(conversationId: string): Promise<{ id: string; siteId: string } | null>;
  /** Read model for the search tool: resolve scope from a conversation id (PLAN §7.4). */
  findScopeByConversationId(conversationId: string): Promise<SearchScope | null>;
  setSessionConversationId(sessionId: string, conversationId: string): Promise<void>;
  recordAttribution(input: NewAttribution): Promise<void>;
}

export interface SearchScope {
  sessionId: string;
  siteId: string;
  categorySlug: string;
  savedCatalogSlug: string | null;
}

export interface NewSession {
  siteId: string;
  categorySlug: string;
  userIdentity: string | null;
  origin: string;
  conversationId: string | null;
}

export interface NewUsageEvent {
  sessionId: string;
  kind: "session_start" | "tool_call" | "call_ended";
  payload: unknown;
}

export interface NewAttribution {
  sessionId: string;
  upid: string;
  checkoutUrl: string;
  utm: unknown;
}

export function createRepo(db: Db): Repo {
  return {
    async findApiKeyByPublicKey(publicKey) {
      const [row] = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.publicKey, publicKey))
        .limit(1);
      if (!row) return null;
      return {
        id: row.id,
        siteId: row.siteId,
        publicKey: row.publicKey,
        allowedDomains: row.allowedDomains,
        rateLimitRpm: row.rateLimitRpm,
        revokedAt: row.revokedAt,
      };
    },

    async findSiteById(siteId) {
      const [row] = await db
        .select()
        .from(sites)
        .where(eq(sites.id, siteId))
        .limit(1);
      if (!row) return null;
      return {
        site: {
          id: row.id,
          status: row.status,
          catalogMode: row.catalogMode,
          defaultLocale: row.defaultLocale,
          defaultVoiceId: row.defaultVoiceId,
        },
        defaultCategorySlug: row.defaultCategorySlug,
      };
    },

    async listCategoriesForSite(siteId) {
      const rows = await db
        .select()
        .from(categories)
        .where(eq(categories.siteId, siteId));
      return rows.map((r) => ({
        id: r.id,
        siteId: r.siteId,
        slug: r.slug,
        taxonomyId: r.taxonomyId,
        savedCatalogSlug: r.savedCatalogSlug,
      }));
    },

    async createSession(input) {
      const [row] = await db
        .insert(sessions)
        .values({
          siteId: input.siteId,
          categorySlug: input.categorySlug,
          userIdentity: input.userIdentity,
          origin: input.origin,
          speechifyConversationId: input.conversationId,
        })
        .returning({ id: sessions.id });
      return { id: row!.id };
    },

    async findScopeByConversationId(conversationId) {
      const [row] = await db
        .select({
          sessionId: sessions.id,
          siteId: sessions.siteId,
          categorySlug: sessions.categorySlug,
          savedCatalogSlug: categories.savedCatalogSlug,
        })
        .from(sessions)
        .innerJoin(
          categories,
          and(
            eq(categories.siteId, sessions.siteId),
            eq(categories.slug, sessions.categorySlug),
          ),
        )
        .where(eq(sessions.speechifyConversationId, conversationId))
        .limit(1);
      return row ?? null;
    },

    async recordUsageEvent(input) {
      await db.insert(usageEvents).values({
        sessionId: input.sessionId,
        kind: input.kind,
        payload: input.payload as object,
      });
    },

    async findSessionByConversationId(conversationId) {
      const [row] = await db
        .select({ id: sessions.id, siteId: sessions.siteId })
        .from(sessions)
        .where(eq(sessions.speechifyConversationId, conversationId))
        .limit(1);
      return row ?? null;
    },

    async setSessionConversationId(sessionId, conversationId) {
      await db
        .update(sessions)
        .set({ speechifyConversationId: conversationId })
        .where(and(eq(sessions.id, sessionId)));
    },

    async recordAttribution(input) {
      await db.insert(attributions).values({
        sessionId: input.sessionId,
        upid: input.upid,
        checkoutUrl: input.checkoutUrl,
        utm: input.utm as object,
      });
    },
  };
}
