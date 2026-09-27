import { describe, expect, it } from "vitest";
import { Graphics } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import type { CreepSnapshot } from "@/game/combat/rules";
import { readYard } from "@/game/yard/yardModel";
import {
  FACING_HOLD_TICKS,
  TESLA_CHARGE_END,
  TESLA_IDLE,
  TESLA_LOOP_END,
  TowerFx,
  bearingDegrees,
  facingCell,
  laserCell,
  muzzleOf,
  teslaTick,
  towersOf,
  wrapDegrees,
  type TowerInfo,
} from "./towerFx";

/**
 * The tower effects' arithmetic (issue #67): the Flash bearing-to-cell rule
 * per tower class, the Tesla Tower's charge / loop / wind-down, the muzzle
 * heights, and the effects object turning a gun through a stub host.
 */

describe("bearings", () => {
  it("measures from the tower's origin plus (35, 35), +x being 0 and +y being 90", () => {
    const tower = { x: 0, y: 0 };
    expect(bearingDegrees(tower, { x: 135, y: 35 })).toBe(0);
    expect(bearingDegrees(tower, { x: 35, y: 135 })).toBeCloseTo(90);
    expect(bearingDegrees(tower, { x: -65, y: 35 })).toBeCloseTo(180);
    expect(bearingDegrees(tower, { x: 35, y: -65 })).toBeCloseTo(270);
  });

  it("folds degrees into [0, 360)", () => {
    expect(wrapDegrees(-10)).toBe(350);
    expect(wrapDegrees(370)).toBe(10);
    expect(wrapDegrees(360)).toBe(0);
  });
});

describe("facing cells", () => {
  it("gives the Sniper Tower a cell every 11.25 degrees, clamped to its 30-cell strip", () => {
    expect(facingCell(21, 0, 30)).toBe(0);
    expect(facingCell(21, 11.24, 30)).toBe(0);
    expect(facingCell(21, 11.25, 30)).toBe(1);
    expect(facingCell(21, 90, 30)).toBe(8);
    expect(facingCell(21, 180, 30)).toBe(16);
    // 350 / 11.25 is cell 31 of a strip that stops at 29.
    expect(facingCell(21, 350, 30)).toBe(29);
  });

  it("gives the Aerial Defense Tower 12 degrees a cell and the Railgun the same plus 30", () => {
    expect(facingCell(115, 0, 32)).toBe(0);
    expect(facingCell(115, 90, 32)).toBe(7);
    expect(facingCell(118, 0, 32)).toBe(2);
    expect(facingCell(118, 90, 32)).toBe(10);
    // 350 + 30 wraps to 20 degrees: cell 1, as `BUILDING118.as:64-67` folds it.
    expect(facingCell(118, 350, 32)).toBe(1);
  });

  it("has no cell for a tower with no turning gun", () => {
    expect(facingCell(20, 90, 0)).toBeNull();
    expect(facingCell(25, 90, 55)).toBeNull();
    expect(facingCell(21, 90, 0)).toBeNull();
  });

  it("follows the laser beam's screen angle less 25 degrees, 6.66 a cell", () => {
    expect(laserCell(25, 54)).toBe(0);
    expect(laserCell(25 + 6.66, 54)).toBe(1);
    expect(laserCell(0, 54)).toBe(Math.trunc(335 / 6.66));
    expect(laserCell(24.9, 54)).toBe(53);
  });
});

describe("the Tesla timeline", () => {
  it("charges a cell a tick to 32, loops 32-40 while firing, then winds down every second tick", () => {
    let state = teslaTick(TESLA_IDLE, false);
    expect(state).toEqual(TESLA_IDLE);

    state = teslaTick(state, true);
    expect(state.phase).toBe("charge");
    expect(state.cell).toBe(1);
    for (let tick = 1; tick < TESLA_CHARGE_END; tick += 1) state = teslaTick(state, true);
    expect(state.phase).toBe("loop");
    expect(state.cell).toBe(TESLA_CHARGE_END);

    const seen = new Set<number>();
    for (let tick = 0; tick < 20; tick += 1) {
      state = teslaTick(state, true);
      seen.add(state.cell);
    }
    expect(Math.min(...seen)).toBe(TESLA_CHARGE_END);
    expect(Math.max(...seen)).toBe(TESLA_LOOP_END - 1);

    state = teslaTick(state, false);
    expect(state.phase).toBe("wind");
    const from = state.cell;
    state = teslaTick(state, false);
    expect(state.cell).toBe(from);
    state = teslaTick(state, false);
    expect(state.cell).toBe(from + 1);
    for (let tick = 0; tick < 60; tick += 1) state = teslaTick(state, false);
    expect(state).toEqual(TESLA_IDLE);
  });
});

