import { fileURLToPath, URL } from "node:url";
import { loadEnv, type Plugin, type ProxyOptions } from "vite";
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

/**
 * Pixi fetches its renderer and its browser setup as pieces of their own the
 * moment the game starts (`autoDetectRenderer`, `browserExt`), only after the
 * first script has run, which put one more round trip in front of the sign-in
 * screen on a phone. The game page names them up front instead, so they
 * download beside the first script. WebGL only: it is the renderer the game
 * asks for first (`App.ts`), and WebGPU and the canvas fallback stay on demand.
 */
const PIXI_START_PIECES = [
  /\/pixi\.js\/lib\/rendering\/renderers\/gl\/WebGLRenderer\.mjs$/,
  /\/pixi\.js\/lib\/environment-browser\/browserAll\.mjs$/,
];

const preloadPixiStart = (): Plugin => ({
  name: "bymr-preload-pixi-start",
  apply: "build",
  transformIndexHtml: {
    order: "post",
    handler(html, ctx) {
      const bundle = ctx.bundle;
      if (!bundle || !ctx.filename.endsWith("index.html")) return html;
      const chunks = Object.values(bundle).filter((item) => item.type === "chunk");
      // What the page already loads: the entry and everything it imports statically.
      const named = new Set<string>();
      const entry = chunks.find((chunk) => chunk.isEntry && chunk.name === "index");
      const addStatic = (fileName: string): void => {
        if (named.has(fileName)) return;
        named.add(fileName);
        const chunk = chunks.find((item) => item.fileName === fileName);
        for (const next of chunk?.imports ?? []) addStatic(next);
      };
      if (entry) addStatic(entry.fileName);
      const wanted: string[] = [];
      const want = (fileName: string): void => {
        if (named.has(fileName)) return;
        named.add(fileName);
        wanted.push(fileName);
        const chunk = chunks.find((item) => item.fileName === fileName);
        for (const next of chunk?.imports ?? []) want(next);
      };
      for (const pattern of PIXI_START_PIECES) {
        const chunk = chunks.find((item) => item.facadeModuleId && pattern.test(item.facadeModuleId.replaceAll("\\", "/")));
        if (!chunk) throw new Error(`Pixi start piece not found in the build: ${pattern}`);
        want(chunk.fileName);
      }
      return wanted.map((fileName) => ({
        tag: "link",
        attrs: { rel: "modulepreload", crossorigin: "", href: `/${fileName}` },
        injectTo: "head" as const,
      }));
    },
  },
});

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
    plugins: [preloadPixiStart()],
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
      // The game, the Terms and Privacy pages the sign-up form links to
      // (issue #213), and the credits page, served at /terms, /privacy and
      // /credits.
      rollupOptions: {
        input: {
          index: fileURLToPath(new URL("./index.html", import.meta.url)),
          terms: fileURLToPath(new URL("./terms.html", import.meta.url)),
          privacy: fileURLToPath(new URL("./privacy.html", import.meta.url)),
          credits: fileURLToPath(new URL("./credits.html", import.meta.url)),
          // The owner's dashboard (src/admin/), at /admin; linked from nowhere.
          admin: fileURLToPath(new URL("./admin.html", import.meta.url)),
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
