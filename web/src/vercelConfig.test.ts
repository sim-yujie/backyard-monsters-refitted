import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RESET_PATH } from "./app/scenes/passwordReset";

/**
 * `web/vercel.json`, the Vercel set-up for the web client (docs/deploy.md).
 *
 * On Vercel the client and the game server are on different addresses, but
 * the client asks for the server's art by root-relative paths (`/assets/...`).
 * Every folder the server serves from `server/public/` therefore needs a
 * rewrite to the game server, and the address those rewrites go to must be
 * the one the build talks to (`VITE_SERVER_URL` in the build command).
 */

interface Rewrite {
  source: string;
  destination: string;
}

interface HeaderRule {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

interface VercelConfig {
  buildCommand: string;
  cleanUrls: boolean;
  rewrites: Rewrite[];
  headers: HeaderRule[];
}

const config: VercelConfig = JSON.parse(
  readFileSync(fileURLToPath(new URL("../vercel.json", import.meta.url)), "utf8"),
);

const PUBLIC_DIR = fileURLToPath(new URL("../../server/public/", import.meta.url));

const serverFolders = readdirSync(PUBLIC_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const serverOrigin = config.buildCommand.match(/VITE_SERVER_URL=(\S+)/)?.[1];

/** The art's own name behind Cloudflare (server/deploy/Caddyfile, CDN_DOMAIN). */
const ART_ORIGIN = "https://cdn.bymrevamped.com";

describe("vercel.json", () => {
  it("names the game server in the build command", () => {
    expect(serverOrigin).toMatch(/^https:\/\/[^/]+$/);
  });

  it("leaves VITE_ART_URL to Vercel's settings, so the art name is switched on without a code change", () => {
    expect(config.buildCommand).not.toContain("VITE_ART_URL");
  });

  it("keeps the art rewrites: the rollback, and old open tabs, when VITE_ART_URL is set", () => {
    for (const folder of ["assets", "gamestage", "templates"]) {
      expect(config.rewrites.map((rewrite) => rewrite.source)).toContain(`/${folder}/:path*`);
    }
  });

  it("sends every folder the server serves to the game server", () => {
    expect(serverFolders.length).toBeGreaterThan(0);
    for (const folder of serverFolders) {
      expect(config.rewrites, folder).toContainEqual({
        source: `/${folder}/:path*`,
        destination: `${serverOrigin}/${folder}/:path*`,
      });
    }
  });

  it("sends nothing else to an outside address", () => {
    const outside = config.rewrites.filter((rewrite) => /^https?:/.test(rewrite.destination));
    expect(outside.map((rewrite) => rewrite.source).sort()).toEqual(
      serverFolders.map((folder) => `/${folder}/:path*`),
    );
  });

  it("serves the owner's dashboard page at /admin, where the alerts link", () => {
    // cleanUrls serves admin.html at /admin; a rewrite would send it elsewhere.
    expect(config.cleanUrls).toBe(true);
    expect(config.rewrites.filter((rewrite) => rewrite.source.startsWith("/admin"))).toEqual([]);
    const viteConfig = readFileSync(fileURLToPath(new URL("../vite.config.ts", import.meta.url)), "utf8");
    expect(viteConfig).toContain('admin: fileURLToPath(new URL("./admin.html", import.meta.url))');
  });

  it("never stores sounds on Vercel", () => {
    // Browsers ask for parts of a music file. Vercel stored one such part and
    // then gave it to everyone as the whole file, whatever part they asked
    // for, so the Modern yard tune would not play (beta 5.11).
    expect(config.headers).toContainEqual({
      source: "/assets/sounds/:path*",
      headers: [{ key: "x-vercel-enable-rewrite-caching", value: "0" }],
    });
  });

  /**
   * Beta 9 (owner 21 Nov 2026, card b9-speed-picks): the page's own pictures and fonts are kept
   * instead of asked about again on every visit (Vercel's default is `max-age=0, must-revalidate`).
   * Their names carry no version, so none is `immutable`: a changed file shows within the day
   * (fonts: the month), or at once under a new name. Rename a /maproom sheet whose cells move.
   */
  it("keeps the page's fonts a month and its pictures a day, never immutable", () => {
    const cacheFor = (source: string) =>
      config.headers.find((rule) => rule.source === source)?.headers.find((h) => h.key === "Cache-Control")?.value;
    expect(cacheFor("/fonts/(.*)")).toBe("public, max-age=2592000, stale-while-revalidate=2592000");
    expect(cacheFor("/(ui|portraits)/(.*)")).toBe("public, max-age=86400, stale-while-revalidate=604800");
    // The map's sheets are cut by cell positions in the code: no stale-while-revalidate, so an
    // old sheet outlives a release by a day at most.
    expect(cacheFor("/maproom/(.*)")).toBe("public, max-age=86400");
    for (const rule of config.headers) {
      for (const header of rule.headers) {
        if (header.key === "Cache-Control" && header.value.includes("immutable")) expect(rule.source).toBe("/static/(.*)");
      }
    }
  });

  it("opens the emailed reset link on the game page", () => {
    // With cleanUrls on, "/index.html" is itself redirected, so a rewrite to it answers 404 on
    // Vercel (live bug, 7 Nov 2026): the reset page must rewrite to "/".
    expect(config.rewrites).toContainEqual({ source: RESET_PATH, destination: "/" });
    expect(config.rewrites.some((r: { destination: string }) => r.destination.endsWith(".html"))).toBe(false);
  });
});

/**
 * The Content-Security-Policy (security audit 2026-10-29, L5), report-only
 * for now: the browser lists in the console what it would have blocked, and
 * blocks nothing.
 */
describe("vercel.json Content-Security-Policy", () => {
  const rule = config.headers.find((entry) => entry.source === "/(.*)");
  const header = rule?.headers.find((entry) => entry.key.startsWith("Content-Security-Policy"));
  const directives = new Map(
    (header?.value ?? "").split(";").map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name, sources] as const;
    }),
  );

  it("covers every page, the game and /admin included, and only reports", () => {
    expect(header?.key).toBe("Content-Security-Policy-Report-Only");
  });

  it("lets the game reach its server, over https and the chat's wss, and the art name", () => {
    const host = serverOrigin!.replace(/^https:\/\//, "");
    expect(directives.get("connect-src")).toEqual(["'self'", `https://${host}`, `wss://${host}`, ART_ORIGIN]);
    expect(directives.get("img-src")).toContain(serverOrigin);
  });

  // VITE_ART_URL (src/artUrl.ts), set in Vercel's settings once Cloudflare caches the
  // art: pictures and textures (fetch), sounds (fetch) and music (<audio>) come from it.
  it("lets the art come from the cdn name (Cloudflare's cache)", () => {
    for (const directive of ["img-src", "media-src", "connect-src"]) {
      expect(directives.get(directive), directive).toContain(ART_ORIGIN);
    }
  });

  it("allows scripts only from the page itself and the sign-up bot check, never inline", () => {
    const scripts = directives.get("script-src") ?? [];
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts.filter((source) => source.startsWith("https:"))).toEqual(["https://challenges.cloudflare.com"]);
    expect(directives.get("frame-src")).toEqual(["https://challenges.cloudflare.com"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
  });
});