describe("muzzles", () => {
  it("leaves from the class's `_top` above the origin", () => {
    expect(muzzleOf(21, 100, 200)).toEqual({ x: 100, y: 170 });
    expect(muzzleOf(20, 100, 200)).toEqual({ x: 100, y: 196 });
    expect(muzzleOf(118, 100, 200)).toEqual({ x: 100, y: 215 });
    expect(muzzleOf(999, 100, 200)).toEqual({ x: 100, y: 170 });
  });
});

/* ── The effects over a yard ────────────────────────────────────────────── */

const yardOf = (type: number): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "3502",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: { "1": { id: 1, t: type, l: 1, X: 0, Y: 0 } },
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 0, r3: 0, r4: 0 },
    attackid: 77,
    storedata: {},
  }) as unknown as BaseLoadResponse;

const creepAt = (ix: number, iy: number): CreepSnapshot => ({
  id: 9,
  monsterId: "C1",
  level: 1,
  champion: false,
  friendly: false,
  ix,
  iy,
  hp: 100,
  maxHp: 100,
  flying: false,
  state: "walking",
  targetBuilding: -1,
  targetCreep: -1,
});

describe("towersOf", () => {
  it("lists a yard's towers with the cells of their gun strip", () => {
    const sniper = towersOf(readYard(yardOf(21)));
    expect(sniper).toHaveLength(1);
    expect(sniper[0]?.type).toBe(21);
    expect(sniper[0]?.frames).toBe(30);
    expect(towersOf(readYard(yardOf(23)))[0]?.frames).toBe(54);
    expect(towersOf(readYard(yardOf(25)))[0]?.frames).toBe(55);
    // The Cannon Tower has stats but no animated layer.
    expect(towersOf(readYard(yardOf(20)))[0]?.frames).toBe(0);
    // A trap is not a tower.
    expect(towersOf(readYard(yardOf(24)))).toHaveLength(0);
  });
});

/** How many drawing instructions the graphics holds this frame. */
const drawn = (graphics: Graphics): number =>
  (graphics.context as unknown as { instructions: unknown[] }).instructions.length;

const setUp = (type: number) => {
  const yard = readYard(yardOf(type));
  const frames = new Map<number, number>();
  const graphics = new Graphics();
  const info: TowerInfo[] = towersOf(yard);
  const fx = new TowerFx(
    graphics,
    info,
    { setAnimFrame: (id, _layer, frame) => frames.set(id, frame) },
    { x: yard.bounds.originX, y: yard.bounds.originY },
  );
  return { yard, frames, graphics, fx };
};

describe("TowerFx", () => {
  it("turns a sniper toward the creep it shot, keeps following it, and holds after the shot is old", () => {
    const { frames, fx } = setUp(21);
    // Due south in cartesian terms, from the tower's (35, 35) centre.
    const south = creepAt(35, 235);
    fx.onShot({ tick: 10, towerId: 1, creepId: 9, ix: south.ix, iy: south.iy }, south);
    fx.update(10, () => south);
    expect(frames.get(1)).toBe(8);
    expect(fx.cellOf(1)).toBe(8);

    // The creep walks round to the east: the gun follows without another shot.
    const east = creepAt(235, 35);
    fx.update(20, () => east);
    expect(frames.get(1)).toBe(0);

    // Past the hold the gun stays where it was, whatever the creep does.
    fx.update(10 + FACING_HOLD_TICKS + 1, () => south);
    expect(frames.get(1)).toBe(0);
    fx.destroy();
  });

  it("does not turn a gun the yard's tower has no strip for", () => {
    const { frames, fx } = setUp(20);
    const target = creepAt(35, 235);
    fx.onShot({ tick: 1, towerId: 1, creepId: 9, ix: target.ix, iy: target.iy }, target);
    fx.update(1, () => target);
    expect(frames.size).toBe(0);
    fx.destroy();
  });

  it("charges the Tesla's strip after its first shot and winds it down once the shots stop", () => {
    const { frames, fx } = setUp(25);
    const target = creepAt(35, 235);
    fx.onShot({ tick: 0, towerId: 1, creepId: 9, ix: target.ix, iy: target.iy }, target);
    fx.update(0, () => target);
    fx.update(10, () => target);
    expect(frames.get(1)).toBe(10);
    fx.update(40, () => target);
    const looping = frames.get(1) ?? -1;
    expect(looping).toBeGreaterThanOrEqual(TESLA_CHARGE_END);
    expect(looping).toBeLessThan(TESLA_LOOP_END);
    // Long after the last shot the wind-down has run out and the cell is 0.
    fx.update(200, () => undefined);
    expect(frames.get(1)).toBe(0);
    fx.destroy();
  });

  it("draws a shot's projectile for a while and nothing once everything has landed", () => {
    const { graphics, fx } = setUp(21);
    const target = creepAt(35, 235);
    fx.update(0, () => undefined);
    expect(drawn(graphics)).toBe(0);
    fx.onShot({ tick: 1, towerId: 1, creepId: 9, ix: target.ix, iy: target.iy }, target);
    fx.update(1, () => target);
    expect(drawn(graphics)).toBeGreaterThan(0);
    // Half the sniper's speed of 10 a tick over some 240 px: still flying.
    fx.update(20, () => target);
    expect(drawn(graphics)).toBeGreaterThan(0);
    fx.update(500, () => target);
    expect(drawn(graphics)).toBe(0);
    fx.destroy();
  });

  it("ignores a shot from a building it does not know", () => {
    const { frames, graphics, fx } = setUp(21);
    fx.onShot({ tick: 1, towerId: 77, creepId: 9, ix: 0, iy: 0 }, undefined);
    fx.update(1, () => undefined);
    expect(frames.size).toBe(0);
    expect(drawn(graphics)).toBe(0);
    fx.destroy();
  });
});

