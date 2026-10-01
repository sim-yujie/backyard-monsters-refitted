import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import { Maproom } from "../../database/models/maproom.model.js";
import type { User } from "../../database/models/user.model.js";
import { costOf } from "../../game-data/buildingCosts.js";
import { stepAmounts } from "../../services/base/economy/resourceBudget.js";
import { PROTECTION_SECONDS } from "../../services/onboarding/guidedStart.js";
import { readOnboarding } from "../../services/onboarding/state.js";
import { onboardingSummary } from "../../services/onboarding/summary.js";
import type { TribeData } from "../../types/TribeData.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { yardBuildAction, yardCancelBuildAction } from "./build.js";
import {
  yardGuideAdvanceAction,
  yardGuideArmyAction,
  yardGuideFinishAction,
  yardGuideSkipAction,
} from "./guideActions.js";
import { runYardAction, type YardAnswer } from "./yardAction.js";

/**
 * The guided start's routes (`docs/design/tutorial.md` §2, §8.3, §8.4; issue
 * #227) through the real yard action wrapper, with the database replaced by
 * one in-memory save row and one `Maproom` row, both written only when the
 * transaction commits.
 */

type Row = Record<string, unknown>;

const db = {
  row: null as Row | null,
  maproom: null as { userid: number; tribedata: TribeData[] } | null,
};

const em = {
  async transactional<T>(cb: (fork: unknown) => Promise<T>): Promise<T> {
    let entity: Row | null = null;
    let maproom: { userid: number; tribedata: TribeData[] } | null = null;
    let maproomRead = false;
    const fork = {
      async findOne(entityClass: unknown) {
        if (entityClass === Maproom) {
          if (!maproomRead) {
            maproom = db.maproom && structuredClone(db.maproom);
            maproomRead = true;
          }
          return maproom;
        }
        entity = db.row && structuredClone(db.row);
        return entity;
      },
      create(_entityClass: unknown, data: { userid: number; tribedata: TribeData[] }) {
        maproom = { ...data };
        maproomRead = true;
        return maproom;
      },
      persist() {},
      async flush() {},
    };
    const result = await cb(fork);
    if (entity) db.row = structuredClone(entity);
    if (maproomRead) db.maproom = maproom && structuredClone(maproom);
    return result;
  },
};

const USERID = 9001;
const user = { userid: USERID, shiny_locked: false, save: { basesaveid: 7 } } as unknown as User;

/** A new account's main yard: a level 1 Town Hall, 1,600 twigs and pebbles, the guide pending. */
const rowOf = (overrides: Row = {}): Row => ({
  basesaveid: 7,
  userid: USERID,
  type: "main",
  attackid: 0,
  attacks: [],
  savetime: getCurrentDateTime(),
  credits: 1500,
  points: "0",
  flinger: 0,
  catapult: 0,
  protected: 0,
  tutorialstage: 0,
  resources: { r1: 1600, r2: 1600, r3: 0, r4: 0 },
  buildingdata: { "1": { id: 1, t: 14, X: -65, Y: -65, l: 1 } },
  buildinghealthdata: {},
  storedata: {},
  monsters: {},
  lockerdata: { C1: { t: 2 } },
  academy: {},
  champion: [],
  mushrooms: { l: [], s: getCurrentDateTime() },
  researchdata: {},
  outposts: [],
  onboarding: { v: 1, guide: { state: "pending" } },
  ...overrides,
});

const call = (action: Parameters<typeof runYardAction>[2], body: Row = {}): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, user, action, body);

const advance = (from: string) => call(yardGuideAdvanceAction, { from });
const build = (type: number, x: number, y: number) => call(yardBuildAction, { type, x, y });
const finish = (id: number) => call(yardGuideFinishAction, { id });
const army = () => call(yardGuideArmyAction);
const skip = () => call(yardGuideSkipAction);

const onboarding = () => readOnboarding(db.row as never);
const step = () => onboarding().guide.step;
const resources = () => db.row!.resources as Record<string, number>;
const buildings = () => db.row!.buildingdata as Record<string, Row>;
const camp = () => db.maproom?.tribedata.find((tribe) => tribe.baseid === "1");

/** Puts the guide at `step`, active, with `extra` merged into the record. */
const at = (stepName: string, extra: Row = {}) => {
  db.row!.onboarding = { v: 1, guide: { state: "active", step: stepName, startedAt: 1 }, ...extra };
};

const costFor = (type: number) => stepAmounts(costOf(type, "main")!.costs[0]!);

/** Builds and finishes `type` at `(x, y)` through the guide: its two steps. */
const buildAndFinish = async (type: number, x: number, y: number): Promise<number> => {
  const built = await build(type, x, y);
  expect(built.status).toBe(200);
  const id = (built.body.report as { id: number }).id;
  expect((await finish(id)).status).toBe(200);
  return id;
};

