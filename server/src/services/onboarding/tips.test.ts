import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type { User } from "../../database/models/user.model.js";
import { runYardAction, type YardAnswer } from "../../controllers/yard/yardAction.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { markTipsSeen, TIP_SCREENS, yardTipsSeenAction } from "./tips.js";

/**
 * `POST /bm/yard/tips/seen` (issue #227, `docs/design/tutorial.md` §7.1,
 * §8.3) through the real wrapper, with the database replaced by one in-memory
 * row written only when a transaction commits (as in `mushrooms.test.ts`).
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

const user = { userid: 2505, shiny_locked: false, save: { basesaveid: 7 } } as unknown as User;

const rowOf = (overrides: Row = {}): Row => ({
  basesaveid: 7,
  userid: 2505,
  type: "main",
  attackid: 0,
  attacks: [],
  savetime: getCurrentDateTime(),
  credits: 10,
  points: "100",
  flinger: 0,
  catapult: 0,
  resources: { r1: 1000, r2: 1000, r3: 1000, r4: 0 },
  buildingdata: { "0": { id: 0, t: 14, x: 0, y: 0, X: 0, Y: 0, l: 3 } },
  buildinghealthdata: {},
  storedata: {},
  monsters: {},
  lockerdata: {},
  academy: {},
  champion: [],
  mushrooms: { l: [], s: getCurrentDateTime() },
  researchdata: {},
  outposts: [],
  mr2upgraded: true,
  mapversion: 2,
  ...overrides,
});

const seen = (body: Row): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, user, yardTipsSeenAction, body);

beforeEach(() => {
  db.row = rowOf({ onboarding: { v: 1, guide: { state: "skipped" }, tips: { shop: 50 } } });
});

describe("tips/seen", () => {
  test("writes the screen's time, and the answer's summary carries it", async () => {
    const before = getCurrentDateTime();
    const answer = await seen({ screen: "mail" });

    expect(answer.status).toBe(200);
    expect(answer.body.report).toEqual({ screen: "mail", changed: true });
    const tips = (db.row!.onboarding as { tips: Record<string, number> }).tips;
    expect(tips.shop).toBe(50);
    expect(tips.mail).toBeGreaterThanOrEqual(before);
    expect((answer.body.onboarding as { tips: Record<string, number> }).tips.mail).toBe(tips.mail!);
  });

  test("a screen already seen keeps its first time", async () => {
    const answer = await seen({ screen: "shop" });

    expect(answer.status).toBe(200);
    expect(answer.body.report).toEqual({ screen: "shop", changed: false });
    expect((db.row!.onboarding as { tips: Record<string, number> }).tips.shop).toBe(50);
  });

  test("leaves the rest of the record alone", async () => {
    db.row = rowOf({
      onboarding: {
        v: 1,
        guide: { state: "done", endedAt: 9 },
        raidSeen: 4,
        goals: { T1: { done: 3, claimed: 5 } },
        counters: { mushrooms: 2 },
      },
    });
    await seen({ screen: "planner" });

    expect(db.row!.onboarding).toMatchObject({
      guide: { state: "done", endedAt: 9 },
      raidSeen: 4,
      goals: { T1: { done: 3, claimed: 5 } },
      counters: { mushrooms: 2 },
    });
  });

  test("a legacy save (no record) is given one with the screen seen", async () => {
    db.row = rowOf();
    const answer = await seen({ screen: "yard" });

    expect(answer.status).toBe(200);
    expect(db.row!.onboarding).toMatchObject({ guide: { state: "legacy" }, goalsBaseline: "pending" });
    expect((db.row!.onboarding as { tips: Record<string, number> }).tips.yard).toBeGreaterThan(0);
  });

  test("an unknown or missing screen is refused 400 badRequest, and nothing is written", async () => {
    for (const body of [{ screen: "nope" }, { screen: "" }, {}, { screen: 3 }]) {
      const before = structuredClone(db.row);
      const answer = await seen(body);

      expect(answer.status).toBe(400);
      expect(answer.body.reason).toBe("badRequest");
      expect(db.row).toEqual(before);
    }
  });

  test("is refused on an outpost (the record lives on the main yard)", () => {
    expect(yardTipsSeenAction.outposts).toBeUndefined();
  });
});

describe("markTipsSeen", () => {
  test("knows every screen the web client emits, and the planner", () => {
    expect(TIP_SCREENS).toContain("planner");
    expect(new Set(TIP_SCREENS).size).toBe(TIP_SCREENS.length);
  });

  test("does not change the save it is given", () => {
    const save = { onboarding: { v: 1, guide: { state: "skipped" }, tips: {} } };
    const { onboarding, changed } = markTipsSeen(save, "mr1", 77);

    expect(changed).toBe(true);
    expect(onboarding.tips).toEqual({ mr1: 77 });
    expect(save.onboarding.tips).toEqual({});
  });
});
