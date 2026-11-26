import { describe, expect, it } from "vitest";
import {
  canTick,
  currentPlan,
  fillAll,
  firstTicks,
  fitPicks,
  freeRoom,
  maxFor,
  pairsOf,
  planMove,
  rankTypes,
  sourceOrder,
  tapTicks,
  trayTypes,
  type ArmyYard,
  type MoveState,
} from "./transferPlan";

/** Pokey 7 (Academy L6), Octo-ooze 10, Bolt 15, Fink 20, D.A.V.E. 160. */
const SIZES: Record<string, number> = { C1: 7, C2: 10, C3: 15, C4: 20, C12: 160 };
const sizeOf = (id: string): number => SIZES[id] ?? 10;
/** Distance along a line: x only. */
const distance = (a: ArmyYard, b: ArmyYard): number => Math.abs(a.x - b.x);

const yard = (baseid: string, x: number, housed: Record<string, number>, capacity = 540, extra: Partial<ArmyYard> = {}): ArmyYard => ({
  baseid,
  main: false,
  x,
  y: 0,
  housed,
  capacity,
  attack: false,
  ...extra,
});

const MAIN = yard("main", 0, { C1: 60, C2: 30, C12: 4 }, 2160, { main: true });
const yards = [
  MAIN,
  yard("a", 1, { C1: 20 }),
  yard("b", 2, {}),
  yard("c", 3, { C12: 3, C1: 8 }), // 536 of 540: full for a Pokey
  yard("d", 4, { C2: 4 }, 540, { attack: true }),
  yard("e", 5, {}),
  yard("f", 6, { C2: 2 }),
  yard("g", 7, {}),
];
const byId = new Map(yards.map((y) => [y.baseid, y]));

const state = (over: Partial<MoveState> = {}): MoveState => ({ mode: "out", anchor: "main", ticks: [], picks: {}, ...over });

