# Izimvo — Embeddable Voice Shopping Adviser — Build Plan

> **Izimvo** (isiXhosa/isiZulu: *opinions, views*) — a voice shopping adviser you embed on any site. You ask; it gives you its considered view on what to buy, then finds, compares, and hands off to checkout.
> This document is the source of truth for Claude Code. Treat the **Guardrails** section as hard constraints, not suggestions.

---

## 1. What we're building

A distributable, voice-first shopping adviser that any website owner installs with a single script tag:

```html
<script src="https://cdn.izimvo.com/v1/loader.js"
        data-site-key="pk_live_..."
        data-category="trail-running"></script>
```

When a visitor taps the widget, they hold a real-time spoken conversation with an AI shopping adviser. It searches a live product catalog, narrows by voice across multiple turns, gives its opinion, paints product cards into the page as it talks, and hands off to a checkout link.

**Brand posture:** not a search box — an opinionated, attentive adviser. It has a view. The voice is warm, concise, and decisive: "Here's what I'd get, and why."

**Three moving parts:**

1. **`loader.js`** — a tiny, versioned, CDN-served script. Reads its own attributes, calls our backend for a session, boots the Speechify voice agent via its programmatic API, registers client tools, and renders a Shadow-DOM widget UI (orb + product cards).
2. **Backend** (we build & host) — mints private Speechify session tokens gated by site-key + domain binding; serves the `search_products` webhook tool that bridges to Shopify; receives post-call webhooks; tracks usage and purchase attribution per site.
3. **Speechify Voice Agent** (configured once in the Speechify console/API) — the realtime voice loop. A *single* agent serves all host sites; per-site scope is injected as session state, never as new agents.

**Monetization (default fork — see §3):** content/affiliate model. Host gets a free engaging adviser widget; we earn on Shopify promoted-placement revenue for attributed purchases. Billing attribution is per site-key.

---

## 2. Decisions already made (do not re-litigate)

- **Channel:** web/PWA embed over WebRTC. No telephony, no WhatsApp in v1.
- **Session security:** private (server-minted token) mode only. The Speechify API key never reaches the browser. Public-agent + origin-allowlist mode is explicitly rejected for a distributed widget (see Guardrails §11.1).
- **Catalog:** Shopify **Global Catalog MCP** (cross-merchant), authenticated with client-credentials JWT.
- **One agent, N sites:** category and per-site config are passed as `dynamic_variables` at session-mint time. We never mint an agent per customer.
- **Stack:** TypeScript strict everywhere. Functional core, imperative shell. Clean module boundaries.

---

## 3. The catalog fork (stated, with a swap point)

Default to **Global Catalog** (cross-merchant discovery, JWT auth, promoted-placement revenue). This matches "any website owner installs it" — the host is a content/affiliate site, not necessarily a merchant.

**Swap point:** if a given deployment is a *single merchant on their own store*, swap the catalog client to **Storefront Catalog MCP** (single-merchant, no auth, scoped to that store). Isolate this behind the `CatalogClient` interface (§7.5) so it's a one-file swap. Do not let merchant-specific assumptions leak past that interface.

---

## 4. Architecture

### 4.1 Components

```
Host site (3rd-party)            Our infra                         External
──────────────────────          ───────────────────────────       ─────────────────────
<script loader.js> ──┐
   Shadow-DOM widget  │ POST /v1/session   ┌──────────────┐
   (orb + cards)      ├───────────────────▶│  Backend     │
   startAgent()       │                    │  (Hono/TS)   │
        ▲             │  token + url        │              │  mint session
        │             │◀────────────────────┤              ├──────────────▶ Speechify API
   client tools       │                    │              │
   (render_products,  │  WebRTC realtime    │  search tool │  POST /v1/agents/{id}/sessions
    update_cart,      │◀═══════════════════╪══ Speechify ═╪══ agent realtime session
    open_checkout)    │                    │  webhook     │
        │             │  POST /v1/tools/    │  (HMAC)      │  search_global_products
        ▼             │     search-products │  Catalog     ├──────────────▶ Shopify Global
   checkout link ─────┼────────────────────▶│  client (JWT)│                  Catalog MCP
                      │                    │  + JWT cache │
                      │  POST /v1/webhooks/ │  Postgres    │
                      │     speechify       │  (registry,  │
                      │◀────────────────────┤   usage,     │
                                            │   attrib.)   │
                                            └──────────────┘
```

