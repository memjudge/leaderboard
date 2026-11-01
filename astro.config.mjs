// @ts-check
import { defineConfig } from "astro/config";

// A fully static site: `npm run data` verifies the signed results and writes the
// data files first, then Astro renders the pages. Deployed as Workers static assets.
export default defineConfig({
  site: process.env.SITE_URL || "https://memjudge.org",
  output: "static",
  trailingSlash: "ignore",
  build: { format: "directory" },
  devToolbar: { enabled: false },
  // The chart chunk is ECharts (only the chart types used, about 170 KB gzipped).
  vite: { build: { chunkSizeWarningLimit: 700 } },
});
