import { describe, expect, test } from "bun:test";
import {
  expansionRunning,
  housingLossLine,
  housingLossOf,
  landHousingLoss,
  reportWithHousingLoss,
} from "./housingLoss.js";

/**
 * A fallen Housing takes its housed monsters with it (issue #160): its share
 * of every stack, then Flash's overflow cull against the Housings left
 * standing (`HOUSING.as:161-199`).
 */

/** Four level 1 Housings, 200 each. */
const FOUR = {
  "1": { id: 1, t: 15, l: 1, X: 0, Y: 0 },
  "2": { id: 2, t: 15, l: 1, X: 100, Y: 0 },
  "3": { id: 3, t: 15, l: 1, X: 200, Y: 0 },
  "4": { id: 4, t: 15, l: 1, X: 300, Y: 0 },
};

const lossOf = (overrides: Partial<Parameters<typeof housingLossOf>[0]>) =>
  housingLossOf({
    buildingdata: FOUR as never,
    before: {},
    after: { "1": 0 },
    housed: {},
    levels: {},
    expansion: false,
    ...overrides,
  });

describe("housingLossOf: the share", () => {
  test("one of four fallen takes a quarter of every stack, to the nearest", () => {
    // 10 × 1/4 = 2.5 rounds up to 3; 1 × 1/4 = 0.25 rounds to nothing.
    expect(lossOf({ housed: { C1: 10, C2: 1 } })).toEqual({
      fallen: 1,
      lost: { C1: 3 },
      housed: { C1: 7, C2: 1 },
    });
  });

  test("halves go up, per type", () => {
    // Two of four: 5 → 2.5 → 3, 3 → 1.5 → 2, 1 → 0.5 → 1.
    expect(lossOf({ after: { "1": 0, "3": 0 }, housed: { C1: 5, C3: 3, C4: 1 } })).toEqual({
      fallen: 2,
      lost: { C1: 3, C3: 2, C4: 1 },
      housed: { C1: 2, C3: 1 },
    });
  });

  test("every Housing fallen takes everything", () => {
    const after = { "1": 0, "2": 0, "3": 0, "4": 0 };
    expect(lossOf({ after, housed: { C1: 7, C5: 2 } })).toEqual({
      fallen: 4,
      lost: { C1: 7, C5: 2 },
      housed: {},
    });
  });

  test("nothing fallen is nothing at all", () => {
    expect(lossOf({ after: { "1": 12 }, housed: { C1: 10 } })).toBeNull();
    expect(lossOf({ after: {}, housed: { C1: 10 } })).toBeNull();
  });

  test("a Housing under construction counts on neither side", () => {
    const yard = { ...FOUR, "5": { id: 5, t: 15, l: 1, X: 400, Y: 0, cB: 1 } };
    // One of the four built ones fell: a quarter, not a fifth.
    expect(lossOf({ buildingdata: yard as never, housed: { C1: 10 } })?.lost).toEqual({ C1: 3 });
    // Only the one under construction "fell": nothing.
    expect(lossOf({ buildingdata: yard as never, after: { "5": 0 }, housed: { C1: 10 } })).toBeNull();
  });

  test("a Housing already down when the battle began held nothing and did not fall", () => {
    // Three standing, one of them fell: a third.
    const loss = lossOf({ before: { "2": 0 }, after: { "1": 0, "2": 0 }, housed: { C1: 9 } });
    expect(loss).toEqual({ fallen: 1, lost: { C1: 3 }, housed: { C1: 6 } });
  });

  test("knows a Housing by its engine id, and by its key when it has none", () => {
    const yard = { a: { id: 11, t: 15, l: 1 }, "12": { t: 15, l: 1 } };
    expect(lossOf({ buildingdata: yard as never, after: { "11": 0 }, housed: { C1: 4 } })?.lost).toEqual({ C1: 2 });
    expect(lossOf({ buildingdata: yard as never, after: { "12": 0 }, housed: { C1: 4 } })?.lost).toEqual({ C1: 2 });
    expect(lossOf({ buildingdata: yard as never, after: { a: 0 }, housed: { C1: 4 } })).toBeNull();
  });

  test("other buildings falling cost the housing nothing", () => {
    const yard = { ...FOUR, "9": { id: 9, t: 22, l: 1, m: { C1: 5 } } };
    expect(lossOf({ buildingdata: yard as never, after: { "9": 0 }, housed: { C1: 10 } })).toBeNull();
  });
});

describe("housingLossOf: the overflow", () => {
  /** A level 6 Housing (540) that falls beside three level 1 ones (600 left). */
  const MIXED = { ...FOUR, "1": { id: 1, t: 15, l: 6, X: 0, Y: 0 } };

  test("what the share leaves is culled one of every type per pass until it fits", () => {
    // 90 Pokeys (900) and 5 Finks (100): the share takes 23 and 1, leaving
    // 750 in 600; five passes of one each, then Pokeys alone, bring it to 600.
    expect(lossOf({ buildingdata: MIXED as never, housed: { C1: 90, C4: 5 } })).toEqual({
      fallen: 1,
      lost: { C1: 30, C4: 5 },
      housed: { C1: 60 },
    });
  });

  test("Housing Expansion counts while it runs", () => {
    // 600 × 1.25 = 750: the share's remainder fits.
    expect(lossOf({ buildingdata: MIXED as never, housed: { C1: 90, C4: 5 }, expansion: true })).toEqual({
      fallen: 1,
      lost: { C1: 23, C4: 1 },
      housed: { C1: 67, C4: 4 },
    });
  });

  test("a Housing mid-upgrade houses at its old level", () => {
    const yard = {
      "1": { id: 1, t: 15, l: 1 },
      // Upgrading to level 2 (260): still 200 until it finishes.
      "2": { id: 2, t: 15, l: 1, cU: 1 },
    };
    // Half of 50 is 25 (250 space) in 200: five more go.
    expect(lossOf({ buildingdata: yard as never, housed: { C1: 50 } })).toEqual({
      fallen: 1,
      lost: { C1: 30 },
      housed: { C1: 20 },
    });
  });

  test("measures space at the defender's academy levels", () => {
    // Pokeys at level 6 take 7 each: 25 of them (175) fit the 200 left.
    const yard = { "1": { id: 1, t: 15, l: 1 }, "2": { id: 2, t: 15, l: 1 } };
    expect(lossOf({ buildingdata: yard as never, housed: { C1: 50 }, levels: { C1: 6 } })?.housed).toEqual({ C1: 25 });
  });
});

