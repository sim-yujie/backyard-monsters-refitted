import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type z from "zod";
import type { User } from "../../database/models/user.model.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import {
  yardChampionCancelEggAction,
  yardChampionEvolveAction,
  yardChampionFeedAction,
  yardChampionHealAction,
  yardChampionJuiceAction,
  yardChampionRaiseAction,
  yardChampionRenameAction,
  yardChampionStanceAction,
} from "./champion.js";
import { yardChampionFreezeAction, yardChampionThawAction } from "./chamber.js";
import { runYardAction, type YardAction, type YardAnswer } from "./yardAction.js";

/**
 * The Champion Cage's routes through the real wrapper, the database replaced
 * by one in-memory row written only when a transaction commits (as
 * `bunker.test.ts`): the catch-up runs first, Shiny is charged and refused the
 * wrapper's way, and a refusal writes nothing.
 */

type Row = Record<string, unknown>;

/** The save row, and the player's `inferno_progress` row (Korath, owner I10). */
const db = { row: null as Row | null, progress: null as Row | null };

const em = {
  async transactional<T>(cb: (fork: unknown) => Promise<T>): Promise<T> {
    let entity: Row | null = null;
    const fork = {
      async findOne(entityClass?: { name?: string }) {
        if (entityClass?.name === "InfernoProgress") return db.progress;
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

const HOUR = 3_600;

const rowOf = (overrides: Row = {}): Row => ({
  basesaveid: 7,
  userid: 2505,
  type: "main",
  attackid: 0,
  attacks: [],
  savetime: getCurrentDateTime(),
  credits: 500,
  points: "100",
  tutorialstage: 0,
  flinger: 0,
  catapult: 0,
  resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
  buildingdata: {
    "0": { id: 0, t: 14, x: 0, y: 0, l: 4 },
    "1": { id: 1, t: 15, x: 0, y: 200, l: 1 },
    "3": { id: 3, t: 114, x: 200, y: 0, l: 1 },
  },
  buildinghealthdata: {},
  storedata: {},
  monsters: { housed: { C2: 20 }, saved: getCurrentDateTime() },
  lockerdata: {},
  academy: {},
  champion: [],
  mushrooms: {},
  researchdata: {},
  outposts: [],
  ...overrides,
});

const run = <S extends z.ZodType, R>(action: YardAction<S, R>, body: Row = {}): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, user, action, body);

const championOf = (row: Row | null) => (row!.champion as Row[])[0]!;

describe("champion routes", () => {
  beforeEach(() => {
    db.row = rowOf();
    db.progress = null;
  });

  test("raise puts the champion in the cage at once, and the answer carries it in the state", async () => {
    const now = getCurrentDateTime();
    const answer = await run(yardChampionRaiseAction, { type: "3" });
    expect(answer.status).toBe(200);
    expect(answer.body.champion).toEqual(db.row!.champion);
    expect(championOf(db.row)).toMatchObject({ t: 3, l: 1, hp: 15_000, status: 0 });
    expect(Number(championOf(db.row).ft)).toBeGreaterThanOrEqual(now + 20 * HOUR);
    expect(db.row!.credits).toBe(500);
    // No waiting: the very next action works on it.
    expect((await run(yardChampionRenameAction, { name: "Sparky" })).status).toBe(200);
  });

  test("juicing a champion is refused (409 juiceDisabled) and writes nothing, even with a working Juicer", async () => {
    const buildingdata = { ...(rowOf().buildingdata as Row), "5": { id: 5, t: 9, x: 400, y: 0, l: 1 } };
    const hurt = { t: 2, hp: 1_000, l: 4, ft: getCurrentDateTime() + HOUR, fd: 0, fb: 0, pl: 1, status: 0 };
    db.row = rowOf({ buildingdata, champion: [hurt] });
    const before = structuredClone(db.row!.champion);
    const answer = await run(yardChampionJuiceAction);
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ reason: "juiceDisabled" });
    expect(db.row!.champion).toEqual(before);
  });

  test("a starving champion loses its feed in the catch-up before the action runs", async () => {
    const now = getCurrentDateTime();
    db.row = rowOf({
      savetime: now - 60,
      champion: [{ t: 1, hp: 1_000, l: 1, ft: now - 25 * HOUR, fd: 2, fb: 0, pl: 1, status: 0 }],
    });
    const answer = await run(yardChampionHealAction);
    expect(answer.status).toBe(200);
    expect((answer.body.completed as Row[]).map((job) => job.kind)).toContain("starve");
    expect(championOf(db.row)).toMatchObject({ l: 1, fd: 1, hp: 40_000 });
    expect(Number(championOf(db.row).ft)).toBeGreaterThanOrEqual(now + 23 * HOUR);

    // Starving restarted the clock: it is not hungry again for 23 hours.
    const feed = await run(yardChampionFeedAction, { mode: "monsters" });
    expect(feed.body).toMatchObject({ reason: "notHungry" });
    expect((db.row!.monsters as Row).housed).toEqual({ C2: 20 });
  });

  test("a hungry champion eats from housing", async () => {
    const now = getCurrentDateTime();
    db.row = rowOf({ champion: [{ t: 1, hp: 40_000, l: 1, ft: now - HOUR, fd: 0, fb: 0, pl: 1, status: 0 }] });
    const answer = await run(yardChampionFeedAction, { mode: "monsters" });
    expect(answer.status).toBe(200);
    expect(answer.body.report).toMatchObject({ mode: "monsters", eaten: { C2: 15 }, credits: 0, evolved: false });
    expect((db.row!.monsters as Row).housed).toEqual({ C2: 5 });
    expect(championOf(db.row)).toMatchObject({ fd: 1 });
  });

  test("Shiny is charged by the wrapper and refused when short", async () => {
    db.row = rowOf({ champion: [{ t: 1, hp: 1, l: 2, ft: getCurrentDateTime() + HOUR, fd: 0, fb: 0, pl: 1, status: 0 }] });
    const evolve = await run(yardChampionEvolveAction);
    expect(evolve.status).toBe(409);
    expect(evolve.body).toMatchObject({ reason: "credits", credits: { have: 500, need: 44 * 2 * 6 } });
    expect(championOf(db.row)).toMatchObject({ l: 2 });

    const heal = await run(yardChampionHealAction);
    expect(heal.status).toBe(200);
    expect(championOf(db.row)).toMatchObject({ hp: 80_000 });
    expect(db.row!.credits).toBe(500 - Number((heal.body.report as Row).credits));
  });

  test("a Shiny-locked account cannot evolve", async () => {
    db.row = rowOf({ credits: 10_000, champion: [{ t: 1, hp: 40_000, l: 1, ft: getCurrentDateTime() + HOUR, fd: 0, fb: 0, pl: 1, status: 0 }] });
    const locked = { ...user, shiny_locked: true } as unknown as User;
    const answer = await runYardAction(em as unknown as EntityManager, locked, yardChampionEvolveAction, {});
    expect(answer.body).toMatchObject({ reason: "shinyLocked" });
  });

  test("rename rejects a malformed body with 400", async () => {
    db.row = rowOf({ champion: [{ t: 1, hp: 40_000, l: 1, ft: getCurrentDateTime() + HOUR, fd: 0, fb: 0, pl: 1, status: 0 }] });
    expect((await run(yardChampionRenameAction, {})).status).toBe(400);
    expect((await run(yardChampionRenameAction, { name: "Kong" })).status).toBe(200);
    expect(championOf(db.row)).toMatchObject({ nm: "Kong" });
  });

  test("stance remembers a champion's Mode on its own entry, Krallen's too (#220)", async () => {
    const now = getCurrentDateTime();
    const gorgo = { t: 1, hp: 40_000, l: 1, ft: now + HOUR, fd: 0, fb: 0, pl: 1, status: 0 };
    const krallen = { t: 5, hp: 50_000, l: 1, ft: now + HOUR, fd: 0, fb: 0, pl: 0, status: 0 };
    db.row = rowOf({ champion: [gorgo, krallen] });

    const answer = await run(yardChampionStanceAction, { type: "5", stance: "defensive" });
    expect(answer.status).toBe(200);
    const champions = db.row!.champion as Row[];
    expect(champions[1]).toMatchObject({ t: 5, s: "defensive" });
    expect(champions[0]!.s).toBeUndefined();

    expect((await run(yardChampionStanceAction, { type: "1", stance: "offensive" })).status).toBe(200);
    expect((db.row!.champion as Row[])[0]).toMatchObject({ t: 1, s: "offensive" });
  });

  test("stance refuses a Mode it does not know, and a champion the player does not keep", async () => {
    db.row = rowOf({ champion: [{ t: 1, hp: 40_000, l: 1, ft: 0, fd: 0, fb: 0, pl: 1, status: 2 }] });
    expect((await run(yardChampionStanceAction, { type: "1", stance: "berserk" })).status).toBe(400);
    const juiced = await run(yardChampionStanceAction, { type: "1", stance: "hybrid" });
    expect(juiced.body).toMatchObject({ reason: "noChampion" });
    expect((await run(yardChampionStanceAction, { type: "3", stance: "hybrid" })).body).toMatchObject({
      reason: "noChampion",
    });
  });

  test("freeze then thaw is a round trip through the chamber", async () => {
    const now = getCurrentDateTime();
    const buildings = { ...(rowOf().buildingdata as Row), "4": { id: 4, t: 119, x: 400, y: 0, l: 1 } };
    const gorgo = { t: 1, hp: 80_000, l: 2, ft: now + 5 * HOUR, fd: 3, fb: 0, pl: 1, status: 0 };
    db.row = rowOf({ buildingdata: buildings, champion: [gorgo] });

    expect((await run(yardChampionFreezeAction)).status).toBe(200);
    expect(championOf(db.row)).toMatchObject({ status: 1, fd: 3 });
    expect(JSON.parse(String((db.row!.buildingdata as Record<string, Row>)["4"]!.fz))).toHaveLength(1);

    const thaw = await run(yardChampionThawAction, { type: "1" });
    expect(thaw.status).toBe(200);
    expect(championOf(db.row)).toMatchObject({ status: 0, fd: 3, l: 2 });
    expect(Number(championOf(db.row).ft)).toBeGreaterThanOrEqual(now + 5 * HOUR);
  });
});

describe("older saves' eggs through the routes (eggs removed, owner 2026-10-28)", () => {
  const egg = (ft: number, t = 2) => ({ t, hp: 12_000, l: 1, ft, fd: 0, fb: 0, pl: 1, status: 3 });

  beforeEach(() => {
    db.row = rowOf();
  });

  test("the next action's catch-up hatches the egg at once, even before its old hatch time", async () => {
    const now = getCurrentDateTime();
    db.row = rowOf({ savetime: now - 10, champion: [egg(now + 20 * HOUR)] });
    const rename = await run(yardChampionRenameAction, { name: "Sparky" });
    expect(rename.status).toBe(200);
    expect((rename.body.completed as Row[]).map((job) => job.kind)).toContain("championHatch");
    expect(championOf(db.row)).toMatchObject({ t: 2, l: 1, hp: 12_000, status: 0, nm: "Sparky" });
    expect(Number(championOf(db.row).ft)).toBeGreaterThanOrEqual(now + 20 * HOUR);
  });

  test("an egg past its hatch time hatches at that time, fed from the hatch", async () => {
    const now = getCurrentDateTime();
    db.row = rowOf({ savetime: now - 2 * HOUR, champion: [egg(now - HOUR)] });
    expect((await run(yardChampionRenameAction, { name: "Sparky" })).status).toBe(200);
    expect(championOf(db.row)).toMatchObject({ status: 0, ft: now + 22 * HOUR });
  });

  test("raising over an old egg finds it hatched: the cage already holds a champion", async () => {
    const now = getCurrentDateTime();
    db.row = rowOf({ champion: [egg(now + HOUR)] });
    const answer = await run(yardChampionRaiseAction, { type: "3" });
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ reason: "championInCage" });
  });

  test("cancel-egg is gone: 410 eggsRemoved, and nothing is written", async () => {
    const now = getCurrentDateTime();
    db.row = rowOf({ champion: [egg(now + HOUR)] });
    const before = structuredClone(db.row);
    const cancel = await run(yardChampionCancelEggAction);
    expect(cancel.status).toBe(410);
    expect(cancel.body).toMatchObject({ reason: "eggsRemoved" });
    expect(db.row).toEqual(before);
  });
});

