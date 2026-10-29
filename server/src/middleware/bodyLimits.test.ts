import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import Koa from "koa";
import type { Server } from "node:http";
import { BODY_LIMIT, LARGE_BODY_LIMIT, bodyParsers, isLargeBodyRoute } from "./bodyLimits.js";
import { MAX_CHECKPOINT_EVENTS } from "../services/base/attackCheckpoint.js";

/**
 * The body limit (security audit 2026-10-29, M4): 2 MB for every route, more
 * than three times the largest attack save, and 8 MB only for the picture
 * routes.
 */

/**
 * An attack save at its worst, form encoded as the web client sends it
 * (`web/src/api/http.ts` `encodeForm`): a 1,500-building enemy yard (the
 * largest stored locally has 690), the most fling events a log may hold, each
 * with a five-type roster and a champion with its brain, and one report line
 * per event.
 */
const worstAttackSave = (): string => {
  const buildingdata: Record<string, unknown> = {};
  const buildinghealthdata: Record<string, number> = {};
  for (let id = 0; id < 1500; id++) {
    buildingdata[id] = { X: -1234 + id, Y: 987 - id, l: 10, t: 17, id, cP: 7, pr: 1, st: 0, rCP: 7, fort: 4, rE: 1 };
    buildinghealthdata[id] = 123456;
  }
  const events = Array.from({ length: MAX_CHECKPOINT_EVENTS }, (_, at) => ({
    kind: "fling",
    t: 100_000 + at * 37,
    x: -1234.5678,
    y: 987.6543,
    r: 312.5,
    monsters: { C1: 25, C5: 25, C12: 10, C14: 4, C18: 2 },
    champion: { t: 4, l: 6, pl: 3, fb: 3, s: 2, b: { aggro: 0.1234, ranged: 0.5678, flank: 0.9012, retreat: 0.3456 } },
  }));
  const fields = {
    basesaveid: "1234567",
    over: "1",
    tick: "36000",
    buildingdata: JSON.stringify(buildingdata),
    buildinghealthdata: JSON.stringify(buildinghealthdata),
    flinglog: JSON.stringify({ v: 1, seed: 123456789, events }),
    attackreport: events.map((_, at) => `0:${at} Flung 25 Pokey, 25 Bolt, 10 Fink, 4 Brain, 2 Crabatron at -1234,987`).join("\n"),
    resources: JSON.stringify({ r1: 12345678, r2: 12345678, r3: 12345678, r4: 12345678 }),
    monsters: JSON.stringify({ C1: 250, C5: 250, C12: 100, C14: 40, C18: 20 }),
  };
  return new URLSearchParams(fields).toString();
};

let server: Server;
let base: string;

beforeAll(async () => {
  const app = new Koa();
  app.use(bodyParsers());
  app.use((ctx) => {
    ctx.body = { keys: Object.keys(ctx.request.body as object).length };
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

const post = (path: string, body: string, method = "POST") =>
  fetch(`${base}${path}`, { method, body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });

const postJson = (path: string, body: unknown, method = "POST") =>
  fetch(`${base}${path}`, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

describe("the request body limit (security audit 2026-10-29, M4)", () => {
  test("the worst attack save is under a third of the limit, and is read", async () => {
    const body = worstAttackSave();

    expect(body.length).toBeLessThan(BODY_LIMIT / 3);
    const answer = await post("/base/save", body);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ keys: 9 });
  });

  test("a body over the limit on a game route is refused unread (413)", async () => {
    const answer = await post("/base/save", `buildingdata=${"x".repeat(BODY_LIMIT + 1)}`);
    expect(answer.status).toBe(413);

    const json = await postJson("/api/v1/player/recorddebugdata", { key: "err", value: "x".repeat(BODY_LIMIT) });
    expect(json.status).toBe(413);
  });

  test("a bug report with both pictures at their largest is read", async () => {
    // 1.5 MB + 3 MB decoded, base64 encoded (`BugReportConfig.ts`).
    const picture = (decoded: number) => `data:image/png;base64,${"A".repeat(Math.ceil(decoded / 3) * 4)}`;
    const report = { message: "The Flinger is stuck", screenshot: picture(1_500_000), picture: picture(3_000_000) };

    for (const path of ["/api/v1/bugreport", "/api/v1/bugreport/guest"]) {
      const answer = await postJson(path, report);
      expect([path, answer.status]).toEqual([path, 200]);
    }
  });

  test("the owner's announcement writes keep the larger limit, its reads and dismissals do not", async () => {
    const images = Array.from({ length: 3 }, () => ({ data: `data:image/png;base64,${"A".repeat(1_333_400)}` }));

    expect((await postJson("/api/v1/admin/announcements", { title: "t", images })).status).toBe(200);
    expect((await postJson("/api/v1/admin/announcements/12", { title: "t", images }, "PUT")).status).toBe(200);
    expect((await postJson("/api/v1/bm/announcements/12/dismiss", { images })).status).toBe(413);
  });

  test("even the picture routes stop at 8 MB", async () => {
    const answer = await postJson("/api/v1/bugreport", { picture: "A".repeat(LARGE_BODY_LIMIT) });
    expect(answer.status).toBe(413);
  });

  test("isLargeBodyRoute", () => {
    expect(isLargeBodyRoute("POST", "/api/v1.2/bugreport")).toBe(true);
    expect(isLargeBodyRoute("GET", "/api/v1/bugreport")).toBe(false);
    expect(isLargeBodyRoute("POST", "/api/v1/bugreport/other")).toBe(false);
    expect(isLargeBodyRoute("POST", "/base/save")).toBe(false);
    expect(isLargeBodyRoute("DELETE", "/api/v1/admin/announcements/3")).toBe(false);
  });
});
