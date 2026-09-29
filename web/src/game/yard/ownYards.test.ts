import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import {
  consumeOwnYardTarget,
  isEmptyOutpost,
  MAIN_YARD,
  outpostBaseid,
  outpostCountText,
  outpostsOf,
  outpostTarget,
  ownYardsOf,
  setOwnYardTarget,
  withCell,
  yardTitle,
} from "./ownYards";
import { readYard } from "./yardModel";

/** The player's own yards and the switcher's list (outposts WP5, #146). */

const listing = (outposts: unknown): Pick<BaseLoadResponse, "outposts"> =>
  ({ outposts }) as Pick<BaseLoadResponse, "outposts">;

describe("outpostsOf", () => {
  it("reads the main yard's [x, y, baseid] list in its order", () => {
    expect(outpostsOf(listing([[242, 209, "2000242209"], [240, 210, "2000240210"]]))).toEqual([
      { baseid: "2000242209", cell: { col: 242, row: 209 } },
      { baseid: "2000240210", cell: { col: 240, row: 210 } },
    ]);
  });

  it("reads Flash-era strings and numbers, and skips what is not an outpost", () => {
    expect(
      outpostsOf(
        listing([["241", "208", 2000241208], [1, 2], "junk", [3, 4, ""], [5, 6, "0"], [242, 209, "2000241208"]]),
      ),
    ).toEqual([{ baseid: "2000241208", cell: { col: 241, row: 208 } }]);
    expect(outpostsOf(listing(null))).toEqual([]);
    expect(outpostsOf(listing(undefined))).toEqual([]);
  });
});

describe("the yard switcher's list", () => {
  const save = listing([[242, 209, "2000242209"], [240, 210, "2000240210"]]);

  it("lists the main yard first, then every outpost, marking the one open", () => {
    const entries = ownYardsOf(save, outpostTarget("2000240210"));
    expect(entries.map((entry) => [entry.title, entry.current])).toEqual([
      ["Main yard", false],
      ["Outpost (242, 209)", false],
      ["Outpost (240, 210)", true],
    ]);
    expect(entries[1]?.target).toEqual({
      baseid: "2000242209",
      kind: "outpost",
      cell: { col: 242, row: 209 },
    });
  });

  it("lists only the main yard for a player with no outposts", () => {
    expect(ownYardsOf(listing([]), MAIN_YARD)).toEqual([
      { target: MAIN_YARD, title: "Main yard", current: true },
    ]);
  });

  it("titles and counts", () => {
    expect(yardTitle(MAIN_YARD)).toBe("Main yard");
    expect(yardTitle(outpostTarget("9", { col: 12, row: 34 }))).toBe("Outpost (12, 34)");
    expect(yardTitle(outpostTarget("9"))).toBe("Outpost");
    expect([0, 1, 3].map(outpostCountText)).toEqual(["No outposts", "1 outpost", "3 outposts"]);
  });

  it("fills an outpost's cell in from the list", () => {
    expect(withCell(outpostTarget("2000240210"), save).cell).toEqual({ col: 240, row: 210 });
    expect(withCell(MAIN_YARD, save)).toBe(MAIN_YARD);
  });
});

describe("the yard a request names", () => {
  it("sends an outpost's baseid, and none for the main yard", () => {
    expect(outpostBaseid(outpostTarget("2000242209"))).toBe("2000242209");
    expect(outpostBaseid(MAIN_YARD)).toBeUndefined();
  });

  it("hands the yard screen a target once", () => {
    setOwnYardTarget(outpostTarget("2000242209"));
    expect(consumeOwnYardTarget()?.baseid).toBe("2000242209");
    expect(consumeOwnYardTarget()).toBeNull();
  });
});

describe("isEmptyOutpost", () => {
  const load = (type: string, buildingdata: BaseLoadResponse["buildingdata"]) =>
    readYard({
      error: 0,
      id: 1,
      baseid: "1",
      basesaveid: 1,
      worldsize: [800, 800],
      currenttime: 1,
      type,
      buildingdata,
    } as BaseLoadResponse);

  it("is an outpost holding its core and nothing else", () => {
    const core = { "1": { X: 0, Y: -50, t: 112, id: 1, l: 1 } };
    expect(isEmptyOutpost(load("outpost", core))).toBe(true);
    expect(isEmptyOutpost(load("outpost", {}))).toBe(true);
    expect(isEmptyOutpost(load("outpost", { ...core, "2": { X: 0, Y: 0, t: 1, id: 2 } }))).toBe(false);
    expect(isEmptyOutpost(load("main", core))).toBe(false);
  });
});