### 4.2 Request lifecycle (session start → purchase)

```mermaid
sequenceDiagram
    participant V as Visitor
    participant L as loader.js
    participant B as Backend
    participant S as Speechify
    participant Sh as Shopify Global Catalog

    V->>L: taps widget (user gesture; required for mic+audio)
    L->>B: POST /v1/session {siteKey, category, pageUrl, userIdentity?}
    B->>B: validate siteKey ↔ Origin/Referer, rate-limit, map category→taxonomy/slug
    B->>S: POST /v1/agents/{id}/sessions (Bearer API key, dynamic_variables)
    S-->>B: {sessionToken, sessionUrl}
    B-->>L: {sessionToken, sessionUrl}
    L->>S: startAgent({sessionToken, sessionUrl}) — WebRTC connect
    V->>S: "waterproof trail shoes under R2000"
    S->>B: webhook tool search_products(args) (HMAC-signed)
    B->>Sh: search_global_products (cached JWT)
    Sh-->>B: products clustered by UPID
    B-->>S: top 3 results (structured)
    S->>L: client tool render_products({items})
    L->>V: cards painted; adviser gives its view + narrowing question
    V->>S: "the second one"
    S->>L: client tool open_checkout({url}) — UTM-tagged
    V->>Sh: completes checkout (attributed)
    S->>B: POST /v1/webhooks/speechify (transcript + evaluation)
    B->>B: record usage + attribution per siteKey
```

---

## 5. Tech stack & repo layout

- **Language:** TypeScript, `strict: true`, `noUncheckedIndexedAccess: true`.
- **Backend runtime:** Node 20+ with **Hono** (lightweight, edge-portable, first-class TS). Next.js route handlers acceptable if preferred, but keep the API framework-thin and the domain logic framework-free.
- **DB:** Postgres (Supabase). **Drizzle ORM** for type-safe schema + queries.
- **Loader bundle:** built with **tsup/esbuild** to a single small IIFE (`loader.js`) + a versioned ESM core it fetches. Target < 15KB gzip for the loader entry.
- **Validation:** **zod** at every boundary (incoming requests, tool args, env).
- **HTTP:** native `fetch`. No heavy SDKs.
- **Tests:** vitest. Contract tests for every endpoint and the catalog client.

```
izimvo/
  packages/
    loader/          # the embeddable script + widget UI (Shadow DOM)
      src/
        loader.ts        # entry: parse attributes, fetch session, boot agent
        widget.ts        # Shadow-DOM UI, orb states, card rendering
        tools.ts         # client tool handlers (render_products, update_cart, open_checkout)
        mic.ts           # user-gesture/audio-context handling (iOS-safe)
      tsup.config.ts
    backend/
      src/
        http/            # Hono routes (imperative shell)
          session.ts
          tools.search-products.ts
          webhooks.speechify.ts
        core/            # pure domain logic (no framework imports)
          siteKeys.ts        # validation, domain binding
          category.ts        # attribute → taxonomy/slug mapping + sanitization
          attribution.ts     # UTM construction, purchase attribution
          rateLimit.ts
        clients/
          speechify.ts       # session mint, HMAC verify
          catalog.ts         # CatalogClient impl (Global Catalog) behind interface
          jwtCache.ts        # Shopify JWT cache (60-min TTL)
        db/
          schema.ts          # Drizzle schema
          repo.ts
        config/
          env.ts             # zod-validated env
      drizzle/
  CLAUDE.md          # conventions (see CLAUDE.md)
  PLAN.md            # this file
```

---

## 6. Data model (Postgres)

