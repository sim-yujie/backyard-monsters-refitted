import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every dashboard route sits behind the owner-only check. Importing
 * `routes.ts` boots the server (`server.js`), so this reads its source
 * instead; the check itself is tested in `services/admin/adminGuard.test.ts`.
 */

const source = readFileSync(join(import.meta.dir, "routes.ts"), "utf8");
const routes = [...source.matchAll(/router\.(get|post|put|patch|delete)\(`\$\{admin\}([^`]*)`,([^\n]*)/g)].map(
  ([, method, path, rest]) => ({ route: `${method!.toUpperCase()} ${path}`, rest: rest! })
);

describe("the dashboard routes (controllers/admin/routes.ts)", () => {
  test("include the health route", () => {
    expect(routes.map((r) => r.route)).toContain("GET /health");
  });

  test("include the replies and Shiny routes", () => {
    expect(routes.map((r) => r.route)).toEqual(
      expect.arrayContaining(["POST /bugreports/:id/reply", "GET /players", "GET /shiny", "POST /shiny"])
    );
  });

  test("include the moderation and chat panel routes", () => {
    expect(routes.map((r) => r.route)).toEqual(
      expect.arrayContaining([
        "GET /chatreports",
        "GET /players/:id/moderation",
        "POST /players/:id/:kind",
        "POST /chat/session",
      ])
    );
  });

  test("include the chat flag and chat log routes", () => {
    expect(routes.map((r) => r.route)).toEqual(
      expect.arrayContaining(["GET /chatflags", "POST /chatflags/:id/dismiss", "GET /chatlog"])
    );
  });

  test("include the chat moderators routes", () => {
    expect(routes.map((r) => r.route)).toEqual(
      expect.arrayContaining(["GET /moderators", "POST /moderators", "POST /moderators/:id/remove"])
    );
  });

  test("include the moderation inbox routes: open players, the Closed list, and the one step", () => {
    expect(routes.map((r) => r.route)).toEqual(
      expect.arrayContaining(["GET /inbox", "GET /inbox/closed", "POST /inbox/:id/act"])
    );
  });

  test("include the moderator mail routes: the conversations, and one conversation", () => {
    expect(routes.map((r) => r.route)).toEqual(expect.arrayContaining(["GET /modmail", "GET /modmail/:threadid"]));
  });

  test("include the Flagged list routes: every flagged player, and one player's entries", () => {
    expect(routes.map((r) => r.route)).toEqual(expect.arrayContaining(["GET /flagged", "GET /flagged/:id"]));
  });

  test("all go through the owner-only check", () => {
    expect(routes.length).toBeGreaterThan(5);
    for (const { route, rest } of routes) expect(`${route}: ${rest}`).toContain("apiVersion, adminOnly,");
  });
});
