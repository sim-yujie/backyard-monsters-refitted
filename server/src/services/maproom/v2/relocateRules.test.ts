import { describe, expect, test } from "bun:test";
import {
  RELOCATE_RESOURCE_COST,
  RELOCATE_SHINY_COST,
  chargeRelocation,
  mainYardHealth,
  randomRelocateRefusal,
  relocateTargetRefusal,
  type RandomRelocateInput,
  type RelocateTargetInput,
} from "./relocateRules.js";

describe("mainYardHealth (BASE.as:2333-2338)", () => {
  // Level 1 Twig Snappers (t 1) have 500 health; t 17 is a wall, t 24 a trap.
  const yard = {
    buildingdata: {
      "1": { id: 1, t: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, X: 0, Y: 0, hp: 50 },
      "3": { id: 3, t: 17, X: 0, Y: 0 },
      "4": { id: 4, t: 24, X: 0, Y: 0 },
    },
    buildinghealthdata: { "1": 20 },
  };

  test("sums health and full health over everything but traps and walls", () => {
    expect(mainYardHealth(yard as never)).toEqual({ hp: 70, max: 1000 });
  });
});

describe("randomRelocateRefusal (BASE.as:2340-2341, owner's answer D)", () => {
  const input = (over: Partial<RandomRelocateInput> = {}): RandomRelocateInput => ({
    mapVersion: 2,
    allianceId: null,
    outpostCount: 0,
    health: { hp: 99, max: 1000 },
    underAttack: false,
    ...over,
  });

  test("a destroyed main yard, no alliance, no outposts: may move", () => {
    expect(randomRelocateRefusal(input())).toBeNull();
    expect(randomRelocateRefusal(input({ health: { hp: 0, max: 1000 } }))).toBeNull();
  });

  test("anyone not on Map Room 2: refused, before anything else", () => {
    expect(randomRelocateRefusal(input({ mapVersion: 1 }))).toBe("notMapRoom2");
    expect(randomRelocateRefusal(input({ mapVersion: 3 }))).toBe("notMapRoom2");
    expect(randomRelocateRefusal(input({ mapVersion: undefined }))).toBe("notMapRoom2");
    expect(randomRelocateRefusal(input({ mapVersion: 1, allianceId: 12 }))).toBe("notMapRoom2");
  });

  test("in an alliance: refused", () => {
    expect(randomRelocateRefusal(input({ allianceId: 12 }))).toBe("inAlliance");
  });

  test("owning outposts: refused", () => {
    expect(randomRelocateRefusal(input({ outpostCount: 1 }))).toBe("hasOutposts");
  });

  test("10% health or more, or an empty yard: refused", () => {
    expect(randomRelocateRefusal(input({ health: { hp: 100, max: 1000 } }))).toBe("yardStanding");
    expect(randomRelocateRefusal(input({ health: { hp: 1000, max: 1000 } }))).toBe("yardStanding");
    expect(randomRelocateRefusal(input({ health: { hp: 0, max: 0 } }))).toBe("yardStanding");
  });

  test("an attack running on the main yard: refused", () => {
    expect(randomRelocateRefusal(input({ underAttack: true }))).toBe("underAttack");
  });
});

const ME = 2505;
const THEM = 77;
const WORLD = "world-a";
const OUTPOST = "2000241208";

const input = (over: Partial<RelocateTargetInput> = {}): RelocateTargetInput => ({
  userid: ME,
  worldid: WORLD,
  outposts: [[241, 208, OUTPOST]],
  cell: { uid: ME, base_type: 3, map_version: 2, worldid: WORLD },
  save: { baseid: OUTPOST, userid: ME, saveuserid: ME, type: "outpost" },
  underAttack: false,
  ...over,
});

