import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import Koa from "koa";
import type { Server } from "node:http";

import { cacheControlFor, makeCorsCacheControl } from "./corsCacheControlSetup.js";
import { corsSettings } from "../config/CorsConfig.js";

describe("cacheControlFor", () => {
  test("keeps a picture a week, versioned or not", () => {
    expect(cacheControlFor("/assets/monsters/pokey-anim@2x.png", true)).toBe("public, max-age=604800");
    expect(cacheControlFor("/assets/buildings/townhall.JPG", true)).toBe("public, max-age=604800");
  });

  test("keeps any other static file an hour", () => {
    expect(cacheControlFor("/assets/sounds/music/yard-theme.mp3", true)).toBe("public, max-age=3600");
  });

  test("keeps nothing from the API, or from a local server", () => {
    expect(cacheControlFor("/api/v2.0.0/bm/getnewmap.png", true)).toBe("no-cache, no-store, must-revalidate");
    expect(cacheControlFor("/assets/monsters/pokey-anim@2x.png", false)).toBe("no-cache, no-store, must-revalidate");
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

  test("another page gets the answer without permission to read it", async () => {
    const answer = await ask("https://evil.example");
    expect(answer.status).toBe(200);
    expect(answer.headers.get("Access-Control-Allow-Origin")).toBeNull();
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
