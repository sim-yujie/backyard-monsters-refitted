import { describe, expect, test } from "bun:test";

import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import { maxHp } from "../../game-rules/combat/stats.js";
import {
  EMERGENCE_GAP_SECONDS,
  caveShown,
  emergenceDueCheck,
  emergencePausesWildRaids,
  emergenceRaidSkipped,
  nextEmergenceAt,
  yardHealthShare,
  type EmergenceFacts,
} from "./emergence.js";
import { NO_INFERNO_PROGRESS } from "./infernoProgress.js";

/**
 * The emergence's due rule, one test per gate (`docs/design/inferno.md` §2.2,
 * Flash's rules, owner I14), and the pause it puts on wild monster raids.
 */

const NOW = 1_800_000_000;
const HOUR = 60 * 60;

/** A Town Hall at `level` and a silo, both at full health unless told. */
const yardOf = (level: number): BuildingDataMap => ({
  "1": { id: 1, t: 14, l: level, x: 0, y: 0 } as BuildingData,
  "2": { id: 2, t: 6, l: 1, x: 100, y: 0 } as BuildingData,
});
const HALL_MAX = maxHp(14, 5);
const SILO_MAX = maxHp(6, 1);

const facts = (extra: Partial<EmergenceFacts> = {}, save: Partial<EmergenceFacts["save"]> = {}): EmergenceFacts => ({
  enabled: true,
  save: { type: "main", buildingdata: yardOf(5), buildinghealthdata: {}, tutorialstage: 205, ...save },
  progress: NO_INFERNO_PROGRESS,
  now: NOW,
  underAttack: false,
  raidOpen: false,
  skipTutorial: false,
  ...extra,
});

describe("the emergence due rule", () => {
  test("a Town Hall 5 yard with no raid yet is due at once (the first has no wait)", () => {
    expect(emergenceDueCheck(facts())).toBeNull();
  });

  test("off: the new Inferno is switched off", () => {
    expect(emergenceDueCheck(facts({ enabled: false }))).toBe("off");
  });

  test("notMainYard: an outpost or an Inferno yard never", () => {
    expect(emergenceDueCheck(facts({}, { type: "outpost" }))).toBe("notMainYard");
    expect(emergenceDueCheck(facts({}, { type: "inferno" }))).toBe("notMainYard");
  });

  test("noCave: below Town Hall 5", () => {
    expect(emergenceDueCheck(facts({}, { buildingdata: yardOf(4) }))).toBe("noCave");
  });

  test("noCave: the tutorial not over (Flash: stage above 200)", () => {
    expect(emergenceDueCheck(facts({}, { tutorialstage: 200 }))).toBe("noCave");
    expect(emergenceDueCheck(facts({}, { tutorialstage: 201 }))).toBeNull();
  });

  test("done: all five raids done", () => {
    const progress = { ...NO_INFERNO_PROGRESS, emergenceLevel: 5, emergenceLastAt: NOW - 30 * 24 * HOUR };
    expect(emergenceDueCheck(facts({ progress }))).toBe("done");
  });

  test("tooSoon: 12 hours from the last level-up, to the second", () => {
    const progress = { ...NO_INFERNO_PROGRESS, emergenceLevel: 2, emergenceLastAt: NOW - EMERGENCE_GAP_SECONDS + 1 };
    expect(emergenceDueCheck(facts({ progress }))).toBe("tooSoon");
    expect(emergenceDueCheck(facts({ progress: { ...progress, emergenceLastAt: NOW - EMERGENCE_GAP_SECONDS } }))).toBeNull();
    expect(EMERGENCE_GAP_SECONDS).toBe(12 * HOUR);
  });

  test("underAttack: an attack running on the yard", () => {
    expect(emergenceDueCheck(facts({ underAttack: true }))).toBe("underAttack");
  });

  test("raidOpen: a wild monster raid already open", () => {
    expect(emergenceDueCheck(facts({ raidOpen: true }))).toBe("raidOpen");
  });

  test("damaged: from the second raid, the yard at 10% of its health or less; a damaged yard above it still is raided (not our wild-raid rule)", () => {
    const second = { ...NO_INFERNO_PROGRESS, emergenceLevel: 1, emergenceLastAt: NOW - EMERGENCE_GAP_SECONDS };
    const at = (share: number) => {
      // The silo is whole; the hall carries the damage.
      const hall = Math.floor(share * (HALL_MAX + SILO_MAX)) - SILO_MAX;
      return facts({ progress: second }, { buildinghealthdata: { "1": Math.max(0, hall) } });
    };
    expect(emergenceDueCheck(facts({ progress: second }, { buildinghealthdata: { "1": 0, "2": 0 } }))).toBe("damaged");
    expect(emergenceDueCheck(at(0.5))).toBeNull();
    const tenth = facts({ progress: second }, { buildinghealthdata: { "1": 0, "2": Math.floor(0.1 * (HALL_MAX + SILO_MAX)) } });
    expect(yardHealthShare(tenth.save)).toBeLessThanOrEqual(0.1);
    expect(emergenceRaidSkipped(tenth.save)).toBe(true);
    expect(emergenceDueCheck(tenth)).toBe("damaged");
  });

  test("the first raise has no health gate (Flash SetupPortal :91-95): the cave goes up, only its raid is skipped", () => {
    const wrecked = facts({}, { buildinghealthdata: { "1": 0, "2": 0 } });
    expect(emergenceDueCheck(wrecked)).toBeNull();
    expect(emergenceRaidSkipped(wrecked.save)).toBe(true);
    expect(emergenceRaidSkipped(facts().save)).toBe(false);
  });

  test("the gates are checked in order: the first that holds is told", () => {
    expect(emergenceDueCheck(facts({ enabled: false, underAttack: true }, { type: "outpost" }))).toBe("off");
    expect(emergenceDueCheck(facts({ underAttack: true, raidOpen: true }))).toBe("underAttack");
  });
});

