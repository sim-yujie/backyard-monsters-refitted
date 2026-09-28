import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";
import { generateBaseId } from "../../../utils/generateBaseId.js";
import { generateNoise, getTerrainHeight } from "../../../services/maproom/v2/generateMap.js";
import { quoteTakeover } from "../../../services/maproom/v2/takeoverCost.js";

/**
 * `POST /worldmapv2/takeoverquote` (issue #82): the price and the takeover's
 * own verdict, for the web's Take over button. Driven over an in-memory
 * stand-in for the rows, with Redis as a map so the grants are real.
 */

const TAKER = 2505;
const OWNER = 77;
const WORLD = "world-a";
const OUTPOST = "2000240208";
const CAMP = "2000242208";

type Row = Record<string, unknown>;

let takerSave: Row;
let cells: Row[];
let sessions: Set<number>;
let inRange: boolean;
let user: Row;

const store = new Map<string, string>();
const GRANT_KEY = "takeover-grant:900";

const now = () => Math.floor(Date.now() / 1000);

const grantTo = (attackerid: number, expiresAt = now() + 600) => {
  store.set(GRANT_KEY, JSON.stringify({ attackerid, basesaveid: 900, baseid: OUTPOST, expiresAt }));
  (cells[0]!.save as Row).protected = expiresAt + 8 * 3600;
};

const cellRow = (baseid: string, uid: number, base_type: number, x: number, save: Row | null): Row => ({
  baseid,
  uid,
  x,
  y: 208,
  base_type,
  map_version: 2,
  save: save && { baseid, attackid: 0, attacks: [], protected: 0, locked: 0, wmid: 0, savetime: now() - 60, ...save },
});

mock.module("../../../server.js", () => ({
  postgres: {
    em: {
      populate: async (target: Row) => {
        target.save = takerSave;
      },
      findOne: async (_entity: unknown, where: Row) =>
        cells.find((cell) => cell.baseid === where.baseid && where.world === WORLD) ?? null,
    },
  },
  redis: {
    get: async (key: string) => store.get(key) ?? null,
  },
}));

mock.module("../../../services/maproom/v2/validateRange.js", () => ({
  validateRange: async () => {
    if (!inRange) throw new Error("out of range");
  },
  rangeCheckV2: async () => ({
    cell: null,
    verdict: inRange ? { ok: true, via: "main" } : { ok: false, reason: "out-of-range" },
  }),
}));

mock.module("../../../services/base/attackSessionStore.js", () => ({
  startAttackSession: async () => {},
  readAttackSession: async (basesaveid: number) =>
    sessions.has(basesaveid) ? { attackerid: OWNER, attackid: 1, startedat: 0 } : null,
  endAttackSession: async () => {},
}));

const { takeoverQuote } = await import("./takeoverQuote.js");

const quote = async (baseid: string) => {
  const ctx = { authUser: user, request: { body: { baseid } } } as unknown as Context;
  await takeoverQuote(ctx, async () => {});
  return ctx.body as Row;
};

const outpost = () => cells[0]!.save as Row;
const camp = () => cells[1]!.save as Row;

beforeEach(() => {
  user = { userid: TAKER, username: "taker", alliance_id: null, shiny_locked: false };
  takerSave = {
    basesaveid: 2526,
    userid: TAKER,
    type: "main",
    homebase: ["241", "207"],
    worldid: WORLD,
    credits: 5000,
    resources: { r1: 100_000_000, r2: 100_000_000, r3: 100_000_000, r4: 100_000_000 },
    outposts: [],
  };
  cells = [
    cellRow(OUTPOST, OWNER, 3, 240, {
      basesaveid: 900,
      userid: OWNER,
      saveuserid: OWNER,
      type: "outpost",
      damage: 92,
      empirevalue: 10_000_000,
    }),
    cellRow(CAMP, 0, 1, 242, { basesaveid: 901, userid: 0, saveuserid: 0, type: "tribe", damage: 95, wmid: 41 }),
  ];
  sessions = new Set();
  inRange = true;
  store.clear();
});

