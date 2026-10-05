import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { devConfig, guidedStartOn } from "../../config/GameConfig.js";
import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { getDefaultBaseData } from "../../game-data/getDefaultBaseData.js";
import { FilterFrontendKeys } from "../../utils/FrontendKey.js";
import { POOL_FIELDS } from "../yard/poolView.js";
import {
  emptyCounters,
  guideOpen,
  LEGACY_ONBOARDING_JSON,
  NEW_ONBOARDING_JSON,
  readOnboarding,
  updateOnboarding,
} from "./state.js";

/** `save.onboarding`, the tutorial's server-only record (issue #227, `docs/design/tutorial.md` §8). */

describe("readOnboarding", () => {
  test("a NULL column is a legacy save: no guide, the raid seen, the Goals baseline pending", () => {
    for (const onboarding of [null, undefined, "nonsense", [1, 2]]) {
      expect(readOnboarding({ onboarding })).toEqual({
        v: 1,
        guide: { state: "legacy" },
        grants: {},
        raidSeen: 1,
        camp: { state: "none" },
        goals: {},
        goalsBaseline: "pending",
        counters: emptyCounters(),
        tips: {},
      });
    }
  });

  test("a new account's record reads as pending, with nothing granted", () => {
    const onboarding = readOnboarding({ onboarding: structuredClone(NEW_ONBOARDING_JSON) });

    expect(onboarding.guide).toEqual({ state: "pending" });
    expect(onboarding.grants).toEqual({});
    expect(onboarding.raidSeen).toBeUndefined();
    expect(onboarding.goalsBaseline).toBeUndefined();
    expect(guideOpen(onboarding)).toBe(true);
  });

  test("keeps every stored field and drops what it cannot read", () => {
    const stored = {
      v: 1,
      guide: { state: "active", step: "build-housing", startedAt: 100, endedAt: "x" },
      grants: {
        "fund:21": { r1: 0, r2: 400, r3: 500, r4: 0, id: 7, at: 160 },
        army: [{ added: 15, at: 200 }],
      },
      raidSeen: 110,
      camp: { state: "open", openedAt: 400 },
      goals: { T1: { done: 75, claimed: 700 }, U1: { claimed: "baseline" }, bad: 3 },
      goalsBaseline: 90,
      counters: { mushrooms: 4, bestBank: 200.7, juiced: -3, baiterRuns: 2, raidsSurvived: 1, tribes: { kozu: 1 } },
      tips: { mail: 3000, shop: "no" },
    };
    const onboarding = readOnboarding({ onboarding: stored });

    expect(onboarding).toEqual({
      v: 1,
      guide: { state: "active", step: "build-housing", startedAt: 100 },
      grants: stored.grants,
      raidSeen: 110,
      camp: { state: "open", openedAt: 400 },
      goals: { T1: { done: 75, claimed: 700 }, U1: { claimed: "baseline" } },
      goalsBaseline: 90,
      counters: {
        mushrooms: 4,
        goldMushrooms: 0,
        bestBank: 200,
        juiced: 0,
        baiterRuns: 2,
        raidsSurvived: 1,
        tribes: { legionnaire: 0, kozu: 1, abunakki: 0, dreadnaut: 0 },
      },
      tips: { mail: 3000 },
    });
    // A copy: editing it never reaches the stored record.
    onboarding.grants["fund:21"] = { at: 1 };
    expect(stored.grants["fund:21"].id).toBe(7);
  });

  test("an unknown guide state reads as legacy, so a broken record never reopens the guide", () => {
    const onboarding = readOnboarding({ onboarding: { v: 1, guide: { state: "dancing" } } });
    expect(onboarding.guide.state).toBe("legacy");
    expect(guideOpen(onboarding)).toBe(false);
  });
});

describe("updateOnboarding", () => {
  test("changes only what the change touches", () => {
    const save = {
      onboarding: { v: 1, guide: { state: "active", step: "raid" }, tips: { mail: 5 }, counters: { juiced: 3 } },
    };
    const next = updateOnboarding(save, (onboarding) => {
      onboarding.counters.mushrooms += 1;
    });

    expect(next.guide).toEqual({ state: "active", step: "raid" });
    expect(next.tips).toEqual({ mail: 5 });
    expect(next.counters.juiced).toBe(3);
    expect(next.counters.mushrooms).toBe(1);
    // The save itself is not written: the caller returns the result as a slice.
    expect((save.onboarding as { counters: { mushrooms?: number } }).counters.mushrooms).toBeUndefined();
  });
});

describe("the column", () => {
  test("the client can never write it, and no load sends it as it is", () => {
    expect(Save.saveKeys).not.toContain("onboarding");
    expect(Save.attackSaveKeys).not.toContain("onboarding");

    const save = new Save();
    save.onboarding = { v: 1, guide: { state: "active" } };
    expect("onboarding" in FilterFrontendKeys(save)).toBe(false);
  });

  test("an outpost's yard action reads and writes it on the main row", () => {
    expect(POOL_FIELDS.has("onboarding")).toBe(true);
  });

  test("the migration writes exactly the legacy record", () => {
    const migration = readFileSync(
      path.join(import.meta.dirname, "../../database/migrations/20261002_AddOnboardingToSave.ts"),
      "utf8"
    );
    const literal = /SET "onboarding" = '([^']+)'/.exec(migration)?.[1];

    expect(literal).toBeDefined();
    expect(JSON.parse(literal!)).toEqual(LEGACY_ONBOARDING_JSON);
    expect(migration).toContain(`WHERE "type" = 'main' AND "onboarding" IS NULL`);
  });
});

describe("new saves", () => {
  const user = { userid: 3, username: "zz_newbie", sandbox_start: false } as unknown as User;

  test("a new main yard starts the guided start while the switch is on; other yards hold nothing", () => {
    const was = devConfig.guidedStart;
    try {
      devConfig.guidedStart = true;
      expect(getDefaultBaseData(user, BaseType.MAIN)).toMatchObject({ onboarding: NEW_ONBOARDING_JSON });
      expect(getDefaultBaseData(user, BaseType.OUTPOST)).not.toHaveProperty("onboarding");

      devConfig.guidedStart = false;
      expect(getDefaultBaseData(user, BaseType.MAIN)).not.toHaveProperty("onboarding");
    } finally {
      devConfig.guidedStart = was;
    }
  });

  test("the switch: GUIDED_START wins, and unset it is off only in production", () => {
    expect(guidedStartOn({})).toBe(true);
    expect(guidedStartOn({ ENV: "production" })).toBe(false);
    expect(guidedStartOn({ ENV: "production", GUIDED_START: "1" })).toBe(true);
    expect(guidedStartOn({ GUIDED_START: "0" })).toBe(false);
  });
});