beforeEach(() => {
  db.row = rowOf();
  db.maproom = null;
});

describe("guide/advance", () => {
  test("welcome starts the guide; a replay of it is refused", async () => {
    const answer = await advance("welcome");
    expect(answer.status).toBe(200);
    expect(onboarding().guide).toMatchObject({ state: "active", step: "collect" });
    expect(answer.body.onboarding).toMatchObject({ guide: { state: "active", step: "collect" } });

    const again = await advance("welcome");
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ reason: "wrongStep", step: "collect" });
  });

  test("a step other than the stored one is refused and writes nothing", async () => {
    at("collect");
    const before = structuredClone(db.row);
    const answer = await advance("raid");
    expect(answer.body).toMatchObject({ reason: "wrongStep", step: "collect", asked: "raid" });
    expect(db.row!.onboarding).toEqual(before!.onboarding);
  });

  test("a grant step cannot be skipped past with advance", async () => {
    at("build-sniper");
    expect((await advance("build-sniper")).body).toMatchObject({ reason: "wrongStep" });
    at("pokeys");
    expect((await advance("pokeys")).body).toMatchObject({ reason: "wrongStep" });
  });

  test("the raid needs a finished Sniper Tower, then sets raidSeen", async () => {
    at("raid");
    expect((await advance("raid")).body).toMatchObject({ reason: "notYet" });
    buildings()["2"] = { id: 2, t: 21, X: 300, Y: -300 };
    expect((await advance("raid")).status).toBe(200);
    expect(onboarding().raidSeen).toBeGreaterThan(0);
    expect(step()).toBe("build-housing");
  });

  test("a legacy account has no guide to advance", async () => {
    db.row!.onboarding = null;
    expect((await advance("welcome")).body).toMatchObject({ reason: "guideClosed" });
  });
});

describe("the guided build (/bm/yard/build at a build step)", () => {
  test("tops up the Sniper Tower: debits min(held, cost), records the shortfall and the id", async () => {
    at("build-sniper");
    const cost = costFor(21);
    const answer = await build(21, 300, -300);

    expect(answer.status).toBe(200);
    const id = (answer.body.report as { id: number }).id;
    expect(buildings()[String(id)]).toMatchObject({ t: 21, X: 300, Y: -300 });
    expect(Number(buildings()[String(id)]!.cB)).toBeGreaterThan(0);
    expect(resources()).toMatchObject({
      r1: 1600 - Math.min(1600, cost.r1),
      r2: 1600 - Math.min(1600, cost.r2),
      r3: 0,
      r4: 0,
    });
    expect(onboarding().grants["fund:21"]).toMatchObject({
      r1: Math.max(0, cost.r1 - 1600),
      r2: Math.max(0, cost.r2 - 1600),
      r3: cost.r3,
      r4: cost.r4,
      id,
    });
    expect(step()).toBe("finish-sniper");
    // The summary points at it after a reload.
    expect(onboardingSummary(db.row as never).guide.building).toBe(id);
  });

  test("a player holding more than the cost pays the full cost: the guide gives nothing", async () => {
    at("build-sniper");
    db.row!.resources = { r1: 50000, r2: 50000, r3: 50000, r4: 0 };
    const cost = costFor(21);
    await build(21, 300, -300);
    expect(resources()).toMatchObject({ r1: 50000 - cost.r1, r2: 50000 - cost.r2, r3: 50000 - cost.r3 });
    expect(onboarding().grants["fund:21"]).toMatchObject({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });

  test("only the step's type is paid for; another type is an ordinary build", async () => {
    at("build-sniper");
    const answer = await build(15, 300, -300);
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ reason: "shortfall" });
    expect(onboarding().grants).toEqual({});
  });

  test("outside the guide the build is ordinary: a shortfall is refused", async () => {
    db.row!.onboarding = { v: 1, guide: { state: "skipped" } };
    expect((await build(21, 300, -300)).body).toMatchObject({ reason: "shortfall" });
  });

  test("a placement refusal writes no grant", async () => {
    at("build-sniper");
    const answer = await build(21, -65, -65);
    expect(answer.body).toMatchObject({ reason: "placement" });
    expect(onboarding().grants).toEqual({});
    expect(step()).toBe("build-sniper");
  });

  test("a building the guide paid for cannot be cancelled while it runs", async () => {
    at("build-sniper");
    const id = ((await build(21, 300, -300)).body.report as { id: number }).id;
    const answer = await call(yardCancelBuildAction, { id });
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ reason: "guideBuilding" });
    expect(buildings()[String(id)]).toBeDefined();
  });
});

