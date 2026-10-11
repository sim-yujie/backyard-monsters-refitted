import { defineConfig } from "astro/config";

// Static site for bymrevamped.com. The game itself lives at
// play.bymrevamped.com (web/), so nothing here is bundled with it.
export default defineConfig({
  site: "https://bymrevamped.com",
  output: "static",
  trailingSlash: "ignore",
  build: { format: "directory" },
  // No telemetry, no prefetch scripts: the pages are plain HTML and CSS.
  prefetch: false,
  devToolbar: { enabled: false },
});
