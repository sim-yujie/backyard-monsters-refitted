import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { EntityManager } from "@mikro-orm/core";
import type { User } from "../../database/models/user.model.js";
import { wallLineLimiter } from "../../middleware/rateLimiters.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { yardBuildAction } from "./build.js";
import { yardBuildWallsAction } from "./buildWalls.js";
import { runYardAction, type YardAnswer } from "./yardAction.js";
// The route list pulls in `yardRoute`, which reads the server; stand it in.
mock.module("../../server.js", () => ({ postgres: { em: {} }, redis: {} }));
const { yardRoutes } = await import("./index.js");

/**
 * `POST /bm/yard/build/walls` through the real wrapper, with the database
 * replaced by one in-memory row written only when a transaction commits (as
 * `build.test.ts` does).
 */

type Row = Record<string, unknown>;

const db = { row: null as Row | null };

const em = {
  async transactional<T>(cb: (fork: unknown) => Promise<T>): Promise<T> {
    let entity: Row | null = null;
    const fork = {
      async findOne() {
        entity = db.row && structuredClone(db.row);
        return entity;
      },
      async flush() {},
    };
    const result = await cb(fork);
    if (entity) db.row = structuredClone(entity);
    return result;
  },
};

const user = {
  userid: 2503,
  shiny_locked: false,
  save: { basesaveid: 7 },
} as unknown as User;

/** A main yard saved just now: level 3 hall (60 Blocks allowed), a level 10 silo, 60,000 Twigs. */
const rowOf = (overrides: Row = {}): Row => ({
  basesaveid: 7,
  userid: 2503,
  type: "main",
  attackid: 0,
  attacks: [],
  savetime: getCurrentDateTime(),
  credits: 100,
  points: "100",
  flinger: 0,
  catapult: 0,
  resources: { r1: 60000, r2: 40000, r3: 20000, r4: 0 },
  buildingdata: {
    "1": { id: 1, t: 14, X: -65, Y: -65, l: 3 },
    "2": { id: 2, t: 6, X: -400, Y: 200, l: 10 },
  },
  buildinghealthdata: {},
  storedata: {},
  monsters: {},
  lockerdata: { C1: { t: 2 } },
  academy: {},
  champion: [],
  mushrooms: { l: [], s: getCurrentDateTime() },
  researchdata: {},
  outposts: [],
  ...overrides,
});

const call = (action: Parameters<typeof runYardAction>[2], body: Row): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, user, action, body);

/** Sends a line as the web does: `cells` a JSON string of `[x, y]` pairs. */
const line = (cells: unknown, type: unknown = 17) =>
  call(yardBuildWallsAction, { type, cells: typeof cells === "string" ? cells : JSON.stringify(cells) });

/** `n` Blocks side by side along x from `(x, y)`, 20 units apart. */
const row = (n: number, x = 100, y = 200): [number, number][] =>
  Array.from({ length: n }, (_, i) => [x + i * 20, y] as [number, number]);

const buildings = () => db.row!.buildingdata as Record<string, Row>;
const wallCount = () => Object.values(buildings()).filter((one) => one.t === 17).length;

beforeEach(() => {
  db.row = rowOf();
});