describe("guide/finish", () => {
  test("finishes the recorded building free, once, and moves on", async () => {
    at("build-sniper");
    const id = ((await build(21, 300, -300)).body.report as { id: number }).id;
    const credits = db.row!.credits;

    expect((await finish(999)).body).toMatchObject({ reason: "notGuideBuilding" });
    const answer = await finish(id);
    expect(answer.status).toBe(200);
    expect(answer.body.report).toMatchObject({ id, t: 21, finished: true, step: "raid" });
    expect(buildings()[String(id)]!.cB).toBeUndefined();
    expect(db.row!.credits).toBe(credits);
    expect(Number(db.row!.points)).toBeGreaterThan(0);
    expect(onboarding().grants["finish:21"]).toMatchObject({ id });
    expect(step()).toBe("raid");

    expect((await finish(id)).body).toMatchObject({ reason: "wrongStep" });
  });

  test("the Map Room's level 1 construction is finished free: the one-off exception to D16", async () => {
    at("build-maproom");
    const id = ((await build(11, 300, -300)).body.report as { id: number }).id;
    expect(Number(buildings()[String(id)]!.cB)).toBeGreaterThan(0);
    const answer = await finish(id);
    expect(answer.status).toBe(200);
    expect(buildings()[String(id)]!.cB).toBeUndefined();
    expect(step()).toBe("build-flinger");
  });

  test("is refused before the build, and on a building the guide did not pay for", async () => {
    at("finish-sniper");
    buildings()["5"] = { id: 5, t: 21, X: 300, Y: -300, cB: 60, cL: 60 };
    expect((await finish(5)).body).toMatchObject({ reason: "notGuideBuilding" });
  });

  test("the Flinger's finish opens the practice camp", async () => {
    at("build-flinger");
    await buildAndFinish(5, 300, -300);
    expect(step()).toBe("open-map");
    expect(onboarding().camp.state).toBe("open");
    expect(camp()).toEqual({ baseid: "1", tribeHealthData: {} });
  });
});

describe("guide/army", () => {
  /** A finished Housing, so the catch-up's overflow cull leaves the army alone. */
  const housing = (level = 1) => {
    buildings()["9"] = { id: 9, t: 15, X: 300, Y: 100, l: level };
  };

  test("tops housed Pokeys up to 15 at the pokeys step, once", async () => {
    at("pokeys");
    housing(5);
    db.row!.monsters = { housed: { C1: 4, C2: 3 } };
    const answer = await army();
    expect(answer.body.report).toMatchObject({ added: 11, housed: 15, retry: false, step: "build-maproom" });
    expect((db.row!.monsters as Row).housed).toEqual({ C1: 15, C2: 3 });
    expect(onboarding().grants.army).toHaveLength(1);

    const again = await army();
    expect(again.status).toBe(409);
    expect((db.row!.monsters as Row).housed).toEqual({ C1: 15, C2: 3 });
  });

  test("never adds above 15", async () => {
    at("pokeys");
    housing(5);
    db.row!.monsters = { housed: { C1: 40 } };
    expect((await army()).body.report).toMatchObject({ added: 0, housed: 40 });
  });

  test("is refused at any other step", async () => {
    at("build-housing");
    expect((await army()).body).toMatchObject({ reason: "wrongStep" });
  });
});

describe("the practice attack and the free retry", () => {
  const openCamp = async () => {
    at("build-flinger");
    await buildAndFinish(5, 300, -300);
    expect((await advance("open-map")).status).toBe(200);
    expect((await advance("pick-camp")).status).toBe(200);
    expect(step()).toBe("attack");
  };

  test("a loss leads to the retry: Pokeys back to 15, the camp's health reset, its loot kept", async () => {
    await openCamp();
    buildings()["9"] = { id: 9, t: 15, X: 300, Y: 100, l: 1 };
    db.row!.monsters = { housed: { C1: 2 } };
    db.maproom!.tribedata = [
      { baseid: "1", tribeHealthData: { "1": 200 }, damage: 40, looted: { r1: 500 } },
    ];

    expect((await advance("attack")).status).toBe(200);
    expect(step()).toBe("attack-result");
    expect(onboarding().camp.state).toBe("open");

    const answer = await army();
    expect(answer.body.report).toMatchObject({ added: 13, housed: 15, retry: true, step: "pick-camp" });
    expect(camp()).toEqual({ baseid: "1", tribeHealthData: {}, looted: { r1: 500 } });
  });

  test("a win removes the camp and moves to Goals", async () => {
    await openCamp();
    db.maproom!.tribedata = [{ baseid: "1", tribeHealthData: {}, destroyed: 1, damage: 100 }];
    expect((await advance("attack")).status).toBe(200);
    expect(step()).toBe("home-goals");
    expect(onboarding().camp.state).toBe("removed");
    expect(camp()).toBeUndefined();
  });

  test("a win after the loss screen, without the retry, also counts", async () => {
    await openCamp();
    await advance("attack");
    db.maproom!.tribedata = [{ baseid: "1", tribeHealthData: {}, destroyed: 1 }];
    expect((await advance("attack-result")).status).toBe(200);
    expect(step()).toBe("home-goals");
  });

  test("no retry once the camp is beaten", async () => {
    await openCamp();
    await advance("attack");
    db.maproom!.tribedata = [{ baseid: "1", tribeHealthData: {}, destroyed: 1 }];
    expect((await army()).body).toMatchObject({ reason: "notYet" });
  });
});