describe("takeoverQuote", () => {
  test("a destroyed camp in range: eligible, priced as takeoverCell charges it, affordable both ways", async () => {
    const body = await quote(CAMP);
    const price = quoteTakeover({
      cell: { x: 242, y: 208 },
      isWildMonster: true,
      empireValue: 0,
      takerHomebase: ["241", "207"],
      conquestActive: false,
    });
    expect(body).toEqual({
      error: 0,
      baseid: CAMP,
      kind: "camp",
      eligible: true,
      reason: null,
      ...price,
      affordable: { resources: true, shiny: true },
      shinyLocked: false,
      now: expect.any(Number),
    });
    expect(body.grantExpiresAt).toBeUndefined();
  });

  test("next to the taker's main yard the price is halved and adjacent is set", async () => {
    takerSave.homebase = ["100", "100"];
    const far = await quote(CAMP);
    takerSave.homebase = ["241", "207"];
    const near = await quote(CAMP);
    expect(near.adjacent).toBe(true);
    expect(far.adjacent).toBe(false);
    expect(near.resources).toBe((far.resources as number) / 2);
  });

  test("a camp below 90%, regenerated, protected, locked or under attack says why", async () => {
    camp().damage = 60;
    expect((await quote(CAMP)).reason).toBe("notDestroyed");

    camp().damage = 95;
    camp().savetime = now() - 13 * 3600;
    expect((await quote(CAMP)).reason).toBe("regenerated");

    camp().savetime = now() - 60;
    camp().protected = now() + 60;
    expect((await quote(CAMP)).reason).toBe("protected");

    camp().protected = 0;
    camp().locked = OWNER;
    expect((await quote(CAMP)).reason).toBe("locked");

    camp().locked = 0;
    sessions.add(901);
    const body = await quote(CAMP);
    expect(body.reason).toBe("underAttack");
    expect(body.eligible).toBe(false);
    // Still priced, so the panel can say what it would cost.
    expect(body.resources).toBeGreaterThan(0);
  });

  test("out of reach is a reason, not an error", async () => {
    inRange = false;
    const body = await quote(CAMP);
    expect(body.eligible).toBe(false);
    expect(body.reason).toBe("outOfRange");
  });

  test("a player outpost with the caller's live grant: eligible, with the grant's end", async () => {
    const expiresAt = now() + 300;
    grantTo(TAKER, expiresAt);
    const body = await quote(OUTPOST);
    expect(body.kind).toBe("outpost");
    expect(body.eligible).toBe(true);
    expect(body.grantExpiresAt).toBe(expiresAt);
    expect(body.resources).toBe(
      quoteTakeover({
        cell: { x: 240, y: 208 },
        isWildMonster: false,
        empireValue: 10_000_000,
        takerHomebase: ["241", "207"],
        conquestActive: false,
      }).resources
    );
  });

  test("a player outpost without the caller's grant: no chance, and no grant time leaks", async () => {
    expect((await quote(OUTPOST)).reason).toBe("noTakeoverChance");

    grantTo(TAKER + 1);
    const other = await quote(OUTPOST);
    expect(other.reason).toBe("noTakeoverChance");
    expect(other.grantExpiresAt).toBeUndefined();

    grantTo(TAKER, now() - 1);
    const expired = await quote(OUTPOST);
    expect(expired.reason).toBe("noTakeoverChance");
    expect(expired.grantExpiresAt).toBeUndefined();
  });

  test("affordability is per payment: short of one resource, out of Shiny, or Shiny locked", async () => {
    (takerSave.resources as Row).r3 = 10;
    takerSave.credits = 1;
    let body = await quote(CAMP);
    expect(body.eligible).toBe(true);
    expect(body.affordable).toEqual({ resources: false, shiny: false });

    takerSave.credits = 5000;
    user.shiny_locked = true;
    body = await quote(CAMP);
    expect(body.affordable).toEqual({ resources: false, shiny: false });
    expect(body.shinyLocked).toBe(true);
  });

  test("the caller's own outpost is theirs already", async () => {
    cells[0]!.uid = TAKER;
    outpost().userid = TAKER;
    expect((await quote(OUTPOST)).reason).toBe("ownYard");
  });

  test("a camp nobody has attacked has no row: priced from its id, not destroyed", async () => {
    const noise = generateNoise(WORLD);
    let x = 300;
    while (getTerrainHeight(noise, x, 300) <= 99) x += 1;
    const baseid = generateBaseId(WORLD, x, 300);

    const body = await quote(baseid);
    expect(body.kind).toBe("camp");
    expect(body.eligible).toBe(false);
    expect(body.reason).toBe("notDestroyed");
    expect(body.resources).toBeGreaterThan(0);
    expect(body.shiny).toBeGreaterThan(0);
  });

  test("an id that is no cell of this world, or water, is not found and has no price", async () => {
    const body = await quote("123");
    expect(body).toEqual({ error: 0, baseid: "123", eligible: false, reason: "notFound", now: expect.any(Number) });

    const noise = generateNoise(WORLD);
    let x = 0;
    while (getTerrainHeight(noise, x, 0) > 99 && x < 799) x += 1;
    if (getTerrainHeight(noise, x, 0) <= 99) {
      expect((await quote(generateBaseId(WORLD, x, 0))).reason).toBe("notFound");
    }
  });
});
