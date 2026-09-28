import { describe, expect, test } from "bun:test";
import {
  RELOCATE_RESOURCE_COST,
  RELOCATE_SHINY_COST,
  chargeRelocation,
  relocateTargetRefusal,
  type RelocateTargetInput,
} from "./relocateRules.js";

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
