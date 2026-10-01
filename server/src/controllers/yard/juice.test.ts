import { beforeEach, describe, expect, test } from "bun:test";
import { readOnboarding } from "../../services/onboarding/state.js";
import type { EntityManager } from "@mikro-orm/core";
import type { User } from "../../database/models/user.model.js";
import { juiceGoo, juicerRate, juicerStatus } from "../../services/yard/juice.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { yardJuiceAction } from "./juice.js";
import { runYardAction, type YardAnswer } from "./yardAction.js";

/**
 * `POST /bm/yard/juice` through the real wrapper, the database replaced by one
 * in-memory row written only when a transaction commits (as `bank.test.ts`).
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

/** Town Hall, two level 1 Housing (400 space), no silos (cap 10,000). */
const BASE_BUILDINGS: Row = {
  "0": { id: 0, t: 14, x: 0, y: 0, l: 3 },
  "1": { id: 1, t: 15, x: 0, y: 200, l: 1 },
  "2": { id: 2, t: 15, x: 200, y: 200, l: 1 },
};

/** Saved just now: a level 1 Juicer, 30 Pokey and 5 Octo-ooze (350 space). */
const rowOf = (overrides: Row = {}): Row => ({
  basesaveid: 7,
  userid: 2505,
  type: "main",
  attackid: 0,
  attacks: [],
  savetime: getCurrentDateTime(),
  credits: 0,
  points: "100",
  tutorialstage: 0,
  flinger: 0,
  catapult: 0,
  resources: { r1: 0, r2: 0, r3: 0, r4: 1000 },
  buildingdata: { ...BASE_BUILDINGS, "5": { id: 5, t: 9, x: 100, y: 0, l: 1 } },
  buildinghealthdata: {},
  storedata: {},
  monsters: { housed: { C1: 30, C2: 5 }, saved: getCurrentDateTime() },
  lockerdata: {},
  academy: {},
  champion: [],
  mushrooms: {},
  researchdata: {},
  outposts: [],
  ...overrides,
});

const juice = (monsters: Record<string, number> | string): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, user, yardJuiceAction, {
    monsters: typeof monsters === "string" ? monsters : JSON.stringify(monsters),
  });

const juicerAt = (building: Row, health?: number): Row => ({
  buildingdata: { ...BASE_BUILDINGS, "5": { id: 5, t: 9, x: 100, y: 0, ...building } },
  buildinghealthdata: health === undefined ? {} : { "5": health },
});

describe("juice rate", () => {
  test("60%, 80%, 100% by Juicer level (BUILDING9.as:56-62)", () => {
    expect([1, 2, 3].map(juicerRate)).toEqual([0.6, 0.8, 1]);
    expect(juicerRate(0)).toBe(0.6);
    expect(juicerRate(9)).toBe(1);
  });

  test("ceil(cResource × rate) per monster, at its academy level", () => {
    // Pokey: 250 goo at level 1, 450 at level 2.
    expect(juiceGoo("C1", 3, {}, 0.6)).toBe(450);
    expect(juiceGoo("C1", 3, { C1: 2 }, 0.6)).toBe(810);
    // Rounded up per monster, not on the total: 675 × 0.6 = 405, 675 × 0.8 = 540.
    expect(juiceGoo("C1", 1, { C1: 3 }, 0.8)).toBe(540);
    expect(juiceGoo("C2", 2, {}, 1)).toBe(1000);
  });

  test("a Juicer at half health or below does not work; above half it does", () => {
    // Level 1 Juicer: 16,000 health.
    expect(juicerStatus(juicerAt({ l: 1 }, 8000) as never).problem).toBe("damaged");
    expect(juicerStatus(juicerAt({ l: 1 }, 8001) as never).juicer).toMatchObject({ id: 5, rate: 0.6 });
    expect(juicerStatus({ buildingdata: {} }).problem).toBe("noJuicer");
  });
});

