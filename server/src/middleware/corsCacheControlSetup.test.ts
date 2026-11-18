import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import Koa from "koa";
import serve from "koa-static";
import type { Server } from "node:http";

import { cacheControlFor, makeCorsCacheControl } from "./corsCacheControlSetup.js";
import { corsSettings } from "../config/CorsConfig.js";
import { isStaticPath } from "../utils/staticPaths.js";
import { byteRanges } from "./byteRanges.js";
import { notModified, tagFile } from "./notModified.js";

describe("cacheControlFor", () => {
  test("keeps a picture a week, versioned or not", () => {
    expect(cacheControlFor("/assets/monsters/pokey-anim@2x.png", true)).toBe("public, max-age=604800");
    expect(cacheControlFor("/assets/buildings/townhall.JPG", true)).toBe("public, max-age=604800");
  });

  test("keeps any other static file an hour", () => {
    expect(cacheControlFor("/assets/sounds/music/yard-theme.mp3", true)).toBe("public, max-age=3600");
  });

  test("keeps nothing from the API", () => {
    expect(cacheControlFor("/api/v2.0.0/bm/getnewmap.png", true)).toBe("no-cache, no-store, must-revalidate");
    expect(cacheControlFor("/api/v2.0.0/bm/getnewmap.png", false)).toBe("no-cache, no-store, must-revalidate");
  });

  test("has a local server's files checked every time", () => {
    expect(cacheControlFor("/assets/monsters/pokey-anim@2x.png", false)).toBe("no-cache");
    expect(cacheControlFor("/assets/sounds/music/yard-theme.mp3", false)).toBe("no-cache");
  });
});

describe("CORS headers (security audit 2026-10-29, L8)", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = new Koa();
    app.use(makeCorsCacheControl(corsSettings({ ENV: "production", WEB_URL: "https://play.example.test" })));
    app.use((ctx) => {
      ctx.body = { error: 0 };
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });

  afterAll(() => {
    server.close();
  });

  const ask = (origin: string | null, method = "GET") =>
    fetch(`${base}/api/v1/player/account`, { method, headers: origin ? { Origin: origin } : {} });

  test("the web client is told it may read the answer, by name", async () => {
    const answer = await ask("https://play.example.test");
    expect(answer.headers.get("Access-Control-Allow-Origin")).toBe("https://play.example.test");
    expect(answer.headers.get("Vary")).toContain("Origin");
  });

  test("the web client may also read the answers' timing and size (MR2 open timing)", async () => {
    const answer = await ask("https://play.example.test");
    expect(answer.headers.get("Timing-Allow-Origin")).toBe("https://play.example.test");
  });

  test("another page gets the answer without permission to read it", async () => {
    const answer = await ask("https://evil.example");
    expect(answer.status).toBe(200);
    expect(answer.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(answer.headers.get("Timing-Allow-Origin")).toBeNull();
  });

  test("a request with no Origin (the launcher, a server) is answered as before", async () => {
    const answer = await ask(null);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ error: 0 });
  });

  test("the preflight answers 204, naming only an allowed page", async () => {
    const allowed = await ask("https://play.example.test", "OPTIONS");
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("https://play.example.test");
    expect(allowed.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type, Authorization");

    const other = await ask("https://evil.example", "OPTIONS");
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

/**
 * The art behind Cloudflare (cdn.bymrevamped.com, server/deploy/Caddyfile):
 * Cloudflare ignores `Vary`, so the copy it caches first is served to every page.
 * It must say `*` however it was asked, and a missing file must not be kept.
 */
describe("art headers for a shared cache (Cloudflare)", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = new Koa();
    app.use(makeCorsCacheControl(corsSettings({ ENV: "production", WEB_URL: "https://play.example.test" })));
    // The same chain as server.ts: ranges, then 304s, then the files in public/.
    const files = serve("public/", { setHeaders: tagFile });
    app.use((ctx, next) =>
      isStaticPath(ctx.path) ? byteRanges(ctx, () => notModified(ctx, () => files(ctx, next))) : next(),
    );
    app.use((ctx) => {
      if (isStaticPath(ctx.path)) return; // not on disk: Koa's own 404
      ctx.body = { error: 0 };
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });

  afterAll(() => {
    server.close();
  });

  const PICTURE = "/assets/buildings/flinger/top.1.png";
  const SOUND = "/assets/sounds/uisounds/sound_close.mp3";

  test("a picture asked for with no Origin (a plain <img>) still says any page may read it", async () => {
    const answer = await fetch(`${base}${PICTURE}`);
    expect(answer.status).toBe(200);
    expect(answer.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(answer.headers.get("Timing-Allow-Origin")).toBe("*");
    expect(answer.headers.get("Vary") ?? "").not.toContain("Origin");
    // A week on the live server, "no-cache" on a local one (`cacheControlFor` above); never no-store.
    expect(answer.headers.get("Cache-Control")).not.toContain("no-store");
  });

  test("any page's Origin gets the same `*`, never an echo", async () => {
    for (const origin of ["https://play.example.test", "https://evil.example", "http://localhost:5411"]) {
      const answer = await fetch(`${base}${PICTURE}`, { headers: { Origin: origin } });
      expect(answer.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(answer.headers.get("Vary") ?? "").not.toContain("Origin");
    }
  });

  test("a 304 for a picture the browser holds keeps the header", async () => {
    const first = await fetch(`${base}${PICTURE}`);
    const tag = first.headers.get("ETag")!;
    await first.arrayBuffer();
    const again = await fetch(`${base}${PICTURE}`, { headers: { "If-None-Match": tag } });
    expect(again.status).toBe(304);
    expect(again.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  test("a byte range of a sound (iPhone music) keeps the header", async () => {
    const answer = await fetch(`${base}${SOUND}`, { headers: { Range: "bytes=0-99", Origin: "https://play.example.test" } });
    expect(answer.status).toBe(206);
    expect(answer.headers.get("Content-Range")).toMatch(/^bytes 0-99\//);
    expect(answer.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(answer.headers.get("Cache-Control")).not.toContain("no-store");
  });

  test("a missing picture is a 404 nobody keeps (was a week)", async () => {
    const answer = await fetch(`${base}/assets/zz-missing-file.png`);
    expect(answer.status).toBe(404);
    expect(answer.headers.get("Cache-Control")).toBe("no-cache, no-store, must-revalidate");
  });

  test("the API still names only the allowed page, with Vary: Origin", async () => {
    const answer = await fetch(`${base}/api/v1/player/account`, { headers: { Origin: "https://evil.example" } });
    expect(answer.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(answer.headers.get("Vary")).toContain("Origin");
    expect(answer.headers.get("Cache-Control")).toBe("no-cache, no-store, must-revalidate");
  });
});
