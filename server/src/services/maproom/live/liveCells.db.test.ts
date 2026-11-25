import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { MikroORM, RequestContext } from "@mikro-orm/postgresql";
import { RedisClient } from "bun";

/**
 * The live map's pushed cells against `getarea` on a real database (beta 9, stage 2): for each
 * viewer and zone, what the socket would send that viewer (the stranger's copy of each changed
 * cell, cut by the viewer's fog exactly as the gateway cuts it, the viewer's own cells from their
 * own channel, relations kept from their own answer as the map keeps them) must equal the
 * viewer's own `getarea` answer, cell for cell.
 *
 * Opt-in like the other database tests: runs only when LIVE_MAP_TEST_DB names a throwaway copy
 * made from `inferno_mon` (yardtester 2503 and agenttester 2505 side by side, yardtester attacked
 * agenttester), never the shared `bym`, with REDIS_URL on the helper's own Redis slot. Reads only
 * (and the sight cache in that slot).
 */
const dbName = process.env.LIVE_MAP_TEST_DB;
const redisUrl = process.env.REDIS_URL ?? "";

const postgres: { orm?: MikroORM; em?: unknown } = {};
const redis = dbName ? new RedisClient(redisUrl) : ({} as RedisClient);
mock.module("../../../server.js", () => ({ postgres, redis }));

const ormConfig = (await import("../../../mikro-orm.config.js")).default;
const { User } = await import("../../../database/models/user.model.js");
const { buildAreas } = await import("../../../controllers/maproom/v2/getArea.js");
const { buildOwnerCells, buildPublicCells } = await import("./liveCells.js");
const { maskShows, zoneMask } = await import("./liveFog.js");
const { zoneId } = await import("./liveZones.js");
const { getPlayerSight } = await import("../sight/sightService.js");
const { RELATION_FIELDS } = await import("../v2/areaCells.js");
const { mr2HexShape } = await import("../../../config/MapRoom2Config.js");

/** Fields only a cell's owner sees, or only a viewer related to its owner. */
const PRIVATE_FIELDS = ["r", "m", "nh", "f", "c", "wi", "wb", "wf", "t", "ak", "fp", "ho"];

const plain = (value: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(value ?? null));

describe.skipIf(!dbName)("live map pushes equal getarea, per viewer (stage 2)", () => {
  let orm: MikroORM;
  let world = "";
  const seen = { own: 0, other: 0, hidden: 0, ground: 0 };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("LIVE_MAP_TEST_DB must be a throwaway database, not bym");
    if (!/\/(1[0-9]|[2-9])$/.test(redisUrl)) throw new Error("REDIS_URL must name the helper's own Redis slot");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
    postgres.orm = orm;
    Object.defineProperty(postgres, "em", { get: () => orm.em, configurable: true });
    await redis.connect();
    const [row] = await orm.em
      .fork()
      .execute<{ world_id: string }[]>(`SELECT world_id FROM bym.world_map_cell WHERE uid = 2503 AND map_version = 2 LIMIT 1`);
    world = row!.world_id;
  });
  afterAll(async () => {
    if (!orm) return;
    await orm.close(true);
    redis.close();
  });

  /** What the socket would give `viewer` for zone origin `x, y`, next to their own `getarea` answer. */
  const compare = async (viewer: number, x: number, y: number) =>
    RequestContext.create(orm.em, async () => {
      const user = await orm.em.findOneOrFail(User, { userid: viewer });
      const ctx = { authUser: user, state: {}, request: { body: {} } };
      const [answer] = await buildAreas(ctx as never, [{ x, y }], 0);
      const data = (answer as { data: Record<string, Record<string, unknown>> }).data;

      const coords: [number, number][] = [];
      for (let cx = x; cx <= x + 10; cx++) for (let cy = y; cy <= y + 10; cy++) coords.push([cx, cy]);
      const pub = await buildPublicCells(world, coords);
      const own = new Map((await buildOwnerCells(viewer, world, coords)).map(([cx, cy, cell]) => [`${cx},${cy}`, cell]));
      const sight = await getPlayerSight(user, { waitForRebuild: true });
      const mask = zoneMask(sight, zoneId(x, y), mr2HexShape());

      for (const [cx, cy, payload] of pub.cells) {
        const cell = plain(payload);
        // Nothing private in what every watcher receives.
        for (const field of PRIVATE_FIELDS) expect(cell[field]).toBeUndefined();
        // Flags every player cell carries, always "no" in the stranger's copy.
        for (const field of ["fr", "mine", "pi"]) if (cell[field] !== undefined) expect(cell[field]).toBe(0);

        const expected = plain(data[String(cx)]![String(cy)]);
        if (!maskShows(mask, zoneId(x, y), cx, cy)) {
          // Left out of the push; the map holds getarea's `{fog: 1}` there.
          expect(expected).toEqual({ fog: 1 });
          seen.hidden += 1;
          continue;
        }
        if (cell.uid === viewer && typeof cell.b === "number" && cell.b >= 2) {
          // The viewer's own cell: its own-channel copy, in full.
          expect(plain(own.get(`${cx},${cy}`))).toEqual(expected);
          seen.own += 1;
          continue;
        }
        // Someone else's: the stranger's copy with the viewer's relations kept from their answer.
        const merged = { ...cell };
        for (const field of RELATION_FIELDS) {
          if (expected[field] === undefined) delete merged[field];
          else merged[field] = expected[field];
        }
        expect(merged).toEqual(expected);
        if (typeof cell.uid === "number" && cell.uid > 0) seen.other += 1;
        else seen.ground += 1;
      }
    });

  const ZONES: [number, number][] = [
    [230, 200],
    [240, 200],
    [230, 210],
    [220, 210],
  ];

  test("yardtester (owner of most cells here, attacked agenttester)", async () => {
    for (const [x, y] of ZONES) await compare(2503, x, y);
  });

  test("agenttester (attacked by yardtester, owns one cell here)", async () => {
    for (const [x, y] of ZONES) await compare(2505, x, y);
  });

  test("a player far away, who sees little or none of it", async () => {
    for (const [x, y] of ZONES) await compare(3104, x, y);
  });

  test("every kind of cell was compared", () => {
    expect(seen.own).toBeGreaterThan(0);
    expect(seen.other).toBeGreaterThan(0);
    expect(seen.hidden).toBeGreaterThan(0);
    expect(seen.ground).toBeGreaterThan(0);
  });
});