describe("the end, and skipping", () => {
  test("the last steps end the guide with seven days of protection and stage 205", async () => {
    at("home-goals");
    await advance("home-goals");
    await advance("finish-now");
    const now = getCurrentDateTime();
    expect((await advance("protection")).status).toBe(200);
    expect(onboarding().guide.state).toBe("done");
    expect(Number(db.row!.protected)).toBeGreaterThanOrEqual(now + PROTECTION_SECONDS);
    expect(db.row!.tutorialstage).toBe(205);
  });

  test("protection already longer is kept", async () => {
    at("protection");
    const far = getCurrentDateTime() + 30 * 24 * 3600;
    db.row!.protected = far;
    await advance("protection");
    expect(db.row!.protected).toBe(far);
  });

  test("skip is final: protection, the camp goes, every guide route refuses after", async () => {
    await (async () => {
      at("build-flinger");
      await buildAndFinish(5, 300, -300);
    })();
    const now = getCurrentDateTime();
    const answer = await skip();
    expect(answer.status).toBe(200);
    expect(onboarding().guide.state).toBe("skipped");
    expect(onboarding().camp.state).toBe("removed");
    expect(camp()).toBeUndefined();
    expect(Number(db.row!.protected)).toBeGreaterThanOrEqual(now + PROTECTION_SECONDS);
    expect(db.row!.tutorialstage).toBe(205);

    for (const again of [skip(), advance("open-map"), army(), finish(2)]) {
      expect((await again).body).toMatchObject({ reason: "guideClosed" });
    }
  });

  test("a pending guide can be skipped before it starts", async () => {
    expect((await skip()).status).toBe(200);
    expect(onboarding().guide.state).toBe("skipped");
  });
});

describe("the whole guided start", () => {
  test("runs from welcome to done on a new account's resources", async () => {
    const steps: string[] = [];
    const go = async (answer: Promise<YardAnswer>) => {
      const result = await answer;
      expect(result.body.error).toBe(0);
      steps.push(step() ?? onboarding().guide.state);
    };
    await go(advance("welcome"));
    await go(advance("collect"));
    const sniper = ((await build(21, 300, -300)).body.report as { id: number }).id;
    await go(finish(sniper));
    await go(advance("raid"));
    const housing = ((await build(15, 300, 100)).body.report as { id: number }).id;
    await go(finish(housing));
    await go(army());
    expect((db.row!.monsters as Row).housed).toEqual({ C1: 15 });
    const mapRoom = ((await build(11, -300, -300)).body.report as { id: number }).id;
    await go(finish(mapRoom));
    const flinger = ((await build(5, -300, 200)).body.report as { id: number }).id;
    await go(finish(flinger));
    await go(advance("open-map"));
    await go(advance("pick-camp"));
    db.maproom!.tribedata = db.maproom!.tribedata.map((tribe) =>
      tribe.baseid === "1" ? { ...tribe, destroyed: 1 } : tribe
    );
    await go(advance("attack"));
    await go(advance("home-goals"));
    await go(advance("finish-now"));
    await go(advance("protection"));

    expect(steps).toEqual([
      "collect",
      "build-sniper",
      "raid",
      "build-housing",
      "pokeys",
      "build-maproom",
      "build-flinger",
      "open-map",
      "pick-camp",
      "attack",
      "home-goals",
      "finish-now",
      "protection",
      "done",
    ]);
    // Every resource the guide covered is a ledger entry, nothing was handed over.
    for (const type of [21, 15, 11, 5]) {
      expect(onboarding().grants[`fund:${type}`]).toBeDefined();
      expect(onboarding().grants[`finish:${type}`]).toBeDefined();
    }
    for (const key of ["r1", "r2", "r3", "r4"]) expect(resources()[key]).toBeGreaterThanOrEqual(0);
    // One level 1 Housing holds the 15 Pokeys through every later catch-up (no overflow cull).
    expect((db.row!.monsters as Row).housed).toEqual({ C1: 15 });
  });
});
