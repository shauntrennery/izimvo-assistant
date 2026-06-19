import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Load a repo-level `.env` into process.env before validation. Node/tsx don't
 * auto-load .env, so we do it explicitly via the native `process.loadEnvFile`
 * (no dotenv dependency). Existing process.env values are not overridden.
 *
 * Tries the package dir first, then the repo root two levels up — so the file
 * can live in either place. Returns the path loaded, or null if none found.
 */
export function loadDotEnv(cwd: string = process.cwd()): string | null {
  const candidates = [resolve(cwd, ".env"), resolve(cwd, "../../.env")];
  for (const path of candidates) {
    if (existsSync(path)) {
      process.loadEnvFile(path);
      return path;
    }
  }
  return null;
}
