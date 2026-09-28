import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { BEHAVIOUR_SPEED, monsterTickSpeed } from "@/game/combat/rules";
import fixture from "../../../test/fixtures/baseload-sandbox-yard.json";
import { readYard } from "./yardModel";
import {
  CREEP_WANDER_ODDS,
  EMPTY_LIFE,
  MAX_HOUSED_DRAWN,
  PEN_SETTLE_TICKS,
  penArea,
  reconcileWalkers,
  sampleArmy,
  screenHeading,
  stepWalker,
  walkerSpecs,
  yardLifeOf,
  type LifeGroup,
  type Walker,
  type YardLife,
} from "./yardLifeModel";

const save = fixture as unknown as BaseLoadResponse;

/** A repeatable stand-in for `Math.random`. */
const seeded = (seed = 1) => {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
};

/** Always the same number: 0.5 lands mid-area and never rolls a wander. */
const fixed = (value: number) => () => value;

const lifeWith = (overrides: Partial<YardLife>): YardLife => ({
  ...EMPTY_LIFE,
  ...overrides,
});

describe("yardLifeOf", () => {
  const yard = readYard(save);
  const life = yardLifeOf(save, yard);

  it("reads the housed army with each type's academy level", () => {
    expect(life.groups).toEqual([
      { id: "C14", level: 6, count: 25 },
      { id: "C15", level: 5, count: 2 },
    ]);
  });

  it("takes every standing Housing building as a pen", () => {
    expect(life.pens.map((pen) => pen.id)).toEqual([82, 584, 585, 586]);
  });

  it("leaves out a pen at zero health", () => {
    const other = {
      ...save,
      buildinghealthdata: { ...(save.buildinghealthdata ?? {}), "82": 0 },
    } as BaseLoadResponse;
    const read = yardLifeOf(other, readYard(other));
    expect(read.pens.map((pen) => pen.id)).toEqual([584, 585, 586]);
  });

});

describe("sampleArmy", () => {
  const group = (id: string, count: number): LifeGroup => ({ id, level: 1, count });

  it("draws an army that fits whole", () => {
    const drawn = sampleArmy([group("C1", 3), group("C2", 2)], 10);
    expect(drawn.map((one) => one.id)).toEqual(["C1", "C1", "C1", "C2", "C2"]);
  });

  it("caps a big army at exactly the cap, in proportion, every type kept", () => {
    const drawn = sampleArmy([group("C1", 3000), group("C2", 1000), group("C3", 1)], 150);
    const count = (id: string) => drawn.filter((one) => one.id === id).length;
    expect(drawn).toHaveLength(150);
    expect(count("C3")).toBe(1);
    expect(count("C1")).toBeGreaterThan(count("C2") * 2.5);
    expect(count("C1") + count("C2")).toBe(149);
  });

  it("keeps the most numerous types when there are more types than places", () => {
    const drawn = sampleArmy([group("C1", 5), group("C2", 50), group("C3", 20)], 2);
    expect(drawn.map((one) => one.id).sort()).toEqual(["C2", "C3"]);
  });

  it("defaults to MAX_HOUSED_DRAWN", () => {
    expect(sampleArmy([group("C1", 10_000)])).toHaveLength(MAX_HOUSED_DRAWN);
  });
});

describe("walkers", () => {
  const pen = { id: 7, x: 100, y: 200 };

  it("puts a pen's wander area 40 to 120 in from its corner", () => {
    expect(penArea(pen)).toEqual({ x: 140, y: 240, width: 80, height: 80 });
  });

  it("deals the sample round the pens and paces them at a quarter speed", () => {
    const life = lifeWith({
      groups: [{ id: "C1", level: 2, count: 5 }],
      pens: [pen, { id: 9, x: 0, y: 0 }],
    });
    const specs = walkerSpecs(life);
    expect(specs.map((spec) => spec.key)).toEqual([
      "m:7:C1:0",
      "m:9:C1:0",
      "m:7:C1:1",
      "m:9:C1:1",
      "m:7:C1:2",
    ]);
    expect(specs[0]?.speed).toBeCloseTo(monsterTickSpeed("C1", 2) * (BEHAVIOUR_SPEED["pen"] ?? 0));
    expect(specs[0]?.odds).toBe(CREEP_WANDER_ODDS);
  });

  it("draws no monsters without a pen", () => {
    const life = lifeWith({ groups: [{ id: "C1", level: 1, count: 5 }] });
    expect(walkerSpecs(life)).toEqual([]);
  });

  const walkerAt = (overrides: Partial<Walker> = {}): Walker => ({
    key: "k",
    monsterId: "C1",
    sheetLevel: 1,
    champion: false,
    area: penArea(pen),
    x: 150,
    y: 250,
    targetX: 150,
    targetY: 250,
    moving: false,
    heading: 0,
    age: 0,
    speed: 1,
    odds: 200,
    ...overrides,
  });

  it("stands for its first 240 ticks, then moves on a one-in-odds roll", () => {
    const walker = walkerAt();
    // `floor(random * odds) === 1` is the roll; 1.5 / 200 lands on it.
    const roll = fixed(1.5 / 200);
    for (let tick = 0; tick < PEN_SETTLE_TICKS; tick++) stepWalker(walker, roll);
    expect(walker.moving).toBe(false);
    stepWalker(walker, roll);
    expect(walker.moving).toBe(true);
    expect(walker.targetX).toBeCloseTo(140 + 80 * (1.5 / 200));
  });

  it("walks straight to its spot at its speed and stops within 5", () => {
    const walker = walkerAt({ moving: true, targetX: 150, targetY: 290, speed: 2 });
    stepWalker(walker, fixed(0.9));
    expect(walker.y).toBeCloseTo(252);
    expect(walker.heading).toBeCloseTo(screenHeading(0, 1));
    for (let tick = 0; tick < 30; tick++) stepWalker(walker, fixed(0.9));
    expect(walker.moving).toBe(false);
    expect(Math.abs(walker.y - 290)).toBeLessThanOrEqual(5);
  });

  it("keeps a walker that is still wanted where it stands", () => {
    const life = lifeWith({ groups: [{ id: "C1", level: 1, count: 2 }], pens: [pen] });
    const first = reconcileWalkers(new Map(), walkerSpecs(life), seeded());
    const walker = first.get("m:7:C1:0");
    if (!walker) throw new Error("no walker");
    walker.x = 155;
    const fewer = lifeWith({ groups: [{ id: "C1", level: 1, count: 1 }], pens: [pen] });
    const second = reconcileWalkers(first, walkerSpecs(fewer), seeded());
    expect([...second.keys()]).toEqual(["m:7:C1:0"]);
    expect(second.get("m:7:C1:0")).toBe(walker);
    expect(walker.x).toBe(155);
  });

  it("faces a step the way the isometric projection draws it", () => {
    // +x in yard units runs down-right on screen, +y down-left.
    expect(screenHeading(1, 0)).toBeCloseTo(Math.atan2(0.5, 1));
    expect(screenHeading(0, 1)).toBeCloseTo(Math.atan2(0.5, -1));
    expect(screenHeading(1, 1)).toBeCloseTo(Math.PI / 2);
  });
});
