import { fileURLToPath, URL } from "node:url";
import { loadEnv, type ProxyOptions } from "vite";
// vitest/config re-exports Vite's defineConfig with the `test` block typed.
import { defineConfig } from "vitest/config";

/**
 * Every top-level path the game server owns.
 *
 * API routes come from `server/src/app.routes.ts`; the static prefixes are the
 * directories in `server/public/`, which koa-static serves from the root
 * (`server/src/utils/staticPaths.ts`). `/gamestage` covers the language files
 * at `/gamestage/assets/<code>.json` handled by `processLanguageFile.ts`.
 *
 * `/init` and `/connection` are exact paths on the server, but Vite matches
 * proxy keys as prefixes; nothing in this client serves those prefixes itself,
 * so the broader match is harmless.
 */
const SERVER_PATHS = [
  "/api",
  "/base",
  "/worldmapv2",
  "/worldmapv3",
  "/alliance",
  "/init",
  "/connection",
  "/assets",
  "/gamestage",
  "/templates",
];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const target = env["VITE_PROXY_TARGET"] ?? "http://localhost:3001";

  // When VITE_SERVER_URL names an absolute origin the client talks to it
  // directly, so the dev proxy would only get in the way.
  const useProxy = !env["VITE_SERVER_URL"];

  const proxy: Record<string, ProxyOptions> = {};
  if (useProxy) {
    for (const path of SERVER_PATHS) proxy[path] = { target, changeOrigin: true };
  }

  return {
    // The Turnstile site key keeps the name the server's docs use; naming it
    // exactly (not "TURNSTILE_") keeps TURNSTILE_SECRET_KEY out of the bundle
    // even if someone puts it in this .env.
    envPrefix: ["VITE_", "TURNSTILE_SITE_KEY"],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      port: 5173,
      proxy,
    },
    build: {
      // Not the Vite default "assets": the server serves its own /assets/
      // directory, and the dev proxy forwards that prefix. Bundling to
      // /static/ keeps the two from colliding in either mode.
      assetsDir: "static",
      sourcemap: true,
      target: "es2022",
      // The game, and the Terms and Privacy placeholder pages the sign-up form
      // links to (issue #213), served at /terms and /privacy.
      rollupOptions: {
        input: {
          index: fileURLToPath(new URL("./index.html", import.meta.url)),
          terms: fileURLToPath(new URL("./terms.html", import.meta.url)),
          privacy: fileURLToPath(new URL("./privacy.html", import.meta.url)),
        },
      },
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
      // Worker threads, not the default child processes (#192). The forks
      // pool hands each worker its transformed modules as files in a temp
      // directory, one file per module, rewritten by every worker that asks
      // for it; on Windows a worker opening that file while another renames
      // over it fails with EBUSY, and the test file importing it fails to
      // load ("[ src/.../shotLedger.test.ts ]", once in a few full runs, most
      // often when two suites run at once). Threads get the code over their
      // message port and never touch the file.
      pool: "threads",
    },
  };
});
