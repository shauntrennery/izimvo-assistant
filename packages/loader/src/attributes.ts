import type { LoaderConfig } from "./types.js";

/**
 * Parse the host's `<script>` data-* attributes into a LoaderConfig (PLAN §7.1).
 * The host-facing attribute names are a forever-stable contract. `data-site-key`
 * is the only required field; everything else is optional and server-validated
 * (the category especially is untrusted and re-resolved by the backend).
 */
export function parseConfig(el: HTMLElement | null): LoaderConfig | null {
  const siteKey = el?.dataset.siteKey?.trim();
  if (!siteKey) return null;

  const config: LoaderConfig = { siteKey };
  const category = el?.dataset.category?.trim();
  const userId = el?.dataset.userId?.trim();
  const locale = el?.dataset.locale?.trim();
  if (category) config.category = category;
  if (userId) config.userId = userId;
  if (locale) config.locale = locale;
  return config;
}

/**
 * The loader's own script element. Must be read at module-eval time —
 * `document.currentScript` is only valid while the script is executing, so the
 * entry captures it immediately and passes it here.
 */
export function currentScriptConfig(doc: Document = document): LoaderConfig | null {
  const el = doc.currentScript as HTMLScriptElement | null;
  return parseConfig(el);
}