describe("the yard's health share", () => {
  test("whole: 1; buildings with no health ladder are left out", () => {
    expect(yardHealthShare({ buildingdata: yardOf(5) })).toBe(1);
    const withDecor = { ...yardOf(5), "9": { id: 9, t: 999, l: 1, x: 0, y: 0 } as BuildingData };
    expect(yardHealthShare({ buildingdata: withDecor })).toBe(1);
  });

  test("health from buildinghealthdata first, then hp", () => {
    const data = yardOf(5);
    data["2"] = { ...data["2"]!, hp: 0 } as BuildingData;
    expect(yardHealthShare({ buildingdata: data })).toBeCloseTo(HALL_MAX / (HALL_MAX + SILO_MAX));
    expect(yardHealthShare({ buildingdata: data, buildinghealthdata: { "2": SILO_MAX } })).toBe(1);
  });

  test("an empty yard reads 0, as Flash's 0/0 never passed", () => {
    expect(yardHealthShare({ buildingdata: {} })).toBe(0);
  });
});

describe("the cave", () => {
  test("reads the hall from the buildings or the thlevel column", () => {
    expect(caveShown({ thlevel: 5, tutorialstage: 205 }, NO_INFERNO_PROGRESS, false)).toBe(true);
    expect(caveShown({ thlevel: 4, tutorialstage: 205 }, NO_INFERNO_PROGRESS, false)).toBe(false);
    expect(caveShown({ buildingdata: yardOf(6), thlevel: 0, tutorialstage: 205 }, NO_INFERNO_PROGRESS, false)).toBe(true);
  });

  test("the next level-up: any time at first, then 12 hours after the last, none after the fifth", () => {
    expect(nextEmergenceAt(NO_INFERNO_PROGRESS)).toBe(0);
    expect(nextEmergenceAt({ emergenceLevel: 1, emergenceLastAt: NOW })).toBe(NOW + 12 * HOUR);
    expect(nextEmergenceAt({ emergenceLevel: 5, emergenceLastAt: NOW })).toBeNull();
  });
});

describe("the pause on wild monster raids", () => {
  const main = { type: "main", thlevel: 5, tutorialstage: 205 };

  test("from Town Hall 5 until the fifth raid, wild raids wait (Flash: ShouldRunEvent)", () => {
    for (const level of [0, 1, 4]) {
      expect(emergencePausesWildRaids(true, main, { emergenceLevel: level }, false)).toBe(true);
    }
  });

  test("after the fifth raid they come again", () => {
    expect(emergencePausesWildRaids(true, main, { emergenceLevel: 5 }, false)).toBe(false);
  });

  test("never below Town Hall 5, before the tutorial is over, off the main yard, or with the Inferno off", () => {
    expect(emergencePausesWildRaids(true, { ...main, thlevel: 4 }, { emergenceLevel: 0 }, false)).toBe(false);
    expect(emergencePausesWildRaids(true, { ...main, tutorialstage: 100 }, { emergenceLevel: 0 }, false)).toBe(false);
    expect(emergencePausesWildRaids(true, { ...main, type: "outpost" }, { emergenceLevel: 0 }, false)).toBe(false);
    expect(emergencePausesWildRaids(false, main, { emergenceLevel: 0 }, false)).toBe(false);
  });
});