describe("transferPlan", () => {
  it("free room uses housing sizes", () => {
    expect(freeRoom(byId.get("a")!, sizeOf)).toBe(540 - 140);
    expect(freeRoom(byId.get("c")!, sizeOf)).toBe(4);
  });

  it("ticks: no main-to-main, no yard under attack, no full target, no empty source", () => {
    expect(canTick(byId.get("c")!, MAIN, "out", sizeOf, 7)).toBe(false);
    expect(canTick(byId.get("d")!, MAIN, "out", sizeOf, 7)).toBe(false);
    expect(canTick(byId.get("b")!, MAIN, "out", sizeOf, 7)).toBe(true);
    expect(canTick(byId.get("b")!, MAIN, "in", sizeOf, 7)).toBe(false);
    // From an outpost, the main yard can be a target.
    expect(canTick(MAIN, byId.get("a")!, "out", sizeOf, 7)).toBe(true);
  });

  it("Bring to starts with every yard that can send ticked, the main yard first, then nearest; never one under attack", () => {
    expect(firstTicks("in", yards, MAIN, sizeOf, distance)).toEqual(["a", "c", "f"]);
    // To outpost f (x 6): the main yard first though it is the farthest, then a (x 1)... by distance from f.
    const f = byId.get("f")!;
    expect(firstTicks("in", yards, f, sizeOf, distance)).toEqual(["main", "c", "a"]);
    // Move from starts with no target.
    expect(firstTicks("out", yards, MAIN, sizeOf, distance)).toEqual([]);
  });

  it("sources give in order: the main yard first, then the outposts nearest the target", () => {
    const target = yard("t", 10, {}, 540);
    const near = yard("near", 9, { C1: 5 });
    const far = yard("far", 2, { C1: 5 });
    const home = yard("home", 0, { C1: 5 }, 2160, { main: true });
    expect(sourceOrder([far, near, home], target, distance).map((y) => y.baseid)).toEqual(["home", "near", "far"]);
    const plan = planMove(sourceOrder([far, near, home], target, distance), [target], { C1: 8 }, sizeOf);
    expect(plan.sub).toEqual({ home: { C1: 5 }, near: { C1: 3 } });
  });

  it("Move from is one to one: a tap sets the target, another tap moves it, tapping it again clears it", () => {
    expect(tapTicks("out", [], "a")).toEqual(["a"]);
    expect(tapTicks("out", ["a"], "b")).toEqual(["b"]);
    expect(tapTicks("out", ["b"], "b")).toEqual([]);
    // Bring to: ticks and unticks each.
    expect(tapTicks("in", ["a", "c"], "c")).toEqual(["a"]);
    expect(tapTicks("in", ["a"], "f")).toEqual(["a", "f"]);
    const { plan, dst } = currentPlan(state({ ticks: ["b"], picks: { C1: 10, C2: 5 } }), byId, sizeOf, distance);
    expect(dst.map((y) => y.baseid)).toEqual(["b"]);
    expect(pairsOf(plan, "out", "main")).toEqual([{ from: "main", to: "b", moved: { C1: 10, C2: 5 } }]);
  });

  it("a pick never goes past what the ticked sources hold or the target's room", () => {
    const held = (id: string): number => ({ C1: 100, C12: 4 })[id] ?? 0;
    // 400 free: 3 D.A.V.E.s would need 480.
    expect(maxFor("C12", {}, held, 400, sizeOf)).toBe(2);
    // With 30 Pokeys (210) picked, 190 is left: one D.A.V.E.
    expect(maxFor("C12", { C1: 30 }, held, 400, sizeOf)).toBe(1);
    // The type's own pick does not count against it.
    expect(maxFor("C1", { C1: 30 }, held, 400, sizeOf)).toBe(57);
    // Held is the cap when there is room to spare, or no target yet.
    expect(maxFor("C1", {}, held, 5_000, sizeOf)).toBe(100);
    expect(maxFor("C12", {}, held, null, sizeOf)).toBe(4);
  });

  it("picks are cut to the room in roster order: the later types lose first", () => {
    const held = (id: string): number => ({ C1: 100, C2: 50, C12: 4 })[id] ?? 0;
    // 200 room: 20 Pokeys (140), then 6 Octo-oozes (60), no D.A.V.E.
    expect(fitPicks({ C12: 1, C2: 10, C1: 20 }, held, 200, sizeOf)).toEqual({ C1: 20, C2: 6 });
    // Cut to what is held, and zeroes dropped.
    expect(fitPicks({ C1: 500, C2: 0 }, held, null, sizeOf)).toEqual({ C1: 100 });
  });

  it("All fills every type in roster order until the room is full", () => {
    const held = (id: string): number => ({ C1: 10, C2: 50, C12: 4 })[id] ?? 0;
    // 400 room: 10 Pokeys (70), 33 Octo-oozes (330), then nothing fits.
    expect(fillAll(["C12", "C2", "C1"], held, 400, sizeOf)).toEqual({ C1: 10, C2: 33 });
    // A smaller type still fills after a big one stops.
    const big = (id: string): number => ({ C12: 3, C3: 9 })[id] ?? 0;
    expect(fillAll(["C3", "C12"], big, 300, sizeOf)).toEqual({ C3: 9, C12: 1 });
    // No target yet: everything held.
    expect(fillAll(["C1", "C12"], held, null, sizeOf)).toEqual({ C1: 10, C12: 4 });
  });

  it("brings home from many sources into the anchor's room, and the server gets one pair per source", () => {
    const back = currentPlan(state({ mode: "in", ticks: ["f", "a"], picks: { C1: 20, C2: 2 } }), byId, sizeOf, distance);
    expect(back.held("C1")).toBe(20);
    expect(pairsOf(back.plan, "in", "main")).toEqual([
      { from: "a", to: "main", moved: { C1: 20 } },
      { from: "f", to: "main", moved: { C2: 2 } },
    ]);
  });

  it("the plan never moves more than fits, even from a stale pick", () => {
    const plan = planMove([MAIN], [byId.get("c")!], { C12: 4 }, sizeOf);
    expect(plan.total).toBe(0);
  });

  it("the tray offers the anchor's types (out) or every source's (in)", () => {
    expect(trayTypes("out", "main", yards, sizeOf)).toEqual(["C1", "C2", "C12"]);
    // d is under attack: its Octo-oozes are not on offer, f's are.
    expect(trayTypes("in", "main", yards, sizeOf)).toEqual(["C1", "C2", "C12"]);
  });

  it("plates rank moving, then picked, then biggest by room", () => {
    const c = byId.get("c")!;
    expect(rankTypes(c, sizeOf)).toEqual(["C12", "C1"]);
    expect(rankTypes(c, sizeOf, { C1: 3 })).toEqual(["C1", "C12"]);
    expect(rankTypes(c, sizeOf, { C1: 0 })).toEqual(["C12", "C1"]);
  });
});