describe("expansionRunning", () => {
  test("is Housing Expansion's end still ahead", () => {
    expect(expansionRunning({ EXH: { s: 0, e: 200 } }, 100)).toBe(true);
    expect(expansionRunning({ EXH: { s: 0, e: 100 } }, 100)).toBe(false);
    expect(expansionRunning(null, 100)).toBe(false);
  });
});

describe("landHousingLoss", () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    type: "main",
    mapversion: 2,
    wmid: 0,
    buildingdata: structuredClone(FOUR) as never,
    monsters: { housed: { C1: 10, C2: 1 }, space: 800, saved: 5 } as Record<string, any>,
    ...overrides,
  });
  const battle = { before: {}, after: { "1": 0 } };

  test("writes the kept roster on a main yard, leaving the rest of the blob", () => {
    const yard = row();
    expect(landHousingLoss(yard, battle, { academy: {}, storedata: {} }, 0)?.lost).toEqual({ C1: 3 });
    expect(yard.monsters).toEqual({ housed: { C1: 7, C2: 1 }, space: 800, saved: 5 });
  });

  test("a Map Room 1 main yard and a Map Room 2 outpost lose theirs too", () => {
    for (const overrides of [{ mapversion: 1 }, { type: "outpost" }]) {
      const yard = row(overrides);
      landHousingLoss(yard, battle, null, 0);
      expect(yard.monsters.housed).toEqual({ C1: 7, C2: 1 });
    }
  });

  test("the owner's academy and Housing Expansion measure the overflow", () => {
    const land = (owner: Parameters<typeof landHousingLoss>[2]) => {
      const yard = row({
        buildingdata: { "1": { id: 1, t: 15, l: 1 }, "2": { id: 2, t: 15, l: 1 } },
        monsters: { housed: { C1: 50 } },
      });
      landHousingLoss(yard, battle, owner, 50);
      return yard.monsters.housed;
    };
    // The share leaves 25 Pokeys: 250 in the 200 left, 250 with the expansion,
    // 175 at academy level 6.
    expect(land(null)).toEqual({ C1: 20 });
    expect(land({ academy: {}, storedata: { EXH: { e: 100 } } })).toEqual({ C1: 25 });
    expect(land({ academy: {}, storedata: { EXH: { e: 40 } } })).toEqual({ C1: 20 });
    expect(land({ academy: { C1: { level: 6 } }, storedata: {} })).toEqual({ C1: 25 });
  });

  test("Map Room 3, Inferno and wild monster yards are left alone", () => {
    for (const overrides of [
      { mapversion: 3 },
      { wmid: 102 },
      { monsters: { housed: {}, C1: [{ hp: 10 }] } },
      { type: "inferno" },
      { type: "tribe" },
    ]) {
      const yard = row(overrides);
      const before = structuredClone(yard.monsters);
      expect(landHousingLoss(yard, battle, null, 0)).toBeNull();
      expect(yard.monsters).toEqual(before);
    }
  });

  test("a fall that costs nothing writes nothing", () => {
    const yard = row({ monsters: { housed: { C2: 1 } } });
    const monsters = yard.monsters;
    expect(landHousingLoss(yard, battle, null, 0)?.lost).toEqual({});
    expect(yard.monsters).toBe(monsters);
  });
});

describe("the report line", () => {
  test("names the losses in the report's own words", () => {
    expect(housingLossLine({ fallen: 1, lost: { C1: 3, C2: 1 }, housed: {} })).toBe(
      "A Housing fell: 3 Pokeys and 1 Octo-ooze were lost."
    );
    expect(housingLossLine({ fallen: 2, lost: { C1: 1 }, housed: {} })).toBe("2 Housings fell: 1 Pokey was lost.");
    expect(housingLossLine({ fallen: 1, lost: { C12: 2, C3: 2, C17: 3 }, housed: {} })).toBe(
      "A Housing fell: 2 D.A.V.E., 2 Bolts and 3 Slimeattikus were lost."
    );
  });

  test("is left out when nothing was lost", () => {
    expect(housingLossLine({ fallen: 1, lost: {}, housed: {} })).toBeNull();
    expect(housingLossLine(null)).toBeNull();
    expect(reportWithHousingLoss("0:04 Flung 3 Pokey at (1, 2)\nResult: 1%", null)).toBe(
      "0:04 Flung 3 Pokey at (1, 2)\nResult: 1%"
    );
  });

  test("goes before the report's result line", () => {
    const report = "0:04 Flung 3 Pokey at (1, 2)\nThe defending champion fell.\nResult: 40% damage.";
    expect(reportWithHousingLoss(report, { fallen: 1, lost: { C1: 3 }, housed: {} })).toBe(
      "0:04 Flung 3 Pokey at (1, 2)\nThe defending champion fell.\nA Housing fell: 3 Pokeys were lost.\nResult: 40% damage."
    );
  });
});
