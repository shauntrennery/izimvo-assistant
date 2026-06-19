import { Hono } from "hono";
import { z } from "zod";
import { extractUtm } from "../core/attribution.js";
import { hostnameFromHeaders } from "../core/siteKeys.js";
import type { AppDeps } from "./deps.js";

/**
 * POST /v1/checkout (PLAN §10 Phase 4). The loader reports a pursued checkout
 * (agent `open_checkout` or a card click). We re-derive the session from the
 * URL's `utm_content` (which we stamped server-side at search time), bind the
 * request Origin to the session's recorded origin, and persist the attribution
 * row. The UTM tags themselves were already applied in the search tool
 * (Guardrail §11.9) — this records the purchase-intent for revenue share.
 */

const checkoutSchema = z.object({
  checkoutUrl: z.string().url(),
  upid: z.string().min(1),
});

export function checkoutRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = checkoutSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

    const { sessionId, utm } = extractUtm(parsed.data.checkoutUrl);
    if (!sessionId) return c.json({ error: "untagged_url" }, 400);

    const session = await deps.repo.findSessionById(sessionId);
    if (!session) return c.json({ error: "unknown_session" }, 404);

    // Bind the click to the same origin that minted the session.
    const hostname = hostnameFromHeaders({
      origin: c.req.header("origin"),
      referer: c.req.header("referer"),
    });
    if (!hostname || hostname !== session.origin) {
      return c.json({ error: "forbidden" }, 403);
    }

    await deps.repo.recordAttribution({
      sessionId: session.id,
      upid: parsed.data.upid,
      checkoutUrl: parsed.data.checkoutUrl,
      utm,
    });

    return c.body(null, 204);
  });

  return app;
}