describe("TowerFx landings (#77)", () => {
  const landingSetUp = (type: number) => {
    const yard = readYard(yardOf(type));
    const landings: Array<{ key: number; tick: number }> = [];
    const fx = new TowerFx(
      new Graphics(),
      towersOf(yard),
      { setAnimFrame: () => {}, landed: (key, tick) => landings.push({ key, tick }) },
      { x: yard.bounds.originX, y: yard.bounds.originY },
    );
    return { fx, landings };
  };

  /** Fires at tick 5 and runs to tick 400 in frames of `ticksPerFrame`; the landings. */
  const flight = (type: number, ticksPerFrame: number, firstFrameTick: number) => {
    const { fx, landings } = landingSetUp(type);
    const target = creepAt(35, 235);
    fx.update(0, () => target);
    const key = fx.onShot({ tick: 5, towerId: 1, creepId: 9, ix: target.ix, iy: target.iy }, target);
    for (let tick = firstFrameTick; tick <= 400; tick += ticksPerFrame) fx.update(tick, () => target);
    fx.destroy();
    return { key, landings };
  };

  it("gives a sniper's, a cannon's and a flak tower's shot a key, reported once when it lands", () => {
    for (const type of [20, 21, 115]) {
      const { key, landings } = flight(type, 1, 5);
      expect(key).not.toBeNull();
      expect(landings).toHaveLength(1);
      expect(landings[0]?.key).toBe(key);
      // It flew: not on the shot tick, and well inside the run.
      expect(landings[0]?.tick).toBeGreaterThan(5);
      expect(landings[0]?.tick).toBeLessThan(400);
    }
  });

  it("gives the laser, the tesla and the railgun no key: they hurt at once", () => {
    for (const type of [23, 25, 118]) {
      const { key, landings } = flight(type, 1, 5);
      expect(key).toBeNull();
      expect(landings).toHaveLength(0);
    }
  });

  it("lands a bullet on the same tick whether the frames are one tick, two (2x), or seven long", () => {
    const oneTick = flight(21, 1, 5).landings[0]?.tick;
    expect(oneTick).toBeDefined();
    // A frame that already runs past the shot tick flies it only from its own tick.
    expect(flight(21, 2, 8).landings[0]?.tick).toBe(oneTick);
    expect(flight(21, 7, 12).landings[0]?.tick).toBe(oneTick);
  });

  it("keys every bullet apart when a tower fires again before the first lands", () => {
    const { fx, landings } = landingSetUp(21);
    const target = creepAt(35, 235);
    const first = fx.onShot({ tick: 1, towerId: 1, creepId: 9, ix: target.ix, iy: target.iy }, target);
    const second = fx.onShot({ tick: 3, towerId: 1, creepId: 9, ix: target.ix, iy: target.iy }, target);
    expect(first).not.toBe(second);
    for (let tick = 1; tick <= 300; tick += 1) fx.update(tick, () => target);
    expect(landings.map((landing) => landing.key)).toEqual([first, second]);
    const [a, b] = landings;
    expect((b?.tick ?? 0) - (a?.tick ?? 0)).toBe(2);
    fx.destroy();
  });

  it("reads each tower's splash radius off its stats", () => {
    expect(landingSetUp(21).fx.splashOf(1)).toBe(0);
    expect(landingSetUp(20).fx.splashOf(1)).toBe(30);
    expect(landingSetUp(20).fx.splashOf(77)).toBe(0);
  });
});
