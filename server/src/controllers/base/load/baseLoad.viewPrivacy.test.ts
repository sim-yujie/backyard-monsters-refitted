import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";
import { Save } from "../../../database/models/save.model.js";
import { User } from "../../../database/models/user.model.js";
import { devConfig } from "../../../config/GameConfig.js";
import { World } from "../../../database/models/world.model.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { matchesWhere } from "../../../testing/matchesWhere.js";
import { generateBaseId } from "../../../utils/generateBaseId.js";

/**
 * What looking at someone else's yard sends over the wire (owner report
 * 2026-10-22, `services/base/viewMask.ts`): `/base/load` in view mode and the
 * old polling route `/base/updatesaved` both leave every trap out and send
 * each building at the level its art needs, so the network tab shows no more
 * than the screen. A refused attack load sends nothing at all: the yard is
 * only ever served whole once the attack is committed.
 *
 * Drives the two controllers over an in-memory stand-in for the rows they
 * read; the fog of war is switched off, its own tests cover it.
 */

const VIEWER = 2505;
const OWNER = 2503;
const BOOBY_TRAP = 24;
const HEAVY_TRAP = 117;
const SNIPER = 21;

type Row = Record<string, unknown>;

let tables: Map<unknown, Row[]>;

const em = {
  findOne: async (entity: unknown, where: Row) =>
    (tables.get(entity) ?? []).find((row) => matchesWhere(row, where)) ?? null,
  find: async (entity: unknown, where: Row) => (tables.get(entity) ?? []).filter((row) => matchesWhere(row, where)),
  populate: async () => {},
  transactional: async (run: (tx: unknown) => Promise<unknown>) => run(em),
  create: (_entity: unknown, data: Row) => data,
  persist: () => {},
  remove: () => {},
  flush: async () => {},
};

mock.module("../../../server.js", () => ({
  postgres: { em },
  redis: {
    get: async () => null,
    setex: async () => "OK",
    del: async () => 0,
    smembers: async () => [],
  },
}));