```sql
sites
  id              uuid pk
  name            text
  status          text         -- active | suspended
  catalog_mode    text         -- 'global' | 'storefront'
  merchant_url    text null    -- only when storefront
  default_voice_id text null
  default_locale  text         -- e.g. 'en-ZA'
  created_at      timestamptz

api_keys
  id              uuid pk
  site_id         uuid fk -> sites
  public_key      text unique  -- pk_live_... (shipped in the host's <script>)
  secret_hash     text         -- if a secret variant is ever needed; hashed
  allowed_domains text[]        -- exact hostnames; used for Origin/Referer binding
  rate_limit_rpm  int
  revoked_at      timestamptz null

categories                     -- per-site category → catalog scope mapping
  id              uuid pk
  site_id         uuid fk
  slug            text         -- 'trail-running' (what host writes in data-category)
  taxonomy_id     text null    -- Shopify taxonomy category id
  saved_catalog_slug text null -- Shopify saved-catalog boundary filter
  unique(site_id, slug)

sessions                       -- one row per minted session (billing + binding)
  id              uuid pk
  site_id         uuid fk
  speechify_conversation_id text null  -- filled when known
  category_slug   text
  user_identity   text null
  origin          text
  created_at      timestamptz

usage_events                   -- minutes / turns for billing attribution
  id              uuid pk
  session_id      uuid fk
  kind            text         -- 'session_start' | 'tool_call' | 'call_ended'
  payload         jsonb
  created_at      timestamptz

attributions                   -- purchase attribution for revenue share
  id              uuid pk
  session_id      uuid fk
  upid            text
  checkout_url    text
  utm             jsonb
  created_at      timestamptz
```

---

## 7. Contracts (the part Claude Code must get exactly right)

### 7.1 Loader attributes (host-facing API — keep stable forever)

| Attribute        | Required | Notes |
|------------------|----------|-------|
| `data-site-key`  | yes      | `pk_live_...`; identifies the site, drives billing + config. |
| `data-category`  | no       | Per-page scope override. Sanitized + mapped server-side. |
| `data-user-id`   | no       | Opaque end-user id → enables cross-session memory. |
| `data-locale`    | no       | BCP-47 override (e.g. `en-ZA`). Falls back to site default. |

The loader reads these from its own `<script>` element (`document.currentScript` at module-eval time; capture immediately).

### 7.2 `POST /v1/session`

```ts
// request (from loader)
interface SessionRequest {
  siteKey: string;
  category?: string;     // raw host attribute — UNTRUSTED
  userIdentity?: string;
  locale?: string;
  pageUrl: string;
}

// response (to loader)
interface SessionResponse {
  sessionToken: string;
  sessionUrl: string;
  // never include the Speechify API key or agent-id
}
```

Server steps: validate `siteKey` → load site + allowed_domains → **bind**: assert `Origin`/`Referer` hostname ∈ allowed_domains (reject 403 otherwise) → rate-limit per key + per IP → resolve `category` against `categories` table (unknown → site default or reject) → mint Speechify session (§7.3) → persist `sessions` row → return token+url.

### 7.3 Speechify session mint (server → Speechify)

```
POST https://api.speechify.ai/v1/agents/{AGENT_ID}/sessions
Authorization: Bearer ${SPEECHIFY_API_KEY}
Content-Type: application/json

{
  "dynamic_variables": {
    "category": "trail running",          // resolved label, safe
    "merchant_scope": "global",
    "locale": "en-ZA"
  },
  "user_identity": "<opaque id|null>",
  "override_language": "en-ZA"
}
→ { sessionToken, sessionUrl }   // confirm exact field names against API reference
```

> NOTE: the embed guide shows `POST /v1/agents/{id}/sessions` for private mode; the overview references `/conversations`. Confirm the canonical endpoint + response shape against the API Reference before wiring; isolate in `clients/speechify.ts`.

### 7.4 `search_products` webhook tool

Declared on the Speechify agent (Speechify-side schema), pointed at `POST /v1/tools/search-products`.

```jsonc
// Speechify tool parameter declaration
"params": [
  { "name": "query",      "type": "string",  "description": "What the shopper wants", "required": true },
  { "name": "max_price",  "type": "number",  "description": "Budget ceiling (ZAR)",   "required": false },
  { "name": "color",      "type": "string",  "description": "Preferred colour",       "required": false },
  { "name": "ships_to",   "type": "string",  "description": "ISO country, default ZA","required": false }
]
```

Handler:

