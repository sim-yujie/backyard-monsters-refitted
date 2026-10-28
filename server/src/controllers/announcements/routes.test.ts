import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every write to announcements is the owner's, and every game route needs a
 * sign-in: read off the source, as `controllers/admin/routes.test.ts` does.
 * The routes themselves run over HTTP in `routes.db.test.ts`.
 */

const source = readFileSync(join(import.meta.dir, "routes.ts"), "utf8");
const routes = [...source.matchAll(/router\.(get|post|put|patch|delete)\(`\$\{(admin|api)\}([^`]*)`,([^\n]*)/g)].map(
  ([, method, base, path, rest]) => ({ method: method!.toUpperCase(), base: base!, path: path!, rest: rest! })
);

describe("the announcement routes (controllers/announcements/routes.ts)", () => {
  test("are the dashboard's five and the game's three", () => {
    expect(routes.filter((r) => r.base === "admin").map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /announcements",
      "POST /announcements",
      "PUT /announcements/:id",
      "DELETE /announcements/:id",
      "GET /announcements/images/:id",
    ]);
    expect(routes.filter((r) => r.base === "api").map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /bm/announcements",
      "POST /bm/announcements/:id/dismiss",
      "GET /announcements/images/:id",
    ]);
  });

  test("every dashboard route goes through the owner-only check", () => {
    for (const route of routes.filter((r) => r.base === "admin")) expect(route.rest).toContain("apiVersion, adminOnly,");
  });

  test("the game's routes need a sign-in, all but the pictures", () => {
    for (const route of routes.filter((r) => r.base === "api" && !r.path.includes("images"))) {
      expect(route.rest).toContain("apiVersion, ...deps.signedIn,");
    }
  });
});
