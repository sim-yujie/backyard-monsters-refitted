import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { BEHAVIOUR_SPEED, championStat, monsterTickSpeed } from "@/game/combat/rules";
import fixture from "../../../test/fixtures/baseload-sandbox-yard.json";
import { readYard } from "./yardModel";
import {
  cageArea,
  chamberDoor,
  CHAMPION_CHAMBER_TYPE,
  championTrips,
  championWalkerKey,
  freezeTrip,
  thawTrip,
  TRIP_SPEED_FACTOR,
  walkerGone,
  type TripRoute,
  CHAMPION_WANDER_ODDS,
  CREEP_WANDER_ODDS,
  EMPTY_LIFE,
  fellPens,
  holdBack,
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

describe("holdBack (#228)", () => {
  const life = lifeWith({
    groups: [
      { id: "C1", level: 1, count: 15 },
      { id: "C2", level: 2, count: 4 },
    ],
  });

  it("cuts a held type to its cap, the lowest of its holds, and drops it at none", () => {
    expect(holdBack(life, [{ monster: "C1", cap: 10 }]).groups).toEqual([
      { id: "C1", level: 1, count: 10 },
      { id: "C2", level: 2, count: 4 },
    ]);
    expect(holdBack(life, [{ monster: "C1", cap: 10 }, { monster: "C1", cap: 14 }]).groups[0]?.count).toBe(10);
    expect(holdBack(life, [{ monster: "C1", cap: -3 }]).groups).toEqual([{ id: "C2", level: 2, count: 4 }]);
  });

  it("is the same life when nothing is over its cap", () => {
    expect(holdBack(life, [])).toBe(life);
    expect(holdBack(life, [{ monster: "C1", cap: 15 }, { monster: "C9", cap: 0 }])).toBe(life);
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
    trip: null,
    leaving: false,
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

  it("gives a champion that evolved its new sheet level, where it stands (#311)", () => {
    const cage = { id: 4, x: 100, y: 200 };
    const at = (level: number) => lifeWith({ cage, champions: [{ id: "G1", level, sheetLevel: level }] });
    const first = reconcileWalkers(new Map(), walkerSpecs(at(2), seeded()), seeded());
    const before = first.get("c:4:G1");
    if (!before) throw new Error("no champion");
    before.x += 3;
    const second = reconcileWalkers(first, walkerSpecs(at(3), seeded()), seeded());
    const after = second.get("c:4:G1");
    expect(after?.sheetLevel).toBe(3);
    expect(after && { x: after.x, y: after.y, area: after.area }).toEqual({
      x: before.x,
      y: before.y,
      area: before.area,
    });
  });

  it("faces a step the way the isometric projection draws it", () => {
    // +x in yard units runs down-right on screen, +y down-left.
    expect(screenHeading(1, 0)).toBeCloseTo(Math.atan2(0.5, 1));
    expect(screenHeading(0, 1)).toBeCloseTo(Math.atan2(0.5, -1));
    expect(screenHeading(1, 1)).toBeCloseTo(Math.PI / 2);
  });
});

describe("trips to and from the Champion Chamber (#314)", () => {
  const cage = { id: 7, x: 100, y: 200 };
  const chamber = { x: 400, y: 400, width: 60, height: 60 };
  const g1 = { id: "G1", level: 2, sheetLevel: 2 };
  const caged = lifeWith({ cage, chamber, champions: [g1] });
  const frozen = lifeWith({ cage, chamber, frozen: ["G1"] });
  const straight: TripRoute = (from, to) => [from, to];

  const cageWalker = (): Walker => {
    const walkers = reconcileWalkers(new Map(), walkerSpecs(caged, fixed(0.5)), fixed(0.5));
    const walker = walkers.get(championWalkerKey(cage.id, "G1"));
    if (!walker) throw new Error("no champion");
    return walker;
  };

  it("reads frozen champions and the Chamber off the save", () => {
    const yard = readYard(save);
    const champion = [{ t: 1, l: 2, status: 1 }, { t: 3, l: 1, status: 0 }, { t: 4, l: 1, status: 2 }];
    const life = yardLifeOf({ ...save, champion } as unknown as BaseLoadResponse, yard);
    expect(life.frozen).toEqual(["G1"]);
    expect(life.champions.map((one) => one.id)).toEqual(["G3"]);
    expect(yardLifeOf({ ...save, champion } as unknown as BaseLoadResponse, yard, "attack").frozen).toEqual([]);
  });

  it("finds the Chamber's footprint among the buildings", () => {
    const yard = readYard(save);
    const building = { ...yard.buildings[0]!, type: CHAMPION_CHAMBER_TYPE, x: 10, y: 20 };
    const life = yardLifeOf(save, { ...yard, buildings: [building] });
    expect(life.chamber).toEqual({ x: 10, y: 20, width: building.footprint[0], height: building.footprint[1] });
  });

  it("tells a freeze and a thaw from one life to the next", () => {
    expect(championTrips(caged, frozen)).toEqual({ freezing: ["G1"], thawing: [] });
    expect(championTrips(frozen, caged)).toEqual({ freezing: [], thawing: ["G1"] });
    expect(championTrips(caged, caged)).toEqual({ freezing: [], thawing: [] });
  });

  it("walks nobody on a fresh yard, another cage, or a yard with no Chamber", () => {
    expect(championTrips(EMPTY_LIFE, frozen)).toEqual({ freezing: [], thawing: [] });
    expect(championTrips(caged, { ...frozen, cage: { ...cage, id: 8 } })).toEqual({ freezing: [], thawing: [] });
    expect(championTrips(caged, { ...frozen, chamber: null })).toEqual({ freezing: [], thawing: [] });
  });

  it("does not count a juiced champion as frozen", () => {
    expect(championTrips(caged, lifeWith({ cage, chamber }))).toEqual({ freezing: [], thawing: [] });
  });

  it("goes in and out by the Chamber's front corner", () => {
    expect(chamberDoor(chamber)).toEqual({ x: 460, y: 460 });
  });

  it("walks a frozen champion from where it stands to the door at its heading-home speed, then is gone", () => {
    const walker = cageWalker();
    const start = { x: walker.x, y: walker.y };
    expect(freezeTrip(walker, chamberDoor(chamber), straight)).toBe(true);
    expect(walker.leaving).toBe(true);
    expect(walker.moving).toBe(true);
    stepWalker(walker, fixed(0.5));
    const stepped = Math.hypot(walker.x - start.x, walker.y - start.y);
    expect(stepped).toBeCloseTo(walker.speed * TRIP_SPEED_FACTOR);
    expect(TRIP_SPEED_FACTOR).toBeCloseTo((BEHAVIOUR_SPEED["housing"] ?? 0) / (BEHAVIOUR_SPEED["pen"] ?? 1));
    expect(walker.heading).toBeCloseTo(screenHeading(460 - start.x, 460 - start.y));
    expect(walkerGone(walker)).toBe(false);
    for (let tick = 0; tick < 10_000 && walker.trip; tick++) stepWalker(walker, fixed(0.5));
    expect(walker).toMatchObject({ x: 460, y: 460, trip: null });
    expect(walkerGone(walker)).toBe(true);
  });

  it("follows every waypoint of a route round the buildings", () => {
    const walker = cageWalker();
    const corner = { x: walker.x, y: 460 };
    freezeTrip(walker, chamberDoor(chamber), (from, to) => [from, corner, to]);
    // Down the first leg x never changes.
    while (walker.trip && walker.trip.length === 2) {
      stepWalker(walker, fixed(0.5));
      if (walker.trip.length === 2) expect(walker.x).toBe(corner.x);
    }
    // Round the corner: along the second leg, y stays at the door's.
    expect(walker.y).toBe(460);
    expect(walker.x).toBeGreaterThanOrEqual(corner.x);
    for (let tick = 0; tick < 10_000 && walker.trip; tick++) stepWalker(walker, fixed(0.5));
    expect(walker).toMatchObject({ x: 460, y: 460 });
  });

  it("keeps a champion on its way in though the save no longer has it, until it is there", () => {
    const walker = cageWalker();
    freezeTrip(walker, chamberDoor(chamber), straight);
    const current = new Map([[walker.key, walker]]);
    const during = reconcileWalkers(current, walkerSpecs(frozen, fixed(0.5)), fixed(0.5));
    expect(during.get(walker.key)).toBe(walker);
    walker.trip = null;
    expect(reconcileWalkers(during, walkerSpecs(frozen, fixed(0.5)), fixed(0.5)).size).toBe(0);
  });

  it("snaps when there is no route", () => {
    const walker = cageWalker();
    expect(freezeTrip(walker, chamberDoor(chamber), () => null)).toBe(false);
    expect(walker.trip).toBeNull();
    expect(walker.leaving).toBe(false);
  });

  it("brings a thawed champion out of the door to its cage spot, then paces as before", () => {
    const walker = cageWalker();
    const home = { x: walker.x, y: walker.y };
    expect(thawTrip(walker, chamberDoor(chamber), straight)).toBe(true);
    expect(walker).toMatchObject({ x: 460, y: 460, leaving: false, moving: true });
    for (let tick = 0; tick < 10_000 && walker.trip; tick++) stepWalker(walker, fixed(0.5));
    expect(walker.x).toBeCloseTo(home.x);
    expect(walker.y).toBeCloseTo(home.y);
    expect(walker.moving).toBe(false);
    expect(walkerGone(walker)).toBe(false);
    // Kept by the next read of the yard with the cage spot it walked to.
    const kept = reconcileWalkers(new Map([[walker.key, walker]]), walkerSpecs(caged, fixed(0.5)), fixed(0.5));
    expect(kept.get(walker.key)).toMatchObject({ x: home.x, y: home.y, moving: false });
  });

  it("does not let the cage re-aim a champion on its way out", () => {
    const walker = cageWalker();
    thawTrip(walker, chamberDoor(chamber), straight);
    reconcileWalkers(new Map([[walker.key, walker]]), walkerSpecs(caged, fixed(0.9)), fixed(0.9));
    expect(walker.trip).not.toBeNull();
    expect(walker.x).toBe(460);
  });

  it("turns a champion on its way in round for its cage when it is thawed again", () => {
    const walker = cageWalker();
    freezeTrip(walker, chamberDoor(chamber), straight);
    for (let tick = 0; tick < 5; tick++) stepWalker(walker, fixed(0.5));
    const midway = { x: walker.x, y: walker.y };
    expect(thawTrip(walker, chamberDoor(chamber), straight)).toBe(true);
    expect(walker).toMatchObject({ x: midway.x, y: midway.y, leaving: false });
    const area = walker.area;
    expect(walker.targetX).toBeCloseTo(area.x + area.width / 2);
  });

  it("puts a thawed champion straight on its spot when there is no route", () => {
    const walker = cageWalker();
    const home = { x: walker.x, y: walker.y };
    expect(thawTrip(walker, chamberDoor(chamber), () => null)).toBe(false);
    expect(walker).toMatchObject({ x: home.x, y: home.y, trip: null, leaving: false });
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
