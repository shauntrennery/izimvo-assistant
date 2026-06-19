import type { MintSessionInput, SpeechifyClient } from "../clients/speechify.js";
import type { Category } from "../core/category.js";
import type { ApiKey, Site } from "../core/siteKeys.js";
import type {
  NewAttribution,
  NewSession,
  NewUsageEvent,
  Repo,
} from "../db/repo.js";

/**
 * In-memory test doubles for the imperative-shell dependencies. They let the
 * contract tests exercise the real route + core logic with no DB or network.
 */

export interface FakeData {
  apiKeys: ApiKey[];
  sites: Array<{ site: Site; defaultCategorySlug: string | null }>;
  categories: Category[];
}

export interface FakeRepo extends Repo {
  sessions: Array<NewSession & { id: string; conversationId: string | null }>;
  usage: NewUsageEvent[];
  attributions: NewAttribution[];
}

export function createFakeRepo(data: FakeData): FakeRepo {
  const sessions: FakeRepo["sessions"] = [];
  const usage: NewUsageEvent[] = [];
  const attributionsList: NewAttribution[] = [];
  let counter = 0;

  return {
    sessions,
    usage,
    attributions: attributionsList,

    async findApiKeyByPublicKey(publicKey) {
      return data.apiKeys.find((k) => k.publicKey === publicKey) ?? null;
    },
    async findSiteById(siteId) {
      return data.sites.find((s) => s.site.id === siteId) ?? null;
    },
    async listCategoriesForSite(siteId) {
      return data.categories.filter((c) => c.siteId === siteId);
    },
    async createSession(input) {
      const id = `sess_${++counter}`;
      sessions.push({ ...input, id, conversationId: null });
      return { id };
    },
    async recordUsageEvent(input) {
      usage.push(input);
    },
    async findSessionByConversationId(conversationId) {
      const s = sessions.find((s) => s.conversationId === conversationId);
      return s ? { id: s.id, siteId: s.siteId } : null;
    },
    async setSessionConversationId(sessionId, conversationId) {
      const s = sessions.find((s) => s.id === sessionId);
      if (s) s.conversationId = conversationId;
    },
    async recordAttribution(input) {
      attributionsList.push(input);
    },
  };
}

export function createFakeSpeechify(
  onMint?: (input: MintSessionInput) => void,
): SpeechifyClient {
  return {
    async mintSession(input) {
      onMint?.(input);
      return {
        sessionToken: "tok_test_123",
        sessionUrl: "wss://realtime.speechify.test/session/abc",
      };
    },
  };
}