describe("POST /bm/yard/build/walls", () => {
  test("builds the whole line finished, charged once, points for each, ids in line order", async () => {
    const answer = await line(row(5));

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      error: 0,
      resources: { r1: 55000, r2: 40000 },
      report: {
        t: 17,
        built: [
          { id: 3, x: 100, y: 200 },
          { id: 4, x: 120, y: 200 },
          { id: 5, x: 140, y: 200 },
          { id: 6, x: 160, y: 200 },
          { id: 7, x: 180, y: 200 },
        ],
        refused: [],
        cost: { r1: 5000, r2: 0, r3: 0, r4: 0 },
        points: 510,
      },
    });
    expect(buildings()["3"]).toEqual({ id: 3, t: 17, X: 100, Y: 200 });
    expect(buildings()["7"]).toEqual({ id: 7, t: 17, X: 180, Y: 200 });
    expect(db.row!.points).toBe("610");
  });

  test("an L: both legs in the order sent", async () => {
    const answer = await line([
      [100, 200],
      [120, 200],
      [140, 200],
      [140, 220],
      [140, 240],
    ]);
    expect(answer.status).toBe(200);
    expect((answer.body.report as { built: unknown[] }).built).toHaveLength(5);
    expect(wallCount()).toBe(5);
  });

  test("skips a blocked cell (a building in the way, outside the yard) and builds the rest", async () => {
    // A Block already stands at (140, 200); the last cell is far outside the plot.
    db.row!.buildingdata = { ...buildings(), "3": { id: 3, t: 17, X: 140, Y: 200 } };
    const answer = await line([...row(4), [3000, 3000]]);

    expect(answer.status).toBe(200);
    const report = answer.body.report as { built: { x: number }[]; refused: Row[] };
    expect(report.built.map((one) => one.x)).toEqual([100, 120, 160]);
    expect(report.refused).toEqual([
      { x: 140, y: 200, reason: "placement", placement: "overlap", with: 3 },
      { x: 3000, y: 3000, reason: "placement", placement: "outOfBounds" },
    ]);
    expect(answer.body.resources).toMatchObject({ r1: 57000 });
  });

  test("a cell overlapping one placed earlier in the same line is skipped", async () => {
    const answer = await line([
      [100, 200],
      [110, 200],
      [120, 200],
    ]);
    const report = answer.body.report as { built: { x: number }[]; refused: Row[] };
    expect(report.built.map((one) => one.x)).toEqual([100, 120]);
    expect(report.refused).toEqual([{ x: 110, y: 200, reason: "placement", placement: "overlap", with: 3 }]);
  });

  test("not fully affordable: builds what it can from the start, the rest refused shortfall", async () => {
    db.row!.resources = { r1: 3500, r2: 0, r3: 0, r4: 0 };
    const answer = await line(row(6));

    expect(answer.status).toBe(200);
    const report = answer.body.report as { built: { x: number }[]; refused: Row[] };
    expect(report.built.map((one) => one.x)).toEqual([100, 120, 140]);
    expect(report.refused.map((one) => one.reason)).toEqual(["shortfall", "shortfall", "shortfall"]);
    expect(answer.body.resources).toMatchObject({ r1: 500 });
  });

  test("stops at the hall's limit, counting the Blocks built earlier in the line", async () => {
    // 58 of the 60 a level 3 hall allows, far from the line.
    const walls: Record<string, Row> = {};
    for (let i = 0; i < 58; i++) walls[String(10 + i)] = { id: 10 + i, t: 17, X: -500 + (i % 20) * 20, Y: -400 + Math.floor(i / 20) * 20 };
    db.row!.buildingdata = { ...buildings(), ...walls };
    const answer = await line(row(5));

    expect(answer.status).toBe(200);
    const report = answer.body.report as { built: unknown[]; refused: Row[] };
    expect(report.built).toHaveLength(2);
    expect(report.refused.map((one) => one.reason)).toEqual(["limit", "limit", "limit"]);
    expect(wallCount()).toBe(60);
    expect(answer.body.resources).toMatchObject({ r1: 58000 });
  });

  test("nothing buildable refuses as the single build would, and writes nothing", async () => {
    db.row!.resources = { r1: 500, r2: 0, r3: 0, r4: 0 };
    const before = structuredClone(db.row);
    const short = await line(row(3));
    expect(short.status).toBe(409);
    expect(short.body).toMatchObject({ reason: "shortfall" });
    expect(db.row).toEqual(before);

    db.row = rowOf();
    const blocked = await line([[0, 0], [3000, 3000]]); // on the hall, then off the plot
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ reason: "placement", placement: "overlap", with: 1 });
  });

  test("a hall that allows no Blocks refuses townHall", async () => {
    db.row!.buildingdata = { ...buildings(), "1": { id: 1, t: 14, X: -65, Y: -65, l: 1 } };
    const answer = await line(row(2));
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ reason: "townHall" });
  });

  test("only walls: any other type is a 400 notWall", async () => {
    const answer = await line(row(2), 20);
    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ reason: "notWall" });
    const trap = await line(row(2), 117);
    expect(trap.body).toMatchObject({ reason: "notWall" });
  });

  test("a malformed body is a 400 badRequest and writes nothing", async () => {
    const before = structuredClone(db.row);
    const bad = [
      line("not json"),
      line([]),
      line([[100, 200], [100, 200]]), // a cell twice
      line([[101, 200]]), // off the 5-unit grid
      line([[100]]),
      line([[100, 200.5]]),
      line([[9000, 0]]),
      line(row(401, -2000, 0)),
      line(row(2), "wall"),
      call(yardBuildWallsAction, { type: 17 }),
    ];
    for (const answer of await Promise.all(bad)) {
      expect(answer.status).toBe(400);
      expect(answer.body).toMatchObject({ reason: "badRequest" });
    }
    expect(db.row).toEqual(before);
  });

  test("the single build still works beside it", async () => {
    const answer = await call(yardBuildAction, { type: 17, x: 0, y: 200 });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ report: { id: 3, finished: true } });
  });
});

describe("build/walls is mounted behind the login check and its own limiter", () => {
  test("listed with wallLineLimiter, and app.routes.ts mounts every yard route after verifyUserAuth", () => {
    const entry = yardRoutes.find((one) => one.path === "build/walls");
    expect(entry?.limiter).toBe(wallLineLimiter);
    const routes = readFileSync(new URL("../../app.routes.ts", import.meta.url), "utf8");
    const mounts = [...routes.matchAll(/router\.post\(`\/api\/:apiVersion\/bm\/yard\/\$\{path\}`,([^)]*)\)/g)].map(
      ([, args]) => args!.split(",").map((one) => one.trim())
    );
    expect(mounts.length).toBeGreaterThan(0);
    for (const args of mounts) expect(args.slice(0, 2)).toEqual(["apiVersion", "verifyUserAuth"]);
    expect(mounts.some((args) => args.includes("limiter"))).toBe(true);
  });

  test("wallLineLimiter lets 30 a minute through per player, then answers 429", async () => {
    const request = async (userid: number) => {
      const ctx = {
        authUser: { userid },
        ip: "127.0.0.1",
        request: { ip: "127.0.0.1" },
        state: {} as Record<string, unknown>,
        status: undefined as number | undefined,
        body: undefined as unknown,
        set: () => {},
      };
      let passed = false;
      await wallLineLimiter(ctx as never, async () => {
        passed = true;
      });
      return { status: ctx.status, passed };
    };
    for (let at = 0; at < 30; at++) expect((await request(9101)).passed).toBe(true);
    const over = await request(9101);
    expect(over.passed).toBe(false);
    expect(over.status).toBe(429);
    expect((await request(9102)).passed).toBe(true);
  });
});
