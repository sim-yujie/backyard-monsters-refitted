import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import Router from "@koa/router";
import type { EntityManager } from "@mikro-orm/postgresql";
import type { Server } from "node:http";
import Koa, { type Context, type Next } from "koa";

import { getGameVersion } from "../../config/VersionManifestConfig.js";
import { bodyParsers } from "../../middleware/bodyLimits.js";
import { jsonBodyCompat } from "../../middleware/jsonBody.js";
import { mountAdminWeekendRoutes } from "./weekend.js";

/**
 * The dashboard's weekend panel over HTTP, through the same body parsers the
 * server mounts (`bodyParsers` then `jsonBodyCompat`). The JSON middleware
 * turns the dashboard's `rotation` array and `percent` table into JSON text
 * before the route sees them; "Save settings" once failed on exactly that
 * with "The rotation lists unknown events." (400).
 *
 * No database: the stand-in EntityManager answers the settings read with no
 * row and keeps the last write. The owner-only check is a stand-in too (it is
 * tested in `services/admin/adminGuard.test.ts`).
 */

const OWNER = 996201;

const writes: { sql: string; params: unknown[] }[] = [];
const fakeEm = {
  execute: async (sql: string, params: unknown[] = []) => {
    if (/^\s*INSERT/i.test(sql)) writes.push({ sql, params });
    return [];
  },
} as unknown as EntityManager;

const fakeOwner = async (ctx: Context, next: Next) => {
  ctx.authUser = { userid: OWNER } as Context["authUser"];
  await next();
};

describe("POST /admin/weekend through the real body middleware", () => {
  let server: Server;
  let url = "";

  const post = async (body: unknown) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as any };
  };

  beforeAll(async () => {
    const app = new Koa();
    const router = new Router();
    mountAdminWeekendRoutes(router, "/api/:apiVersion/admin", fakeOwner as never, () => fakeEm);
    app.use(bodyParsers());
    app.use(jsonBodyCompat);
    app.use(router.routes());
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    url = `http://127.0.0.1:${port}/api/${getGameVersion() ?? "v"}/admin/weekend`;
  });

  afterAll(async () => {
    // Leave the settings in memory at the defaults for any later test file.
    await post({ action: "reset" });
    server?.close();
  });

  test("saves the dashboard's settings, rotation and percentages included", async () => {
    // The body exactly as the dashboard's "Save settings" sends it.
    const sent = {
      action: "settings",
      rotation: ["hatch", "builders", "study", "plunder"],
      percent: { builders: 25, plunder: 40, study: 30, hatch: 35 },
      firstWeekend: "2026-11-07",
      utcOffsetMinutes: 480,
      lengthHours: 48,
      announceHours: 24,
    };
    const { status, body } = await post(sent);
    expect(status).toBe(200);
    expect(body.error).toBe(0);
    expect(body.settings.rotation).toEqual(sent.rotation);
    expect(body.settings.percent).toEqual(sent.percent);
    expect(body.settings.firstWeekend).toBe("2026-11-07");

    const saved = JSON.parse(String(writes.at(-1)!.params[1]));
    expect(saved.rotation).toEqual(sent.rotation);
    expect(saved.percent).toEqual(sent.percent);
  });

  test("still refuses a rotation with an unknown event", async () => {
    const { status, body } = await post({ action: "settings", rotation: ["builders", "picnic"] });
    expect(status).toBe(400);
    expect(body.error).toBe("The rotation lists unknown events.");
  });

  test("still refuses an empty rotation and a bad percentage", async () => {
    expect((await post({ action: "settings", rotation: [] })).body.error).toContain("at least one event");
    expect((await post({ action: "settings", percent: { builders: 500 } })).body.error).toContain("whole numbers");
  });
});
