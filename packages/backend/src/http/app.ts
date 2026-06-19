import { Hono } from "hono";
import { cors } from "hono/cors";
import { listToolCaptures, pushToolCapture } from "../infra/toolCapture.js";
import type { AppDeps } from "./deps.js";
import { checkoutRoutes } from "./checkout.js";
import { searchProductsRoutes } from "./tools.search-products.js";
import { sessionRoutes } from "./session.js";
import { speechifyWebhookRoutes } from "./webhooks.speechify.js";

/**
 * Composition root for the HTTP shell. Hono lives only in this layer; routes
 * receive `deps` and delegate to the framework-free core + clients.
 */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  // The widget runs on third-party host pages and calls /v1/* cross-origin, so
  // the browser issues CORS preflights. Authorization is enforced by domain
  // binding + HMAC, not CORS, so reflecting any origin is safe here. (The
  // Speechify webhook calls are server-to-server and carry no Origin.)
  app.use(
    "/v1/*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
      maxAge: 600,
    }),
  );

  app.get("/health", (c) => c.json({ ok: true }));

  app.route("/v1/session", sessionRoutes(deps));
  app.route("/v1/tools/search-products", searchProductsRoutes(deps));
  app.route("/v1/checkout", checkoutRoutes(deps));
  app.route("/v1/webhooks/speechify", speechifyWebhookRoutes(deps));

  // Serve the embeddable loader bundle from our own origin so a host site's
  // <script src=".../v1/loader.js"> needs no separate CDN. The loader derives
  // its API base from this origin, so it calls back here automatically.
  if (deps.loaderBundle) {
    const { js, map } = deps.loaderBundle;
    app.get("/v1/loader.js", (c) => {
      c.header("content-type", "application/javascript; charset=utf-8");
      c.header("cache-control", "public, max-age=300");
      return c.body(js);
    });
    if (map) {
      app.get("/v1/loader.js.map", (c) => {
        c.header("content-type", "application/json; charset=utf-8");
        return c.body(map);
      });
    }
  }

  // Hosted demo storefront (same origin as the loader, so it mints sessions
  // against this backend — its host must be in the demo key's allowed_domains).
  if (deps.demoHtml) {
    const html = deps.demoHtml;
    app.get("/", (c) => c.redirect("/demo"));
    app.get("/demo", (c) => {
      c.header("content-type", "text/html; charset=utf-8");
      return c.body(html);
    });
  }

  if (deps.docsHtml) {
    const html = deps.docsHtml;
    app.get("/docs", (c) => {
      c.header("content-type", "text/html; charset=utf-8");
      return c.body(html);
    });
  }

  // TEMP (wiring): client-tool beacon from the loader, to confirm the agent's
  // render_products dispatch + payload. Remove once card-render is confirmed.
  app.post("/v1/debug/tool-capture", async (c) => {
    const b = (await c.req.json().catch(() => null)) as { name?: unknown; args?: unknown } | null;
    if (b && typeof b === "object") {
      pushToolCapture({ ts: Date.now(), name: String(b.name ?? ""), args: b.args });
    }
    return c.body(null, 204);
  });
  app.get("/v1/debug/tool-capture", (c) => {
    if (c.req.query("token") !== deps.toolHmacSecret) return c.json({ error: "forbidden" }, 403);
    return c.json({ captures: listToolCaptures() });
  });

  return app;
}

export type { AppDeps };