```ts
interface SearchProductsArgs {        // validated with zod
  query: string;
  max_price?: number;
  color?: string;
  ships_to?: string;                  // default 'ZA'
}

interface ProductResult {
  upid: string;
  title: string;
  priceMinor: number;                 // minor units
  currency: string;
  imageUrl?: string;
  bestOfferMerchant?: string;
  checkoutUrl: string;                // UTM-tagged here, server-side
}
```

- **Verify HMAC-SHA256** signature on the incoming request before doing anything (Speechify signs webhook tools).
- Resolve the session's **category/scope server-side** from the conversation id — do NOT trust the LLM to pass category. Merge category's `saved_catalog_slug` as a hard boundary filter.
- Call catalog client, **return at most 3 results** (voice UX — see Guardrails).
- Tag every `checkoutUrl` with attribution UTMs.

### 7.5 `CatalogClient` interface (swap point for Global vs Storefront)

```ts
interface CatalogSearchInput {
  query: string;
  savedCatalogSlug?: string;          // boundary filter
  maxPriceMinor?: number;
  shipsTo?: string;
  optionPreferences?: string[];       // e.g. ['Color','Size']
  limit: number;                      // pass 3
}

interface CatalogClient {
  search(input: CatalogSearchInput): Promise<ProductResult[]>;
  getProduct(upid: string): Promise<ProductDetail>;
}
```

Global Catalog impl wraps `search_global_products` / `get_global_product_details` (Catalog MCP), mints+caches JWT via `jwtCache` (client-credentials, 60-min TTL). Results arrive clustered by UPID with multi-merchant offers; pick best offer per UPID for the readback.

### 7.6 Client tools (Speechify → loader, via `handle.registerTool`)

```ts
handle.registerTool("render_products", (a: { items: ProductResult[] }) => widget.showCards(a.items));
handle.registerTool("update_cart",     (a: { upid: string; qty: number }) => cart.set(a.upid, a.qty));
handle.registerTool("open_checkout",   (a: { url: string }) => widget.openCheckout(a.url));
```

All UI rendered inside the widget's **Shadow DOM** so host-site CSS can't interfere.

---

## 8. Speechify agent configuration (one-time, console or API)

- **Voice/language:** default neutral English voice; allow per-session `override_language` (`en-ZA`).
- **Prompt scaffold** (uses injected vars):
  - Role: Izimvo, a concise, opinionated shopping **adviser** scoped to **{{category}}**. It has a view and shares it.
  - Behaviour: ask one narrowing question at a time; call `search_products` when intent is clear; never read more than 3 options aloud; give a clear recommendation ("here's what I'd get, and why"); confirm before `open_checkout`; if zero results, ask a clarifying question rather than inventing products.
  - `{{memory}}` placeholder present (enables recall for returning shoppers with `user_identity`).
- **Webhook tool:** `search_products` → our endpoint, HMAC secret stored both sides.
- **Client tools:** `render_products`, `update_cart`, `open_checkout`.
- **System tools:** `end_call` only (no telephony transfer in v1).
- **Post-call:** enable evaluation + structured extraction (capture intent, category, whether a checkout link was issued) → delivered to our webhook.

---

## 9. Environment / secrets (zod-validated in `config/env.ts`)

```
SPEECHIFY_API_KEY=
SPEECHIFY_AGENT_ID=
SPEECHIFY_WEBHOOK_HMAC_SECRET=
SHOPIFY_CATALOG_CLIENT_ID=
SHOPIFY_CATALOG_CLIENT_SECRET=
SHOPIFY_CATALOG_TOKEN_URL=
DATABASE_URL=
ATTRIBUTION_UTM_SOURCE=izimvo
PUBLIC_API_BASE=https://api.izimvo.com
LOADER_CDN_BASE=https://cdn.izimvo.com
```

No secret ever ships in the loader bundle. The loader only ever holds the public `site-key` and the short-lived session token.

---

## 10. Build phases (each ends with a runnable acceptance check)

**Phase 0 — Prereqs (manual, document in README)**
- Create the Speechify agent; note `AGENT_ID`. Configure prompt, tools, voices.
- Obtain Shopify Catalog client credentials from Dev Dashboard; create at least one saved catalog (slug) for the first category.
- Accept: a manual `curl` mints a Speechify session and a manual catalog search returns products.

