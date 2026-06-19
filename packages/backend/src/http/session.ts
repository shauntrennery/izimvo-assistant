import { Hono } from "hono";
import { z } from "zod";
import { resolveCategory } from "../core/category.js";
import { bindRequest, hostnameFromHeaders } from "../core/siteKeys.js";
import type { AppDeps } from "./deps.js";
import { clientIp } from "./util.js";

/**
 * POST /v1/session (PLAN §7.2). Mints a private Speechify session, gated by
 * site-key validation, exact-hostname domain binding, rate limiting, and
 * server-side category resolution. Never returns the API key or agent id.
 */

const sessionRequestSchema = z.object({
  siteKey: z.string().min(1),
  category: z.string().optional(),
  userIdentity: z.string().min(1).optional(),
  locale: z.string().min(2).optional(),
  pageUrl: z.string().url(),
});

const WINDOW_MS = 60_000;

export function sessionRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = sessionRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request" }, 400);
    }
    const req = parsed.data;

    // Per-IP burst limit first — cheapest gate, blunts unauthenticated floods.
    const ip = clientIp(c.req.raw.headers);
    if (!deps.rateLimiter.take(`ip:${ip}`, deps.sessionIpRateLimitPerMin, WINDOW_MS)) {
      return c.json({ error: "rate_limited" }, 429);
    }

    const apiKey = await deps.repo.findApiKeyByPublicKey(req.siteKey);
    const siteRow = apiKey ? await deps.repo.findSiteById(apiKey.siteId) : null;
    const hostname = hostnameFromHeaders({
      origin: c.req.header("origin"),
      referer: c.req.header("referer"),
    });

    const bound = bindRequest({
      apiKey,
      site: siteRow?.site ?? null,
      hostname,
    });
    if (!bound.ok) {
      // Domain binding and key validity collapse to 403 — never reveal which
      // check failed to an untrusted origin.
      return c.json({ error: "forbidden" }, 403);
    }
    const { apiKey: key, site, hostname: origin } = bound.value;

    // Per-key rpm limit (authenticated, billing-relevant).
    if (!deps.rateLimiter.take(`key:${key.id}`, key.rateLimitRpm, WINDOW_MS)) {
      return c.json({ error: "rate_limited" }, 429);
    }

    const cats = await deps.repo.listCategoriesForSite(site.id);
    const resolved = resolveCategory({
      raw: req.category,
      categories: cats,
      defaultSlug: siteRow!.defaultCategorySlug,
    });
    if (!resolved.ok) {
      return c.json({ error: "unknown_category" }, 400);
    }

    const locale = req.locale ?? site.defaultLocale;

    let minted;
    try {
      minted = await deps.speechify.mintSession({
        category: resolved.value.label,
        merchantScope: site.catalogMode,
        locale,
        userIdentity: req.userIdentity ?? null,
      });
    } catch {
      return c.json({ error: "session_mint_failed" }, 502);
    }

    const created = await deps.repo.createSession({
      siteId: site.id,
      categorySlug: resolved.value.slug,
      userIdentity: req.userIdentity ?? null,
      origin,
      conversationId: minted.conversationId,
    });

    void deps.repo
      .recordUsageEvent({
        sessionId: created.id,
        kind: "session_start",
        payload: { categorySlug: resolved.value.slug, locale },
      })
      .catch(() => undefined);

    return c.json({
      sessionToken: minted.sessionToken,
      sessionUrl: minted.sessionUrl,
    });
  });

  return app;
}
