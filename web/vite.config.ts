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
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
    },
  };
});
