import { describe, expect, it } from "vitest";
import {
  canTick,
  currentPlan,
  everySource,
  freeRoom,
  matchesSearch,
  nearestWithRoom,
  pairsOf,
  planMove,
  rankTypes,
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

const state = (over: Partial<MoveState> = {}): MoveState => ({ mode: "out", anchor: "main", ticks: [], picks: {}, even: false, ...over });

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

  it("Near 5 skips the full, the attacked and the main yard", () => {
    expect(nearestWithRoom(yards, MAIN, sizeOf, 7, distance)).toEqual(["a", "b", "e", "f", "g"]);
  });

  it("All home ticks every outpost with monsters that is not under attack", () => {
    expect(everySource(yards, MAIN, sizeOf, distance)).toEqual(["a", "c", "f"]);
  });

  it("fills targets in order, nearest first", () => {
    const { plan } = currentPlan(state({ ticks: ["b", "a"], picks: { C1: "all" } }), byId, sizeOf, distance);
    // a has 400 free (57 Pokeys), so all 60 cannot go to a: 57 to a, 3 to b.
    expect(plan.add).toEqual({ a: { C1: 57 }, b: { C1: 3 } });
    expect(plan.total).toBe(60);
  });

  it("Even splits one by one round the targets", () => {
    const { plan } = currentPlan(state({ ticks: ["a", "b", "e"], picks: { C1: 30 }, even: true }), byId, sizeOf, distance);
    expect(plan.add).toEqual({ a: { C1: 10 }, b: { C1: 10 }, e: { C1: 10 } });
  });

  it("leaves behind what does not fit and says so", () => {
    const plan = planMove([MAIN], [byId.get("c")!], { C12: 4 }, false, sizeOf);
    expect(plan.total).toBe(0);
    expect(plan.left).toEqual({ C12: 4 });
  });

  it("brings home from many sources, nearest first, into the anchor's room", () => {
    const home = yard("home", 0, { C1: 300 }, 2160, { main: true }); // 2100 used: 60 free
    const sources = [yard("s1", 1, { C1: 5 }), yard("s2", 2, { C1: 10 })];
    const plan = planMove(sources, [home], { C1: 15 }, false, sizeOf);
    expect(plan.sub).toEqual({ s1: { C1: 5 }, s2: { C1: 3 } });
    expect(plan.leftTotal).toBe(7);
  });

  it("a stepper number is cut to what the sources hold", () => {
    const { picked } = currentPlan(state({ ticks: ["b"], picks: { C2: 999, C1: 2 } }), byId, sizeOf, distance);
    expect(picked).toEqual({ C1: 2, C2: 30 });
  });

  it("the server gets one pair per route", () => {
    const out = currentPlan(state({ ticks: ["a", "b"], picks: { C1: "all" } }), byId, sizeOf, distance);
    expect(pairsOf(out.plan, "out", "main")).toEqual([
      { from: "main", to: "a", moved: { C1: 57 } },
      { from: "main", to: "b", moved: { C1: 3 } },
    ]);
    const back = currentPlan(state({ mode: "in", ticks: ["a", "f"], picks: { C1: "all", C2: "all" } }), byId, sizeOf, distance);
    expect(pairsOf(back.plan, "in", "main")).toEqual([
      { from: "a", to: "main", moved: { C1: 20 } },
      { from: "f", to: "main", moved: { C2: 2 } },
    ]);
  });

  it("the tray offers the anchor's types (out) or every source's (in)", () => {
    expect(trayTypes(state(), yards, sizeOf)).toEqual(["C1", "C2", "C12"]);
    // d is under attack: its Octo-oozes are not on offer, f's are.
    expect(trayTypes(state({ mode: "in" }), yards, sizeOf)).toEqual(["C1", "C2", "C12"]);
  });

  it("plates rank moving, then picked, then biggest by room", () => {
    const c = byId.get("c")!;
    expect(rankTypes(c, sizeOf)).toEqual(["C12", "C1"]);
    expect(rankTypes(c, sizeOf, { C1: "all" })).toEqual(["C1", "C12"]);
  });

  it("search matches names and coordinates", () => {
    const y = yard("x", 240, {});
    expect(matchesSearch("Lookout", { ...y, y: 209 }, "look")).toBe(true);
    expect(matchesSearch("240, 209", { ...y, y: 209 }, "240,20")).toBe(true);
    expect(matchesSearch("Ridge", { ...y, y: 209 }, "swamp")).toBe(false);
  });
});