describe("relocateTargetRefusal", () => {
  test("the caller's own outpost in their world may be the new home", () => {
    expect(relocateTargetRefusal(input())).toBeNull();
  });

  test("a base id with no cell or no save is refused", () => {
    expect(relocateTargetRefusal(input({ cell: null }))).toBe("notFound");
    expect(relocateTargetRefusal(input({ save: null }))).toBe("notFound");
  });

  test("another player's outpost is refused", () => {
    expect(
      relocateTargetRefusal(
        input({
          cell: { uid: THEM, base_type: 3, map_version: 2, worldid: WORLD },
          save: { baseid: OUTPOST, userid: THEM, saveuserid: THEM, type: "outpost" },
        })
      )
    ).toBe("notYours");
  });

  test("a cell that says it is mine over a save that is not is still refused", () => {
    expect(
      relocateTargetRefusal(
        input({ save: { baseid: OUTPOST, userid: THEM, saveuserid: THEM, type: "outpost" } })
      )
    ).toBe("notYours");
  });

  test("an outpost missing from the caller's own list is refused", () => {
    expect(relocateTargetRefusal(input({ outposts: [] }))).toBe("notYours");
  });

  test("a cell in another world is refused, as is a caller with no world", () => {
    expect(
      relocateTargetRefusal(input({ cell: { uid: ME, base_type: 3, map_version: 2, worldid: "world-b" } }))
    ).toBe("wrongWorld");
    expect(relocateTargetRefusal(input({ worldid: null }))).toBe("wrongWorld");
  });

  test("a main yard, a wild camp or a Map Room 3 cell is not an outpost", () => {
    expect(
      relocateTargetRefusal(
        input({
          cell: { uid: THEM, base_type: 2, map_version: 2, worldid: WORLD },
          save: { baseid: OUTPOST, userid: THEM, saveuserid: THEM, type: "main" },
        })
      )
    ).toBe("notAnOutpost");
    expect(
      relocateTargetRefusal(
        input({
          cell: { uid: 0, base_type: 1, map_version: 2, worldid: WORLD },
          save: { baseid: OUTPOST, userid: 0, saveuserid: 0, type: "tribe" },
        })
      )
    ).toBe("notAnOutpost");
    expect(
      relocateTargetRefusal(input({ cell: { uid: ME, base_type: 3, map_version: 3, worldid: WORLD } }))
    ).toBe("notAnOutpost");
  });

  test("an outpost under attack is refused", () => {
    expect(relocateTargetRefusal(input({ underAttack: true }))).toBe("underAttack");
  });
});

describe("chargeRelocation", () => {
  const rich = { r1: 40_000_000, r2: 40_000_000, r3: 40_000_000, r4: 40_000_000, r1max: 99 };

  test("resources: 30,000,000 of each of r1..r4, the caps left alone", () => {
    const charge = chargeRelocation({ credits: 10, resources: rich }, "resources");
    expect(charge).toEqual({
      ok: true,
      credits: 10,
      resources: { r1: 10_000_000, r2: 10_000_000, r3: 10_000_000, r4: 10_000_000, r1max: 99 },
    });
    expect(rich.r1).toBe(40_000_000);
  });

  test("resources: one short resource refuses the lot", () => {
    expect(
      chargeRelocation({ credits: 0, resources: { ...rich, r3: RELOCATE_RESOURCE_COST - 1 } }, "resources")
    ).toEqual({ ok: false, reason: "notEnoughResources" });
    expect(chargeRelocation({ credits: 0, resources: null }, "resources")).toEqual({
      ok: false,
      reason: "notEnoughResources",
    });
  });

  test("shiny: 1,500, refused when the balance is short", () => {
    expect(chargeRelocation({ credits: 2000, resources: rich }, "shiny")).toEqual({
      ok: true,
      credits: 2000 - RELOCATE_SHINY_COST,
      resources: rich,
    });
    expect(chargeRelocation({ credits: RELOCATE_SHINY_COST - 1, resources: rich }, "shiny")).toEqual({
      ok: false,
      reason: "notEnoughShiny",
    });
  });
});
