import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";

import type { User } from "../../database/models/user.model.js";
import { HALLOWEEN_2026_LADDER } from "../../game-data/events/events.js";
import { memoryProgressStore } from "../../services/events/progressStore.js";
import { PUMPKIN_HUNT_EVENT } from "../../services/yard/season.js";
import { eventsActions } from "./eventsActions.js";
import { mushroomPickAction } from "./mushrooms.js";
import { runYardAction, type YardAnswer } from "./yardAction.js";

/**
 * The Halloween pumpkin hunt end to end, on the real events list: pumpkins
 * picked during the event fill the ladder, and a tier is claimable once the
 * count reaches it, through the real yard action wrapper with the save in
 * memory (as `eventsActions.test.ts`) and the in-memory progress store.
 */

type Row = Record<string, unknown>;
const db = { row: null as Row | null };
const em = {
  async transactional<T>(cb: (fork: unknown) => Promise<T>): Promise<T> {
    const entity = db.row && structuredClone(db.row);
    const result = await cb({ findOne: async () => entity, flush: async () => {} });
    db.row = entity;
    return result;
  },
};

const user = { userid: 2, shiny_locked: false, save: { basesaveid: 7 } } as unknown as User;
/** 2026-11-01T12:00:00Z, inside Halloween 2026. */
const DURING = Date.UTC(2026, 10, 1, 12) / 1000;

const rowOf = (): Row => ({
  basesaveid: 7,
  userid: 2,
  type: "main",
  attackid: 0,
  attacks: [],
  savetime: DURING,
  credits: 100,
  points: "0",
  flinger: 0,
  catapult: 0,
  resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
  buildingdata: { "0": { id: 0, t: 14, X: 0, Y: 0, l: 3 } },
  buildinghealthdata: {},
  storedata: {},
  monsters: {},
  lockerdata: {},
  academy: {},
  champion: [],
  mushrooms: { l: [[1, 200, 100]], s: DURING },
  researchdata: {},
  outposts: [],
  mr2upgraded: true,
  mapversion: 2,
});

const run = (action: Parameters<typeof runYardAction>[2], body: Row): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, user, action, body);

beforeEach(() => {
  setSystemTime(new Date(DURING * 1000));
  db.row = rowOf();
});
afterEach(() => setSystemTime());

describe("Halloween pumpkin hunt ladder", () => {
  test("the placeholder tiers are 10, 25, 50 and 100 pumpkins", () => {
    expect(HALLOWEEN_2026_LADDER.map((tier) => tier.need)).toEqual([10, 25, 50, 100]);
  });

  test("the tenth pumpkin unlocks the first tier, which pays once", async () => {
    const store = memoryProgressStore();
    const claims = eventsActions(store);
    await store.addToCounter(em as unknown as EntityManager, 2, PUMPKIN_HUNT_EVENT, 9);

    const early = await run(claims.ladderClaim, { event: PUMPKIN_HUNT_EVENT, tier: 0 });
    expect(early.status).toBe(409);
    expect(early.body).toMatchObject({ reason: "tierLocked", have: 9, need: 10 });

    // An ordinary pumpkin (no golden roll), picked during the event.
    const picked = await run(mushroomPickAction(() => 0.9, store), { id: 0 });
    expect(picked.body).toMatchObject({ report: { golden: false, pumpkins: 10 } });

    const claimed = await run(claims.ladderClaim, { event: PUMPKIN_HUNT_EVENT, tier: 0 });
    expect(claimed.status).toBe(200);
    expect(claimed.body).toMatchObject({ credits: 110, report: { tier: 0 } });

    const again = await run(claims.ladderClaim, { event: PUMPKIN_HUNT_EVENT, tier: 0 });
    expect(again.body).toMatchObject({ reason: "tierClaimed" });
  });
});
