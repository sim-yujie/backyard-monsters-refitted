import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import Router from "@koa/router";
import type { EntityManager } from "@mikro-orm/postgresql";
import type { Server } from "node:http";
import Koa, { type Context, type Next } from "koa";

import { getGameVersion } from "../../config/VersionManifestConfig.js";
import { bodyParsers } from "../../middleware/bodyLimits.js";
import { jsonBodyCompat } from "../../middleware/jsonBody.js";
import { MAINTENANCE_OFF, maintenanceState, setMaintenance } from "../../services/admin/maintenance.js";
import { mountAdminMaintenanceRoutes } from "./maintenance.js";

/**
 * The dashboard's maintenance panel over HTTP, through the server's body
 * parsers. The stand-in database keeps the last write and reads it back.
 */

const OWNER = 996201;
let row: unknown = null;
const fakeEm = {
  execute: async (sql: string, params: unknown[] = []) => {
    if (/^\s*INSERT/i.test(sql)) {
      row = JSON.parse(params[1] as string);
      return [];
    }
    return row ? [{ value: row, updated_at: new Date(), updated_by: OWNER }] : [];
  },
} as unknown as EntityManager;

const fakeOwner = async (ctx: Context, next: Next) => {
  ctx.authUser = { userid: OWNER } as Context["authUser"];
  await next();
};

describe("/admin/maintenance", () => {
  let server: Server;
  let url = "";

  const call = async (body?: unknown) => {
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: (await response.json()) as any };
  };

  beforeAll(async () => {
    const app = new Koa();
    const router = new Router();
    mountAdminMaintenanceRoutes(router, "/api/:apiVersion/admin", fakeOwner as never, () => fakeEm);
    app.use(bodyParsers());
    app.use(jsonBodyCompat);
    app.use(router.routes());
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    url = `http://127.0.0.1:${port}/api/${getGameVersion() ?? "v"}/admin/maintenance`;
  });

  afterAll(() => {
    setMaintenance(MAINTENANCE_OFF);
    server?.close();
  });

  test("off at first", async () => {
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body).toMatchObject({ on: false, cutOff: false, limits: { minutes: [1, 5, 10, 15], defaultMinutes: 5 } });
  });

  test("On: stored, in memory at once, with the countdown running", async () => {
    const backAt = Date.now() + 3_600_000;
    const { status, body } = await call({ action: "on", message: "New server", backAt: new Date(backAt).toISOString(), minutes: 10 });
    expect(status).toBe(200);
    expect(body).toMatchObject({ on: true, message: "New server", backAt, cutOff: false });
    expect(body.remainingMs).toBeGreaterThan(9 * 60_000);
    expect(body.remainingMs).toBeLessThanOrEqual(10 * 60_000);
    expect(maintenanceState().on).toBe(true);
    expect((row as { on: boolean }).on).toBe(true);
  });

  test("a bad change is a 400 with the reason", async () => {
    const { status, body } = await call({ action: "on", minutes: 7 });
    expect(status).toBe(400);
    expect(body.error).toContain("countdown");
  });

  test("Off: cancels the countdown, stored and in memory", async () => {
    const { body } = await call({ action: "off" });
    expect(body).toMatchObject({ on: false, remainingMs: 0 });
    expect(maintenanceState().on).toBe(false);
    expect((row as { on: boolean }).on).toBe(false);
  });
});