mock.module("../../../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

const { baseLoad } = await import("./baseLoad.js");
const { updateSaved } = await import("../save/updateSaved.js");

const WORLD = "63349203-5b5a-474d-9537-6f1d888e327a";
/** Two cells apart on Map Room 2, inside the viewer's level 2 Flinger reach. */
const OWNER_BASE = generateBaseId(WORLD, 243, 207);
const VIEWER_BASE = generateBaseId(WORLD, 241, 207);
const now = () => Math.floor(Date.now() / 1000);

const saveOf = (extra: Row): Save =>
  Object.assign(new Save(), {
    type: "main",
    mapversion: 2,
    worldid: WORLD,
    attackid: 0,
    attacks: [],
    protected: 0,
    savetime: now() - 10,
    credits: 980_000,
    points: "0",
    basevalue: "0",
    flinger: 2,
    catapult: 0,
    outposts: [],
    resources: { r1: 1_000, r2: 1_000, r3: 1_000, r4: 1_000 },
    storedata: {},
    monsters: {},
    lockerdata: {},
    academy: {},
    champion: [],
    researchdata: {},
    buildinghealthdata: {},
    ...extra,
  });

/** The yard being looked at: a Town Hall, a hurt level 9 Sniper Tower and two traps. */
const ownerYard = () =>
  saveOf({
    basesaveid: 2524,
    baseid: OWNER_BASE,
    userid: OWNER,
    saveuserid: OWNER,
    homebase: ["243", "207"],
    buildingdata: {
      "1": { id: 1, t: 14, X: 0, Y: 0, l: 8 },
      "2": { id: 2, t: SNIPER, X: 100, Y: 40, l: 9, hp: 30_000 },
      "3": { id: 3, t: BOOBY_TRAP, X: -85, Y: 210 },
      "4": { id: 4, t: HEAVY_TRAP, X: -95, Y: 230 },
    },
    buildinghealthdata: { "2": 30_000, "9": 0 },
  });

const viewerYard = () =>
  saveOf({
    basesaveid: 2526,
    baseid: VIEWER_BASE,
    userid: VIEWER,
    saveuserid: VIEWER,
    homebase: ["241", "207"],
    buildingdata: { "1": { id: 1, t: 14, X: 0, Y: 0, l: 6 } },
  });

const viewer = () =>
  Object.assign(new User(), {
    userid: VIEWER,
    username: "agenttester",
    alliance_id: null,
    shiny_locked: false,
    save: tables.get(Save)!.find((row) => row.userid === VIEWER),
  });

const contextOf = (body: Row) =>
  ({ authUser: viewer(), meetsDiscordAgeCheck: true, request: { body } }) as unknown as Context & { body: Row };

const fogWasOff = devConfig.disableFogOfWar;

beforeEach(() => {
  devConfig.disableFogOfWar = true;
  tables = new Map<unknown, Row[]>([
    [Save, [viewerYard() as unknown as Row, ownerYard() as unknown as Row]],
    [User, [{ userid: OWNER, username: "yardtester", pic_square: "", alliance_id: null }]],
    [World, [{ uuid: WORLD, map_version: 2 }]],
    [WorldMapCell, []],
  ]);
});

afterAll(() => {
  devConfig.disableFogOfWar = fogWasOff;
});

const typesOf = (body: Row) =>
  Object.values(body.buildingdata as Record<string, Row>).map((building) => building.t);

describe("looking at someone else's yard", () => {
  test("/base/load in view mode sends no trap and no real level", async () => {
    const ctx = contextOf({ type: "view", userid: String(VIEWER), baseid: OWNER_BASE, mapversion: "2" });
    await baseLoad(ctx, async () => {});

    const body = ctx.body;
    expect(typesOf(body)).toEqual([14, SNIPER]);
    expect(JSON.stringify(body)).not.toContain(`"t":${BOOBY_TRAP}`);
    expect(JSON.stringify(body)).not.toContain(`"t":${HEAVY_TRAP}`);
    const buildings = body.buildingdata as Record<string, Row>;
    expect(buildings["2"]!.l).toBe(1);
    expect(buildings["1"]!.l).toBe(8);
    expect(Object.keys(body.buildinghealthdata as Row)).toEqual(["2"]);
    expect(body.credits).toBe(0);
  });

  test("the old polling route, /base/updatesaved, is masked the same way", async () => {
    const ctx = contextOf({ type: "view", version: "1", lastupdate: "0", baseid: OWNER_BASE, mapversion: "2" });
    await updateSaved(ctx, async () => {});

    expect(typesOf(ctx.body)).toEqual([14, SNIPER]);
    expect((ctx.body.buildingdata as Record<string, Row>)["2"]!.l).toBe(1);
  });

  test("a committed attack load sends the whole yard, traps and levels, for the battle", async () => {
    const ctx = contextOf({
      type: "attack",
      userid: String(VIEWER),
      baseid: OWNER_BASE,
      mapversion: "2",
      attackData: JSON.stringify({ champions: [], monsters: [] }),
    });
    await baseLoad(ctx, async () => {});

    expect(typesOf(ctx.body)).toEqual(expect.arrayContaining([14, SNIPER, BOOBY_TRAP, HEAVY_TRAP]));
    expect((ctx.body.buildingdata as Record<string, Row>)["2"]!.l).toBe(9);
    // Committed: the yard carries the attack's id, which the save is bound to.
    expect(ctx.body.attackid).toBeGreaterThan(0);
  });

  test("an attack refused before it is committed sends nothing at all", async () => {
    const protectedYard = Object.assign(ownerYard(), { protected: now() + 3_600 });
    tables.set(Save, [viewerYard() as unknown as Row, protectedYard as unknown as Row]);
    const ctx = contextOf({
      type: "attack",
      userid: String(VIEWER),
      baseid: OWNER_BASE,
      mapversion: "2",
      attackData: JSON.stringify({ champions: [], monsters: [] }),
    });

    const refusal = await baseLoad(ctx, async () => {}).then(
      () => null,
      (caught: unknown) => caught
    );

    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toContain("damage protection");
    expect(ctx.body).toBeUndefined();
  });
});