**Phase 1 — Backend skeleton + session mint**
- Hono app, env validation, Drizzle schema + migrations, `sites`/`api_keys`/`categories`/`sessions` tables, seed one site + key.
- `POST /v1/session` with site-key validation, **domain binding**, rate limiting, category resolution, Speechify mint, persistence.
- Accept: from an allowlisted origin a session token is returned; from a non-allowlisted origin it 403s.

**Phase 2 — Catalog bridge + search tool**
- `jwtCache`, `CatalogClient` (Global), `POST /v1/tools/search-products` with HMAC verify, server-side category/scope resolution, ≤3 results, UTM tagging.
- Accept: a signed request returns ≤3 structured products with tagged checkout URLs; an unsigned request is rejected.

**Phase 3 — Loader + widget**
- `loader.js`: attribute parsing, `/v1/session` call, `startAgent({sessionToken, sessionUrl})`, client tool registration, Shadow-DOM widget (orb states from `status` events), product cards.
- iOS-safe mic/audio: nothing starts until a user tap; handle `prefers-reduced-motion`; teardown on `ended`.
- Accept: on a local test host page, tap → talk → "find X" → cards render → adviser narrows by voice. End-to-end loop works.

**Phase 4 — Checkout handoff + attribution**
- `open_checkout` opens the UTM-tagged URL; persist `attributions`.
- Accept: clicking through carries UTM params; attribution row recorded.

**Phase 5 — Post-call webhook + usage**
- `POST /v1/webhooks/speechify` (HMAC-verified): persist transcript ref, evaluation, `usage_events`; correlate `speechify_conversation_id` back to the `sessions` row.
- Accept: after a call, usage + evaluation land keyed to the correct site.

**Phase 6 — Hardening**
- Per-key + per-IP rate limits enforced and tested; loader versioning (stable entry → versioned core); observability (structured logs, request ids); Shadow-DOM CSS isolation verified against a hostile host stylesheet; abuse/load test of `/v1/session`.
- Accept: load test shows no API-key leakage path, billing is correctly attributed, and a malicious host page cannot break the widget UI or exhaust quota.

---

## 11. Guardrails (HARD constraints)

1. **Private mode only.** The Speechify API key and `agent-id` never reach the browser. Do not implement public-agent/origin-allowlist embedding — the agent owner is always the billed principal, and an open allowlist on a distributed widget is an open invitation to bill abuse. Every session is gated by our backend.
2. **Domain binding on every mint.** Validate `Origin`/`Referer` hostname against the site-key's `allowed_domains` server-side. Exact hostname match.
3. **Never trust `data-category`.** Sanitize and map to a known taxonomy/saved-catalog slug server-side before it touches a prompt or a query. Treat it as a prompt-injection vector.
4. **Resolve category/scope from the session server-side** in the search tool — do not rely on the LLM passing it.
5. **Cache the Shopify JWT** (60-min TTL). Never mint per request.
6. **Latency budget.** The search round-trip must fit under the agent's sub-2s per-turn target. Cache JWT, keep `limit=3`, return fast. If a search will be slow, the agent prompt should emit a brief filler turn.
7. **≤3 results read aloud.** Voice has no scannable list; the narrowing *is* the interface. Cards may show more; speech must not.
8. **No invented products.** Empty results → clarifying question, never a hallucinated SKU. Ground every spoken product fact in catalog data.
9. **Attribution always.** UTM-tag every checkout/continuation URL server-side or revenue share is lost to "direct/referral".
10. **HMAC-verify** the search tool and the post-call webhook before processing.
11. **Shadow DOM** for all widget UI; the loader must not leak or absorb host-page CSS/JS.
12. **Functional core, imperative shell.** Domain logic in `core/` and `clients/` is framework-free and unit-tested; Hono only in `http/`.

---

## 12. Out of scope for v1 (note, don't build)

- Telephony (ZA Twilio number) and WhatsApp channels — same backend/agent reused later; do not couple anything to web-only assumptions.
- Self-serve merchant dashboard / billing portal — seed sites via migration for now.
- Storefront Catalog mode — keep the `CatalogClient` swap point clean but ship Global only.
- Multi-language voices beyond locale override.

---

See `CLAUDE.md` for working conventions.
