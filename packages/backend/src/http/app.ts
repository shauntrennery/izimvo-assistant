import { Hono } from "hono";
import type { AppDeps } from "./deps.js";
import { searchProductsRoutes } from "./tools.search-products.js";
import { sessionRoutes } from "./session.js";

/**
 * Composition root for the HTTP shell. Hono lives only in this layer; routes
 * receive `deps` and delegate to the framework-free core + clients.
 */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.route("/v1/session", sessionRoutes(deps));
  app.route("/v1/tools/search-products", searchProductsRoutes(deps));

  return app;
}

export type { AppDeps };
