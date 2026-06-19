import { type Result, ok, err } from "./result.js";

/**
 * Category resolution (Guardrails §11.3, §11.4). `data-category` arrives from
 * the host page and is fully untrusted — a prompt-injection vector. We never
 * pass the raw string to a prompt or a query. Instead we sanitize it to a slug
 * shape and resolve it against this site's known categories, yielding a safe
 * label + catalog scope that the rest of the system trusts.
 */

export interface Category {
  id: string;
  siteId: string;
  slug: string;
  taxonomyId: string | null;
  savedCatalogSlug: string | null;
}

export interface ResolvedCategory {
  slug: string;
  /** Human-readable label safe to inject as a dynamic variable. */
  label: string;
  taxonomyId: string | null;
  savedCatalogSlug: string | null;
}

export type CategoryError =
  | { kind: "no_category_and_no_default" }
  | { kind: "unknown_category"; sanitized: string };

const MAX_SLUG_LENGTH = 64;

/**
 * Reduce an arbitrary host-supplied string to a conservative slug shape:
 * lowercase, ASCII alphanumerics and single hyphens only, length-capped. This
 * strips anything that could carry prompt-injection payloads before we even
 * attempt a lookup.
 */
export function sanitizeCategorySlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
}

const labelFromSlug = (slug: string): string => slug.replace(/-/g, " ");

const toResolved = (c: Category): ResolvedCategory => ({
  slug: c.slug,
  label: labelFromSlug(c.slug),
  taxonomyId: c.taxonomyId,
  savedCatalogSlug: c.savedCatalogSlug,
});

/**
 * Resolve an (optional, untrusted) raw category against the site's known
 * categories.
 *  - absent raw → site default (if configured) else reject
 *  - present raw → must sanitize to a known slug, else reject (an unrecognised
 *    category from a host page is treated as suspicious, not silently accepted)
 */
export function resolveCategory(input: {
  raw: string | undefined;
  categories: Category[];
  defaultSlug: string | null;
}): Result<ResolvedCategory, CategoryError> {
  const { raw, categories, defaultSlug } = input;
  const bySlug = new Map(categories.map((c) => [c.slug, c]));

  if (raw === undefined || raw.trim() === "") {
    if (defaultSlug) {
      const def = bySlug.get(defaultSlug);
      if (def) return ok(toResolved(def));
    }
    return err({ kind: "no_category_and_no_default" });
  }

  const sanitized = sanitizeCategorySlug(raw);
  const match = bySlug.get(sanitized);
  if (!match) return err({ kind: "unknown_category", sanitized });

  return ok(toResolved(match));
}