describe("POST /bm/yard/juice", () => {
  beforeEach(() => {
    db.row = rowOf();
  });

  test("juices housed monsters for goo and takes them out of housing", async () => {
    const answer = await juice({ C1: 10, C2: 5 });
    expect(answer.status).toBe(200);
    // 10 × ceil(250 × 0.6) + 5 × ceil(500 × 0.6) = 1500 + 1500.
    expect(answer.body.report).toEqual({ juiced: { C1: 10, C2: 5 }, goo: 3000, lost: 0, rate: 0.6 });
    const row = db.row!;
    expect(row.resources).toMatchObject({ r4: 4000 });
    expect((row.monsters as Row).housed).toEqual({ C1: 20 });
    // Goals BL1-BL4 (#227) count every monster juiced.
    expect(readOnboarding({ onboarding: row.onboarding }).counters.juiced).toBe(15);
  });

  test("a level 3 Juicer returns the whole hatch cost", async () => {
    db.row = rowOf(juicerAt({ l: 3 }));
    const answer = await juice({ C2: 2 });
    expect(answer.status).toBe(200);
    expect(answer.body.report).toMatchObject({ goo: 1000, rate: 1 });
  });

  test("the goo cap swallows what does not fit, and the report says how much", async () => {
    db.row = rowOf({ resources: { r1: 0, r2: 0, r3: 0, r4: 9000 } });
    const answer = await juice({ C1: 30 });
    expect(answer.status).toBe(200);
    // 30 × 150 = 4500; only 1000 fits under the 10,000 cap.
    expect(answer.body.report).toMatchObject({ goo: 1000, lost: 3500 });
    expect(db.row!.resources).toMatchObject({ r4: 10000 });
    expect((db.row!.monsters as Row).housed).toEqual({ C2: 5 });
  });

  test("the Juicer's refusals, and nothing is written", async () => {
    const cases: [Row, number, string][] = [
      [{ buildingdata: BASE_BUILDINGS }, 409, "noJuicer"],
      [juicerAt({ l: 0, cB: 300 }), 409, "busy"],
      [juicerAt({ l: 1, cU: 300 }), 409, "busy"],
      [juicerAt({ l: 1 }, 8000), 409, "damaged"],
    ];
    for (const [overrides, status, reason] of cases) {
      db.row = rowOf(overrides);
      const before = structuredClone(db.row);
      const answer = await juice({ C1: 1 });
      expect(answer.status).toBe(status);
      expect(answer.body.reason).toBe(reason);
      expect(db.row).toEqual(before);
    }
  });

  test("more than housing holds is refused with the figures", async () => {
    const answer = await juice({ C2: 6 });
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ reason: "notEnough", monster: "C2", have: 5, need: 6 });
  });

  test("Inferno monsters and unknown ids are refused", async () => {
    const inferno = await juice({ IC1: 1 });
    expect(inferno.status).toBe(409);
    expect(inferno.body.reason).toBe("inferno");
    for (const body of [{ G1: 1 }, { C99: 1 }, { nope: 1 }] as Record<string, number>[]) {
      const answer = await juice(body);
      expect(answer.status).toBe(400);
      expect(answer.body.reason).toBe("badRequest");
    }
  });

  test("the body must be a JSON object of whole counts of 1 or more", async () => {
    for (const body of ["nope", "{}", "[1]", '{"C1":0}', '{"C1":1.5}', '{"C1":"2"}']) {
      const answer = await juice(body);
      expect(answer.status).toBe(400);
      expect(answer.body.reason).toBe("badRequest");
    }
  });

  test("a Map Room 3 monsters blob is refused", async () => {
    db.row = rowOf({ monsters: { C1: [{ id: 1 }] } });
    const answer = await juice({ C1: 1 });
    expect(answer.status).toBe(409);
    expect(answer.body.reason).toBe("mapRoom3");
  });
});
