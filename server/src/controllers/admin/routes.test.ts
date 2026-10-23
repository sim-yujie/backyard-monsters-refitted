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

  test("all go through the owner-only check", () => {
    expect(routes.length).toBeGreaterThan(5);
    for (const { route, rest } of routes) expect(`${route}: ${rest}`).toContain("apiVersion, adminOnly,");
  });
});
