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
pnpm --filter @izimvo/backend db:seed       # seed the Danetti site + key

# run
pnpm --filter @izimvo/backend dev           # http://localhost:8787
```

## Storefront mode (Danetti)

This deployment runs in **Storefront** mode, scoped to a single Shopify store
(Danetti) via its own public `/api/mcp` endpoint — no JWT. Search, product
detail, cart, and policy/FAQ answers all come from that one store.

**Env** (set on the host / Railway; not in the repo):

```
CATALOG_MODE=storefront
SHOPIFY_STORE_MCP_URL=https://www.danetti.com/api/mcp
STORE_DISPLAY_NAME=Danetti
STORE_DEFAULT_COUNTRY=GB          # drives ships-to + GBP when the LLM omits it
```

`pnpm db:seed` seeds the Danetti site (`pk_live_danetti`, `en-GB`, furniture
categories). Reseeding an existing DB means dropping first — the seed is
insert-only.

**Speechify agent** — beyond the shared `search_products` tool, a storefront
agent adds two HMAC-signed webhook tools. Each tool URL must carry
`?cid={{system__conversation_id}}` so the backend can resolve the session
server-side (the LLM never passes scope, cart id, or variant):

| Tool | Endpoint | LLM params |
|------|----------|-----------|
| `search_products` | `POST /v1/tools/search-products?cid=…` | `query`, `max_price?`, `color?`, `ships_to?` |
| `add_to_cart` | `POST /v1/tools/add-to-cart?cid=…` | `product_id`, `quantity?`, `options?` |
| `product_info` | `POST /v1/tools/product-info?cid=…` | `product_id?`, `question?`, `options?` |

`add_to_cart` resolves the purchasable variant from `product_id` (+ `options`
for multi-variant items), builds the store cart across turns, and returns a real
UTM-tagged Danetti checkout URL. `product_info` grounds answers in
`get_product_details` + `search_shop_policies_and_faqs` (dimensions, materials,
delivery, returns, warranty) so the adviser never invents facts.

Prompt posture: a Danetti furniture adviser (en-GB / GBP) — opinionated, ≤3
options spoken, confirms before checkout.

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
- **Phase 5 — post-call webhook + usage** ✅ `POST /v1/webhooks/speechify`
  (HMAC-verified): correlate the conversation id back to the session and persist
  a `call_ended` usage event with the evaluation / transcript ref / duration;
  `session_start` is recorded at mint and `tool_call` at search. Acks
  uncorrelated calls (200, `recorded:false`) to stop retries. Contract test:
  signed → usage keyed to the right session; unsigned → 401.
- **Storefront (Danetti)** ✅ single-store mode over `www.danetti.com/api/mcp`:
  `search_catalog` + native `get_product_details`, a real MCP-managed cart
  (`add_to_cart` → `update_cart`/`get_cart`, cart id kept per conversation, real
  UTM-tagged checkout URL), and grounded product Q&A (`product_info` →
  `get_product_details` + `search_shop_policies_and_faqs`). Loader renders a cart
  panel (poll `GET /v1/conversation-cart`) with a real checkout button (entry
  still **4.4 KB gzip**, budget < 15 KB). Verified end-to-end against the live
  Danetti MCP; contract tests for the cart client and both tool routes.
- **Phase 6 — hardening** ⏳ remaining: Redis-backed rate limiting for
  horizontal scale (in-memory conversation cart/products lost on restart),
  loader versioned-core split, structured logs/request ids, abuse/load testing.
