import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildingClass } from "../game-rules/combat/yard.js";
import { costOf } from "./buildingCosts.js";
import { footprintOf, isDecoration } from "./buildingFootprints.js";
import { REVAMP_DECORATIONS, revampDecoration } from "./revampDecorations.js";

/** This project's own decorations (owner, 10 Nov 2026: the six autumn ones). */
describe("REVAMP_DECORATIONS", () => {
  test("types 201 to 206, priced 25 to 75 event coins", () => {
    expect(REVAMP_DECORATIONS.map((one) => [one.type, one.name, one.price])).toEqual([
      [201, "Leaf Pile and Rake", 25],
      [202, "Apple Barrel", 30],
      [203, "Pie on a Tree Stump", 35],
      [204, "Harvest Wheelbarrow", 50],
      [205, "Turkey Topiary", 60],
      [206, "Autumn Maple Tree", 75],
    ]);
    expect(revampDecoration(69)).toBeUndefined();
  });

  test("each is a decoration like Flash's: free uncapped cost row, square footprint, never a battle target", () => {
    for (const { type, size } of REVAMP_DECORATIONS) {
      const row = costOf(type);
      expect(row, `${type}`).toMatchObject({ kind: "decoration", group: 4, quantity: [0] });
      expect(row!.costs).toEqual([[0, 0, 0, 0, 0, []]]);
      expect(costOf(type, "outpost")).toBeUndefined();
      expect(costOf(type, "inferno")).toBeUndefined();
      expect(footprintOf(type)).toEqual({ w: size, h: size, decoration: true });
      expect(isDecoration(type)).toBe(true);
      expect(buildingClass(type)).toBe("decoration");
    }
  });

  test("the web's copy names the same types, names and footprints", () => {
    const web = readFileSync(new URL("../../../web/src/game/yard/revampDecorations.ts", import.meta.url), "utf8");
    const rows = [...web.matchAll(/^\s*\[(\d+), "([^"]+)", "[^"]+", \[[\s\S]*?\], \[100\], (\d+)\],$/gm)].map((m) => [
      Number(m[1]),
      m[2],
      Number(m[3]),
    ]);
    expect(rows).toEqual(REVAMP_DECORATIONS.map((one) => [one.type, one.name, one.size]));
  });
});