describe("raising Korath (Inferno WP 5.1, owner I10)", () => {
  const saved = process.env.INFERNO_ENABLED;
  const owner = { userid: 2505, inferno_baseid: "88001", korath_unlocked_at: new Date() };

  beforeEach(() => {
    db.row = rowOf();
    db.progress = null;
    process.env.INFERNO_ENABLED = "on";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.INFERNO_ENABLED;
    else process.env.INFERNO_ENABLED = saved;
  });

  test("is refused before the player owns an Inferno yard, and nothing is written", async () => {
    const before = structuredClone(db.row);
    const answer = await run(yardChampionRaiseAction, { type: "4" });
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ reason: "notRaisable" });
    expect(db.row).toEqual(before);
  });

  test("raises him at the cage once they own one: free, in the cage straight away", async () => {
    db.progress = owner;
    const now = getCurrentDateTime();
    const answer = await run(yardChampionRaiseAction, { type: "4" });
    expect(answer.status).toBe(200);
    expect(championOf(db.row)).toMatchObject({ t: 4, l: 1, hp: 28_000, pl: 0, status: 0 });
    expect(Number(championOf(db.row).ft)).toBeGreaterThanOrEqual(now + 20 * HOUR);
    expect(db.row!.credits).toBe(500);
  });

  test("keeps one basic champion at a time", async () => {
    db.progress = owner;
    db.row = rowOf({ champion: [{ t: 1, hp: 40_000, l: 1, ft: getCurrentDateTime() + HOUR, fd: 0, fb: 0, pl: 1, status: 0 }] });
    const answer = await run(yardChampionRaiseAction, { type: "4" });
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ reason: "championInCage" });
  });

  test("is refused while the new Inferno is switched off, yard or not", async () => {
    db.progress = owner;
    delete process.env.INFERNO_ENABLED;
    const answer = await run(yardChampionRaiseAction, { type: "4" });
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ reason: "notRaisable" });
  });
});
