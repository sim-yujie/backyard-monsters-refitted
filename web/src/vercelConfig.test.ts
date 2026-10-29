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

describe("vercel.json", () => {
  it("names the game server in the build command", () => {
    expect(serverOrigin).toMatch(/^https:\/\/[^/]+$/);
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

  it("opens the emailed reset link on the game page", () => {
    expect(config.rewrites).toContainEqual({ source: RESET_PATH, destination: "/index.html" });
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

  it("lets the game reach its server, over https and the chat's wss", () => {
    const host = serverOrigin!.replace(/^https:\/\//, "");
    expect(directives.get("connect-src")).toEqual(["'self'", `https://${host}`, `wss://${host}`]);
    expect(directives.get("img-src")).toContain(serverOrigin);
  });

  it("allows scripts only from the page itself and the sign-up bot check, never inline", () => {
    const scripts = directives.get("script-src") ?? [];
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts.filter((source) => source.startsWith("https:"))).toEqual(["https://challenges.cloudflare.com"]);
    expect(directives.get("frame-src")).toEqual(["https://challenges.cloudflare.com"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
  });
});
