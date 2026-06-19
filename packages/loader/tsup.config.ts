import { defineConfig } from "tsup";

/**
 * The host embeds a single `<script>` pointing at this IIFE. Target < 15KB gzip
 * (PLAN: loader package). The versioned-core split (thin loader fetches a
 * versioned ESM core) is a Phase 6 optimisation; the entry tag stays stable.
 */
export default defineConfig({
  entry: { loader: "src/loader.ts" },
  format: ["iife"],
  globalName: "Izimvo",
  target: "es2020",
  minify: true,
  sourcemap: true,
  clean: true,
  dts: false,
  define: {
    __IZIMVO_API_BASE__: JSON.stringify(
      process.env.IZIMVO_API_BASE ?? "https://api.izimvo.com",
    ),
  },
});
