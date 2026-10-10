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

interface VercelConfig {
  buildCommand: string;
  rewrites: Rewrite[];
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

  it("opens the emailed reset link on the game page", () => {
    expect(config.rewrites).toContainEqual({ source: RESET_PATH, destination: "/index.html" });
  });
});
