import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import { readYard, type Yard } from "../yardModel";
import { Plan } from "./plan";
import { countByKind, searchNodes, type SearchGroup } from "./search";

/**
 * Searching the placed buildings.
 *
 * The yard below is deliberately mixed: two levels of one wall type, a second
 * wall type, two towers, a trap and a town hall, plus a mushroom that must
 * never appear because it cannot be selected.
 */

const BUILDINGS: readonly BuildingData[] = [
  { id: 1, t: 17, X: 0, Y: 0 },
  { id: 2, t: 17, X: 20, Y: 0 },
  { id: 3, t: 17, X: 40, Y: 0, l: 3 },
  { id: 4, t: 18, X: -100, Y: 0 },
  { id: 5, t: 20, X: 200, Y: 0 },
  { id: 6, t: 21, X: 300, Y: 0 },
  { id: 7, t: 24, X: -200, Y: 0 },
  { id: 8, t: 14, X: -300, Y: 0, l: 5 },
];

const yard: Yard = readYard({
  error: 0,
  id: 1,
  baseid: "1",
  basesaveid: 1,
  worldsize: [800, 800],
  currenttime: 1_700_000_000,
  savetime: 1_700_000_000,
  storedata: { ENL: { q: 0 } },
  buildingdata: Object.fromEntries(BUILDINGS.map((entry) => [String(entry.id), entry])),
  mushrooms: { l: [{ id: 1, X: 300, Y: 200 }] },
} as unknown as BaseLoadResponse);

const nodes = () => Plan.fromYard(yard).all();

const NO_KINDS = new Set<string>();

/** A group as `name Lx: ids`, which is what the panel's row shows. */
const rows = (groups: readonly SearchGroup[]): string[] =>
  groups.map((group) => `${group.name} L${group.level}: ${group.ids.join(",")}`);

describe("searchNodes", () => {
  it("lists the whole yard for an empty query and no chips", () => {
    expect(rows(searchNodes(nodes(), "", NO_KINDS))).toEqual([
      "Block L1: 1,2",
      "Block L3: 3",
      "Booby Trap L1: 7",
      "Cannon Tower L1: 5",
      "Sniper Tower L1: 6",
      "Stone Block L1: 4",
      "Town Hall L5: 8",
    ]);
  });

  it("stacks one type at one level into a single row", () => {
    const [first] = searchNodes(nodes(), "block", NO_KINDS);
    expect(first).toEqual({ type: 17, name: "Block", level: 1, kind: "wall", ids: [1, 2] });
  });

  it("matches on the name, case-insensitively and anywhere in it", () => {
    expect(rows(searchNodes(nodes(), "TOWER", NO_KINDS))).toEqual([
      "Cannon Tower L1: 5",
      "Sniper Tower L1: 6",
    ]);
  });

  it("matches on the type id when the query is digits", () => {
    expect(rows(searchNodes(nodes(), "24", NO_KINDS))).toEqual(["Booby Trap L1: 7"]);
    expect(rows(searchNodes(nodes(), "18", NO_KINDS))).toEqual(["Stone Block L1: 4"]);
  });

  it("filters by chip, and a chip and a query together", () => {
    expect(rows(searchNodes(nodes(), "", new Set(["trap"])))).toEqual(["Booby Trap L1: 7"]);
    expect(rows(searchNodes(nodes(), "", new Set(["wall"])))).toEqual([
      "Block L1: 1,2",
      "Block L3: 3",
      "Stone Block L1: 4",
    ]);
    expect(rows(searchNodes(nodes(), "block", new Set(["tower"])))).toEqual([]);
  });

  it("takes any of several chips", () => {
    expect(rows(searchNodes(nodes(), "", new Set(["trap", "special"])))).toEqual([
      "Booby Trap L1: 7",
      "Town Hall L5: 8",
    ]);
  });

  it("sorts by name, then by level", () => {
    const found = searchNodes(nodes(), "block", NO_KINDS);
    expect(found.map((group) => [group.name, group.level])).toEqual([
      ["Block", 1],
      ["Block", 3],
      ["Stone Block", 1],
    ]);
  });

  it("never returns a mushroom, which cannot be selected", () => {
    const all = searchNodes(nodes(), "", NO_KINDS);
    expect(all.some((group) => group.type === 7)).toBe(false);
    expect(all.flatMap((group) => [...group.ids])).toHaveLength(BUILDINGS.length);
  });

  it("finds nothing for a query that matches nothing", () => {
    expect(searchNodes(nodes(), "zzz", NO_KINDS)).toEqual([]);
  });

  it("ignores surrounding space in the query", () => {
    expect(rows(searchNodes(nodes(), "  booby  ", NO_KINDS))).toEqual(["Booby Trap L1: 7"]);
  });
});

describe("countByKind", () => {
  it("counts every placed building under its props kind", () => {
    expect([...countByKind(nodes())].sort()).toEqual([
      ["special", 1],
      ["tower", 2],
      ["trap", 1],
      ["wall", 4],
    ]);
  });
});
