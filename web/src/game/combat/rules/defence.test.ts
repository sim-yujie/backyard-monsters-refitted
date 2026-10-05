import { describe, expect, it } from "vitest";

import {
  academyLevels,
  battleDefence,
  cagedChampions,
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

describe("cagedChampions", () => {
  const gorgo = { t: 1, l: 3, hp: 5000, pl: 2, status: 0, fd: 0, ft: 0, fb: 0 };

  it("is each champion at home with health left, Krallen included", () => {
    expect(cagedChampions([gorgo])).toEqual([{ t: 1, l: 3, hp: 5000, pl: 2 }]);
    expect(cagedChampions([{ ...gorgo, status: 1 }, { ...gorgo, t: 5, l: 2 }])).toEqual([
      { t: 5, l: 2, hp: 5000, pl: 2 },
    ]);
    expect(cagedChampions([{ ...gorgo, hp: 0 }, { ...gorgo, t: 3 }]).map((one) => one.t)).toEqual([3]);
  });

  it("is both a basic champion and a Krallen, in the save's order (issue #310)", () => {
    const krallen = { ...gorgo, t: 5, l: 5, hp: 9000 };
    const fomor = { ...gorgo, t: 3, l: 6, hp: 7000 };
    expect(cagedChampions([krallen, fomor])).toEqual([
      { t: 5, l: 5, hp: 9000, pl: 2 },
      { t: 3, l: 6, hp: 7000, pl: 2 },
    ]);
    expect(cagedChampions([fomor, krallen]).map((one) => one.t)).toEqual([3, 5]);
  });

  it("takes at most one basic champion and one Krallen", () => {
    const krallen = { ...gorgo, t: 5 };
    expect(cagedChampions([gorgo, { ...gorgo, t: 3 }, krallen, { ...krallen, l: 1 }])).toEqual([
      { t: 1, l: 3, hp: 5000, pl: 2 },
      { t: 5, l: 3, hp: 5000, pl: 2 },
    ]);
  });

  it("is empty for none at home, an unknown type, or no list", () => {
    expect(cagedChampions([{ ...gorgo, status: 2 }])).toEqual([]);
    expect(cagedChampions([{ ...gorgo, t: 99 }])).toEqual([]);
    expect(cagedChampions(undefined)).toEqual([]);
    expect(cagedChampions([])).toEqual([]);
  });

  it("clamps the power level to 0..3, and reads none as 0", () => {
    expect(cagedChampions([{ ...gorgo, pl: 9 }])[0]?.pl).toBe(3);
    expect(cagedChampions([{ ...gorgo, pl: undefined }])[0]?.pl).toBe(0);
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
      defenderChampions: [{ t: 2, l: 4, hp: 900, pl: 0 }],
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
      defenderChampions: [
        { t: 5, l: 4, hp: 8000, pl: 2 },
        { t: 1, l: 2, hp: 5000, pl: 1 },
      ],
    };
    expect(parseDefenderForces(JSON.parse(JSON.stringify(forces)))).toEqual(forces);
  });

  it("reads a session stored before issue #310, with one defenderChampion", () => {
    expect(
      parseDefenderForces({
        bunkers: {},
        defenderLevels: {},
        defenderChampion: { t: 1, l: 2, hp: 5000, pl: 1 },
      }),
    ).toEqual({
      bunkers: {},
      defenderLevels: {},
      defenderChampions: [{ t: 1, l: 2, hp: 5000, pl: 1 }],
    });
  });

  it("keeps only what reads cleanly, and nothing for no object", () => {
    expect(
      parseDefenderForces({
        bunkers: { 83: { C1: -1, C2: 2.5, C3: 2 }, x: { C1: 1 } },
        defenderLevels: { C1: 0, C2: 3 },
        defenderChampions: [{ t: 99, l: 1, hp: 5 }, "x"],
      }),
    ).toEqual({ bunkers: { 83: { C3: 2 } }, defenderLevels: { C2: 3 }, defenderChampions: [] });
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
      battleDefence({ bunkers: { 5: { C1: 1 } }, defenderLevels: { C1: 2 }, defenderChampions: [] }),
    ).toEqual({ bunkers: { 5: { C1: 1 } }, defenderLevels: { C1: 2 } });
    expect(battleDefence({ bunkers: {}, defenderLevels: {}, defenderChampions: [champion] })).toEqual({
      defenderLevels: {},
      defenderChampions: [champion],
    });
  });
});
