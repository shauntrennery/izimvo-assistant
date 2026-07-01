import { Hono } from "hono";
import { cors } from "hono/cors";
import { getConversationCart } from "../infra/conversationCart.js";
import { getConversationProducts } from "../infra/conversationProducts.js";
import type { AppDeps } from "./deps.js";
import { addToCartRoutes } from "./tools.add-to-cart.js";
import { catalogSearchRoutes } from "./catalog.search.js";
import { checkoutRoutes } from "./checkout.js";
import { SEARCH_PAGE_HTML } from "./searchPage.js";
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

  // Loader polls this to render product cards for its conversation (cid is the
  // unguessable conversation UUID; results are non-sensitive product data).
  app.get("/v1/conversation-products", (c) => {
    const cid = c.req.query("cid");
    return c.json({ products: cid ? getConversationProducts(cid) : [] });
  });

  // Loader polls this to render the current cart for its conversation (same
  // unguessable-cid basis as conversation-products).
  app.get("/v1/conversation-cart", (c) => {
    const cid = c.req.query("cid");
    return c.json({ cart: cid ? getConversationCart(cid) : null });
  });

  app.route("/v1/session", sessionRoutes(deps));
  app.route("/v1/catalog/search", catalogSearchRoutes(deps));
  app.route("/v1/tools/search-products", searchProductsRoutes(deps));
  app.route("/v1/tools/add-to-cart", addToCartRoutes(deps));
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

  // Catalogue search page (self-contained HTML compiled into the bundle, so it
  // needs no file read or deps wiring). Calls GET /v1/catalog/search same-origin.
  app.get("/search", (c) => {
    c.header("content-type", "text/html; charset=utf-8");
    return c.body(SEARCH_PAGE_HTML);
  });

  return app;
}

export type { AppDeps };
