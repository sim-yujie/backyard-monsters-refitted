import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { BEHAVIOUR_SPEED, championStat, monsterTickSpeed } from "@/game/combat/rules";
import fixture from "../../../test/fixtures/baseload-sandbox-yard.json";
import { readYard } from "./yardModel";
import {
  cageArea,
  CHAMPION_WANDER_ODDS,
  CREEP_WANDER_ODDS,
  EMPTY_LIFE,
  fellPens,
  jobSpot,
  MAX_HOUSED_DRAWN,
  PEN_SETTLE_TICKS,
  penArea,
  reconcileWalkers,
  reconcileWorkers,
  sampleArmy,
  screenHeading,
  stepWalker,
  stepWorker,
  walkerSpecs,
  WORKER_MOTION,
  yardLifeOf,
  type LifeGroup,
  type Walker,
  type Worker,
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

const identity = (x: number, y: number) => ({ x, y });

const lifeWith = (overrides: Partial<YardLife>): YardLife => ({
  ...EMPTY_LIFE,
  plot: { width: 1000, height: 1000 },
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

  it("takes every standing Housing building as a pen and the cage", () => {
    expect(life.pens.map((pen) => pen.id)).toEqual([82, 584, 585, 586]);
    expect(life.cage).toEqual({ id: 51, x: 135, y: -25 });
  });

  it("keeps the active champions, Krallen's sheet at its power level", () => {
    expect(life.champions).toEqual([
      { id: "G5", level: 5, sheetLevel: 2 },
      { id: "G3", level: 6, sheetLevel: 6 },
    ]);
  });

  it("counts the yard's workers and its running jobs", () => {
    expect(life.workers).toBe(5);
    expect(life.jobs).toEqual([]);
    expect(life.hardHat).toBe(false);
  });

  it("reads ground monsters too, which name no movement (#229)", () => {
    const pokeys = {
      ...save,
      monsters: { ...save.monsters, housed: { C1: 15, C2: 3, C14: 1, NOPE: 4, C3: 0 } },
    } as BaseLoadResponse;
    expect(yardLifeOf(pokeys, yard).groups.map((group) => [group.id, group.count])).toEqual([
      ["C1", 15],
      ["C2", 3],
      ["C14", 1],
    ]);
  });

  it("leaves out a frozen or juiced champion, and a pen at zero health", () => {
    const other = {
      ...save,
      champion: [
        { t: 1, l: 2, hp: 100, fb: 0, fd: 0, ft: 0, pl: 0, status: 1 },
        { t: 2, l: 2, hp: 100, fb: 0, fd: 0, ft: 0, pl: 0, status: 2 },
      ],
      buildinghealthdata: { ...(save.buildinghealthdata ?? {}), "82": 0 },
    } as BaseLoadResponse;
    const read = yardLifeOf(other, readYard(other));
    expect(read.champions).toEqual([]);
    expect(read.pens.map((pen) => pen.id)).toEqual([584, 585, 586]);
  });

  it("lists a running upgrade as a job and Sharper Tools as the hard hat", () => {
    const busy = {
      ...save,
      currenttime: 1_000,
      savetime: 1_000,
      buildingdata: { ...save.buildingdata, "0": { ...save.buildingdata?.["0"], cU: 600 } },
      storedata: { ...save.storedata, BST: { q: 1, e: 5_000 } },
    } as BaseLoadResponse;
    const read = yardLifeOf(busy, readYard(busy));
    expect(read.jobs).toEqual([{ id: 0, x: 5, y: -15, width: 130, height: 130 }]);
    expect(read.hardHat).toBe(true);
  });
});

describe("yardLifeOf on somebody else's yard (#159)", () => {
  const busy = {
    ...save,
    currenttime: 1_000,
    savetime: 1_000,
    buildingdata: { ...save.buildingdata, "0": { ...save.buildingdata?.["0"], cU: 600 } },
  } as BaseLoadResponse;
  const yard = readYard(busy, { foreign: true });

  it("a visit shows the defender's pens, champions and workers, as its own yard would", () => {
    const own = yardLifeOf(busy, readYard(busy));
    const visit = yardLifeOf(busy, yard, "visit");
    expect(visit.groups).toEqual(own.groups);
    expect(visit.pens).toEqual(own.pens);
    expect(visit.champions).toEqual(own.champions);
    expect(visit.champions).toHaveLength(2);
    expect(visit.workers).toBe(5);
    expect(visit.jobs).toHaveLength(1);
  });

  it("an attack keeps the pens and workers but no caged champion: none defends", () => {
    const attack = yardLifeOf(busy, yard, "attack");
    expect(attack.groups).toEqual(yardLifeOf(busy, yard, "visit").groups);
    expect(attack.pens.map((pen) => pen.id)).toEqual([82, 584, 585, 586]);
    expect(attack.champions).toEqual([]);
    expect(attack.cage).not.toBeNull();
    expect(walkerSpecs(attack, seeded()).some((spec) => spec.champion)).toBe(false);
    expect(attack.workers).toBe(5);
  });

  it("a wild monster camp has no workers, visited or attacked (`QUEUE.as:56`)", () => {
    const camp = { ...busy, type: "tribe" } as BaseLoadResponse;
    for (const view of ["visit", "attack"] as const) {
      const read = yardLifeOf(camp, readYard(camp), view);
      expect(read.workers).toBe(0);
      expect(read.jobs).toEqual([]);
      expect(read.pens).toHaveLength(4);
    }
  });

  it("reads the defender's own academy for the walking speed", () => {
    const slow = { ...busy, academy: {} } as BaseLoadResponse;
    expect(yardLifeOf(slow, yard, "visit").groups.map((group) => group.level)).toEqual([1, 1]);
  });
});

describe("fellPens", () => {
  const life = lifeWith({
    groups: [{ id: "C1", level: 1, count: 6 }],
    pens: [
      { id: 7, x: 0, y: 0 },
      { id: 9, x: 200, y: 0 },
      { id: 11, x: 400, y: 0 },
    ],
  });

  it("is the same life when no standing pen is among the destroyed", () => {
    expect(fellPens(life, [])).toBe(life);
    expect(fellPens(life, [1, 2, 3])).toBe(life);
    const once = fellPens(life, [9]);
    expect(fellPens(once, [9, 1])).toBe(once);
  });

  it("takes a fallen pen's monsters off and leaves every other walker's key", () => {
    const before = walkerSpecs(life, seeded()).map((spec) => spec.key);
    const after = walkerSpecs(fellPens(life, [9, 40]), seeded()).map((spec) => spec.key);
    expect(before).toHaveLength(6);
    expect(after).toEqual(before.filter((key) => !key.startsWith("m:9:")));
    expect(after).toHaveLength(4);
  });

  it("a kept walker stays where it stood", () => {
    const random = seeded(3);
    const walkers = reconcileWalkers(new Map(), walkerSpecs(life, random), random);
    const kept = walkers.get("m:7:C1:0");
    const next = reconcileWalkers(walkers, walkerSpecs(fellPens(life, [9]), random), random);
    expect(next.get("m:7:C1:0")).toBe(kept);
    expect(next.has("m:9:C1:0")).toBe(false);
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

  it("puts a cage's area 40 to 80 in from a centre at most 30 units off the corner", () => {
    for (const value of [0, 0.5, 0.999]) {
      const area = cageArea(pen, fixed(value));
      expect(area.width).toBe(40);
      expect(Math.abs(area.x - 140)).toBeLessThanOrEqual(30);
      expect(Math.abs(area.y - 240)).toBeLessThanOrEqual(30);
    }
  });

  it("deals the sample round the pens and paces them at a quarter speed", () => {
    const life = lifeWith({
      groups: [{ id: "C1", level: 2, count: 5 }],
      pens: [pen, { id: 9, x: 0, y: 0 }],
    });
    const specs = walkerSpecs(life, seeded());
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

  it("draws no monsters without a pen, and no champion without a cage", () => {
    const life = lifeWith({
      groups: [{ id: "C1", level: 1, count: 5 }],
      champions: [{ id: "G1", level: 2, sheetLevel: 2 }],
    });
    expect(walkerSpecs(life, seeded())).toEqual([]);
  });

  it("puts each champion in the cage at a quarter of its speed", () => {
    const life = lifeWith({ cage: pen, champions: [{ id: "G1", level: 2, sheetLevel: 2 }] });
    const [spec] = walkerSpecs(life, seeded());
    expect(spec?.key).toBe("c:7:G1");
    expect(spec?.champion).toBe(true);
    expect(spec?.sheetLevel).toBe(2);
    expect(spec?.odds).toBe(CHAMPION_WANDER_ODDS);
    expect(spec?.speed).toBeCloseTo((championStat("G1", "speed", 2) / 4) * 0.5);
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
    const first = reconcileWalkers(new Map(), walkerSpecs(life, seeded()), seeded());
    const walker = first.get("m:7:C1:0");
    if (!walker) throw new Error("no walker");
    walker.x = 155;
    const fewer = lifeWith({ groups: [{ id: "C1", level: 1, count: 1 }], pens: [pen] });
    const second = reconcileWalkers(first, walkerSpecs(fewer, seeded()), seeded());
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

describe("workers", () => {
  const job = { id: 3, x: 100, y: 100, width: 40, height: 40 };

  it("stands a worker at the edge of the footprint nearest its approach", () => {
    expect(jobSpot(job, 0, 120)).toEqual({ x: 94, y: 120 });
    expect(jobSpot(job, 300, 300)).toEqual({ x: 146, y: 146 });
    // From inside, out through the nearest side.
    expect(jobSpot(job, 138, 120)).toEqual({ x: 146, y: 120 });
  });

  it("makes one worker per worker the yard has, idle and off every footprint", () => {
    const footprints = [{ x: -500, y: -500, width: 1000, height: 400 }];
    const crew = reconcileWorkers(
      [],
      lifeWith({ workers: 3, footprints }),
      identity,
      identity,
      seeded(4),
      true,
    );
    expect(crew).toHaveLength(3);
    for (const worker of crew) {
      expect(worker.job).toBeNull();
      expect(worker.y).toBeGreaterThan(-100 + 4);
    }
  });

  it("sends the nearest free worker to a new job, and on a first read puts it there", () => {
    const crew: Worker[] = [
      { index: 0, x: 0, y: 0, targetX: 0, targetY: 0, rotation: 0, speed: 0, job: null },
      { index: 1, x: 90, y: 120, targetX: 90, targetY: 120, rotation: 0, speed: 0, job: null },
    ];
    const life = lifeWith({ workers: 2, jobs: [job] });
    const walking = reconcileWorkers(crew, life, identity, identity, seeded(), false);
    expect(walking[1]?.job).toBe(3);
    expect(walking[1]?.x).toBe(90);
    expect(walking[1]?.targetX).toBe(94);
    expect(walking[0]?.job).toBeNull();

    const fresh = reconcileWorkers(
      crew.map((worker) => ({ ...worker, job: null })),
      life,
      identity,
      identity,
      seeded(),
      true,
    );
    expect(fresh[1]).toMatchObject({ job: 3, x: 94, y: 120 });
  });

  it("lets a worker go when its job ends, standing where it was", () => {
    const crew: Worker[] = [
      { index: 0, x: 94, y: 120, targetX: 94, targetY: 120, rotation: 0, speed: 0, job: 3 },
    ];
    const life = lifeWith({ workers: 1 });
    const next = reconcileWorkers(crew, life, identity, identity, seeded(), false);
    expect(next[0]).toMatchObject({ job: null, x: 94, y: 120 });
  });

  it("walks a busy worker up to 2 px a frame, turning toward the job, and stops there", () => {
    const worker: Worker = {
      index: 0,
      x: 0,
      y: 0,
      targetX: 200,
      targetY: 0,
      rotation: 90,
      speed: 0,
      job: 3,
    };
    stepWorker(worker);
    expect(worker.speed).toBeCloseTo(WORKER_MOTION.accelerate);
    expect(worker.rotation).toBeCloseTo(90 - 90 / 3);
    let top = 0;
    for (let frame = 0; frame < 600; frame++) {
      stepWorker(worker);
      top = Math.max(top, worker.speed);
    }
    expect(top).toBeLessThanOrEqual(WORKER_MOTION.busySpeed + WORKER_MOTION.accelerate);
    expect(worker.speed).toBe(0);
    expect(Math.hypot(worker.x - 200, worker.y)).toBeLessThan(WORKER_MOTION.near + 25);
  });

  it("leaves a worker with nowhere to go standing", () => {
    const worker: Worker = {
      index: 0,
      x: 5,
      y: 5,
      targetX: 5,
      targetY: 5,
      rotation: 30,
      speed: 0,
      job: null,
    };
    stepWorker(worker);
    expect(worker).toMatchObject({ x: 5, y: 5, rotation: 30, speed: 0 });
  });
});
