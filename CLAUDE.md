# CLAUDE.md — Izimvo working conventions

Izimvo is an embeddable voice shopping **adviser**: a single script tag any site owner installs, backed by our token-minting service, a Speechify voice agent, and the Shopify Global Catalog. Read `PLAN.md` for the full architecture and contracts. This file is the conventions Claude Code must follow on every change.

## Architecture boundaries
- **Functional core, imperative shell.** Pure domain logic lives in `backend/src/core/` and typed integrations in `backend/src/clients/`. Side effects (HTTP, DB, network) live only in `http/`, `db/`, and `clients/`. `core/` must not import Hono, the DB driver, or `fetch`.
- Every external service (Speechify, Shopify) is reached through one typed client in `clients/`, each with a contract test. **No inline `fetch` in route handlers.**

## TypeScript
- `strict: true`, `noUncheckedIndexedAccess: true`. No `any` — use `unknown` + narrowing.
- Prefer discriminated unions and `Result`-style returns (`{ ok: true, value } | { ok: false, error }`) over thrown control flow inside `core/`. Throwing is for truly exceptional paths in the shell.
- Types are inferred from zod schemas, not hand-declared in parallel.

## Validation
- **zod at every boundary**: incoming request bodies, webhook tool args, environment (`config/env.ts`), and external responses. Parse, don't assume.
- The env schema fails fast at startup if anything is missing.

## Security invariants (mirror PLAN.md §11 — never weaken)
- **Private session mode only.** The Speechify API key and agent id never reach the browser or the loader bundle. Sessions are minted server-side.
- **Domain-bind every mint**: exact `Origin`/`Referer` hostname match against the site-key's `allowed_domains`; 403 otherwise.
- **`data-category` is untrusted.** Sanitize and map to a known taxonomy / saved-catalog slug server-side before it reaches a prompt or query.
- **Resolve category/scope server-side** in the search tool from the conversation id — never trust the LLM to pass it.
- **HMAC-verify** the `search_products` tool and the post-call webhook before doing any work.
- **Cache the Shopify JWT** (60-min TTL); never mint per request.
- **UTM-tag** every checkout/continuation URL server-side (attribution drives revenue).
- **≤3 results read aloud**; ground every spoken product fact in catalog data — no invented SKUs.
- All widget UI in **Shadow DOM**; no host-page CSS bleed in or out.

## Loader package
- `packages/loader` ships to a browser. **No secrets, ever** — only the public site-key and a short-lived session token.
- Target < 15KB gzip for the entry. Thin loader fetches a versioned core, so the host's `<script>` tag never has to change.
- Audio/mic only starts on a user gesture (iOS requirement). Tear down cleanly on session `ended`.

## Testing
- vitest. Contract tests for `/v1/session`, `/v1/tools/search-products`, `/v1/webhooks/speechify`, and the `CatalogClient`.
- Auth/negative paths are tests, not afterthoughts: non-allowlisted origin → 403; unsigned tool/webhook → reject.

## Brand voice (affects prompt + copy)
- Izimvo *has an opinion*. Warm, concise, decisive: "Here's what I'd get, and why." It advises, it doesn't just list. Never read a wall of options — narrow and recommend.

## Workflow
- Build in the phase order in PLAN.md §10. Each phase must pass its acceptance check before the next begins. One commit per phase, message prefixed `phase-N:`.
- Don't introduce a dependency without a one-line note in the PR description of why native/stdlib won't do.

## Do not
- Implement public-agent / origin-allowlist embedding.
- Mint a Speechify agent per customer (per-site scope is `dynamic_variables`, one shared agent).
- Use browser storage in the loader for anything beyond in-memory session state.
- Couple anything to web-only assumptions that would block the later telephony/WhatsApp channels.
