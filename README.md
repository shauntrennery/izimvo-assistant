# Izimvo — Embeddable Voice Shopping Adviser

A voice-first shopping adviser any site installs with one script tag. See
[PLAN.md](PLAN.md) for full architecture/contracts and [CLAUDE.md](CLAUDE.md)
for working conventions.

## Layout

```
packages/
  backend/   Hono + Drizzle + zod. Functional core (core/, clients/) + shell (http/, db/).
  loader/    Embeddable Shadow-DOM widget (Phase 3+).
```

## Phase 0 — Prereqs (manual)

These require external accounts and are done once, by hand:

1. **Speechify agent** — create the single shared agent in the Speechify
   console/API; note its `AGENT_ID`. Configure the prompt scaffold, the
   `search_products` webhook tool (pointed at `POST /v1/tools/search-products`,
   HMAC secret on both sides), the client tools (`render_products`,
   `update_cart`, `open_checkout`), and enable post-call evaluation. See
   PLAN.md §8.
2. **Shopify Global Catalog** — obtain client-credentials (id/secret + token
   URL + MCP URL) from the Dev Dashboard; create at least one saved catalog
   (slug) per launch category.
3. **Postgres** — a database (Supabase or local). Set `DATABASE_URL`.

**Acceptance:** a manual `curl` mints a Speechify session, and a manual catalog
search returns products.

## Setup

```bash
pnpm install
cp packages/backend/.env.example packages/backend/.env   # fill in secrets

# DB
pnpm --filter @izimvo/backend db:generate   # generate migration from schema
pnpm --filter @izimvo/backend db:migrate    # apply to DATABASE_URL
pnpm --filter @izimvo/backend db:seed       # seed one demo site + key

# run
pnpm --filter @izimvo/backend dev           # http://localhost:8787
```

## Test & typecheck

```bash
pnpm test
pnpm typecheck
```

## Build status

- **Phase 1 — backend skeleton + session mint** ✅ `POST /v1/session` with
  site-key validation, exact-hostname domain binding, per-key + per-IP rate
  limiting, server-side category resolution, Speechify mint, persistence.
  Contract test: allowlisted origin → token; non-allowlisted → 403.
- **Phase 2 — catalog bridge + search tool** ✅ `jwtCache` (client-credentials,
  60-min TTL, coalesced refresh), `CatalogClient` Global impl behind the swap
  interface, `POST /v1/tools/search-products` with HMAC verify, server-side
  scope resolution from the conversation id, ≤3 results, UTM-tagged checkout
  URLs. Contract test: signed → ≤3 tagged products; unsigned → 401.
- **Phase 3 — loader + widget** ✅ `packages/loader`: data-* attribute parsing,
  `/v1/session` mint, agent-runtime adapter (SDK isolated behind an interface),
  client tools (`render_products`/`update_cart`/`open_checkout`) with arg
  guards, Shadow-DOM widget (orb states, product cards, `prefers-reduced-motion`),
  iOS-safe audio unlock on the orb tap, clean teardown on `ended`. Entry bundle
  **3.3 KB gzip** (budget < 15 KB). Local test page:
  `packages/loader/examples/host.html`. The live voice loop additionally needs
  the Phase 0 Speechify agent + SDK wired into `loadRuntime`.
- **Phase 4 — checkout handoff + attribution** ✅ `open_checkout` (and card
  clicks) open the UTM-tagged URL and fire a `keepalive` beacon to
  `POST /v1/checkout`; the backend re-derives the session from `utm_content`,
  binds the request Origin to the session's origin, and persists the
  `attributions` row with the precise UPID. Contract test: click-through carries
  UTM + records a row; origin mismatch → 403.
- Phases 5–6: in progress per PLAN.md §10.
