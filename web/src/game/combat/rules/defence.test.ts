import { describe, expect, it } from "vitest";

import {
  academyLevels,
  battleDefence,
  cagedChampion,
  defenderForcesOf,
  NO_DEFENCE,
  parseDefenderForces,
} from "./defence.js";

/** The one picker every caller reads a yard's defence with (issue #195). */

describe("academyLevels", () => {
  it("reads each monster's level, whole and at least 1, and drops the rest", () => {
    expect(
      academyLevels({ C1: { level: 4 }, C2: { level: 2.7 }, C3: { level: 0 }, C4: {}, C5: "x" }),
    ).toEqual({ C1: 4, C2: 2 });
    expect(academyLevels(null)).toEqual({});
  });
});

describe("cagedChampion", () => {
  const gorgo = { t: 1, l: 3, hp: 5000, pl: 2, status: 0, fd: 0, ft: 0, fb: 0 };

  it("is the first champion at home with health left, Krallen included", () => {
    expect(cagedChampion([gorgo])).toEqual({ t: 1, l: 3, hp: 5000, pl: 2 });
    expect(cagedChampion([{ ...gorgo, status: 1 }, { ...gorgo, t: 5, l: 2 }])).toEqual({
      t: 5,
      l: 2,
      hp: 5000,
      pl: 2,
    });
    expect(cagedChampion([{ ...gorgo, hp: 0 }, { ...gorgo, t: 3 }])?.t).toBe(3);
  });

  it("is null for none at home, an unknown type, or no list", () => {
    expect(cagedChampion([{ ...gorgo, status: 2 }])).toBeNull();
    expect(cagedChampion([{ ...gorgo, t: 99 }])).toBeNull();
    expect(cagedChampion(undefined)).toBeNull();
    expect(cagedChampion([])).toBeNull();
  });

  it("clamps the power level to 0..3, and reads none as 0", () => {
    expect(cagedChampion([{ ...gorgo, pl: 9 }])?.pl).toBe(3);
    expect(cagedChampion([{ ...gorgo, pl: undefined }])?.pl).toBe(0);
  });
});

describe("defenderForcesOf", () => {
  it("reads the garrisons off buildingdata, the levels off the academy, and the caged champion", () => {
    expect(
      defenderForcesOf({
        buildingdata: {
          "5": { id: 5, t: 22, l: 1, m: { C1: 4 } },
          "6": { id: 6, t: 114, l: 1 },
        },
        academy: { C1: { level: 3 } },
        champion: [{ t: 2, l: 4, hp: 900, pl: 0, status: 0 }],
      }),
    ).toEqual({
      bunkers: { 5: { C1: 4 } },
      defenderLevels: { C1: 3 },
      defenderChampion: { t: 2, l: 4, hp: 900, pl: 0 },
    });
  });

  it("is no defence for a yard without one", () => {
    expect(defenderForcesOf({ buildingdata: {}, academy: undefined, champion: [] })).toEqual(
      NO_DEFENCE,
    );
  });
});

describe("parseDefenderForces", () => {
  it("reads back what was stored, through JSON", () => {
    const forces = {
      bunkers: { 83: { C1: 10, C2: 4 } },
      defenderLevels: { C1: 6 },
      defenderChampion: { t: 1, l: 2, hp: 5000, pl: 1 },
    };
    expect(parseDefenderForces(JSON.parse(JSON.stringify(forces)))).toEqual(forces);
  });

  it("keeps only what reads cleanly, and nothing for no object", () => {
    expect(
      parseDefenderForces({
        bunkers: { 83: { C1: -1, C2: 2.5, C3: 2 }, x: { C1: 1 } },
        defenderLevels: { C1: 0, C2: 3 },
        defenderChampion: { t: 99, l: 1, hp: 5 },
      }),
    ).toEqual({ bunkers: { 83: { C3: 2 } }, defenderLevels: { C2: 3 }, defenderChampion: null });
    expect(parseDefenderForces("nope")).toBeUndefined();
  });
});

describe("battleDefence", () => {
  it("gives no options for no defence, so the battle runs as it always did", () => {
    expect(battleDefence(NO_DEFENCE)).toEqual({});
    expect(battleDefence(undefined)).toEqual({});
  });

  it("gives the garrisons, the levels and the champion when there are any", () => {
    const champion = { t: 1, l: 2, hp: 5000, pl: 0 };
    expect(
      battleDefence({ bunkers: { 5: { C1: 1 } }, defenderLevels: { C1: 2 }, defenderChampion: null }),
    ).toEqual({ bunkers: { 5: { C1: 1 } }, defenderLevels: { C1: 2 } });
    expect(battleDefence({ bunkers: {}, defenderLevels: {}, defenderChampion: champion })).toEqual({
      defenderLevels: {},
      defenderChampion: champion,
    });
  });
});
