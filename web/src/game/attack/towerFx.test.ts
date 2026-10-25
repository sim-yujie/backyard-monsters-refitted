import { describe, expect, it } from "vitest";
import { Container, Graphics, Texture, TextureSource, TilingSprite } from "pixi.js";
import type { Sprite } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import type { CreepSnapshot } from "@/game/combat/rules";
import { readYard } from "@/game/yard/yardModel";
import {
  FACING_HOLD_TICKS,
  LASER_IGNITE_TICKS,
  LASER_REACH_TICKS,
  RAIL_CHARGE_TICKS,
  RAIL_LIT_TICKS,
  RAIL_SLUG_TICKS,
  RECOIL_TICKS,
  TESLA_CHARGE_END,
  TESLA_IDLE,
  TESLA_LOOP_END,
  TowerFx,
  bearingDegrees,
  AIM_WATCH_MARGIN,
  CATCH_UP_DEGREES_PER_TICK,
  cellHeading,
  facingCell,
  laserCell,
  laserReach,
  muzzleOf,
  railCharge,
  railFade,
  railSlugAlong,
  recoilKick,
  stepDegrees,
  teslaTick,
  TRACER_MAX,
  TRACER_MIN,
  TRACER_TICKS,
  tracerLength,
  FLAK_ARC_MAX,
  FLAK_VOLLEY_FULL,
  FLAK_VOLLEY_LOW,
  flakLift,
  SIGHT_LATE,
  SIGHT_TICKS,
  sightStrength,
  TURN_DEGREES_PER_TICK,
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

  it("charges the Tesla's strip on the engine's charge, a cell a frame, and winds it down after the zaps (#266)", () => {
    const { frames, fx } = setUp(25);
    const target = creepAt(35, 235);
    fx.update(0, () => target);
    fx.update(9, () => target);
    // Idle without a charge, whatever the clock does.
    expect(frames.get(1) ?? 0).toBe(0);
    fx.onCharge(1, 10);
    fx.update(10, () => target);
    expect(frames.get(1)).toBe(1);
    // A frame is two ticks: ten ticks on, five cells on.
    fx.update(20, () => target);
    expect(frames.get(1)).toBe(6);
    // The charge is done 32 frames in; the zaps keep the loop going.
    for (let tick = 74; tick <= 120; tick += 8) {
      fx.onShot({ tick, towerId: 1, creepId: 9, ix: target.ix, iy: target.iy }, target);
      fx.update(tick, () => target);
      const looping = frames.get(1) ?? -1;
      expect(looping).toBeGreaterThanOrEqual(TESLA_CHARGE_END);
      expect(looping).toBeLessThan(TESLA_LOOP_END);
    }
    // Long after the last zap the wind-down has run out and the cell is 0.
    fx.update(300, () => undefined);
    expect(frames.get(1)).toBe(0);
    fx.destroy();
  });

  it("glows on the Tesla's coil while it charges and nothing once it is idle", () => {
    const { graphics, fx } = setUp(25);
    fx.update(0, () => undefined);
    expect(drawn(graphics)).toBe(0);
    fx.onCharge(1, 2);
    fx.update(30, () => undefined);
    expect(drawn(graphics)).toBeGreaterThan(0);
    fx.update(400, () => undefined);
    expect(drawn(graphics)).toBe(0);
    fx.destroy();
  });

  it("stands down: nothing in the air, nothing drawn, a Tesla back on its idle cell (#308)", () => {
    const sniper = setUp(21);
    const target = creepAt(35, 235);
    sniper.fx.onShot({ tick: 1, towerId: 1, creepId: 9, ix: target.ix, iy: target.iy }, target);
    sniper.fx.update(2, () => target);
    expect(sniper.fx.flyingCount).toBe(1);
    sniper.fx.standDown();
    expect(sniper.fx.flyingCount).toBe(0);
    expect(drawn(sniper.graphics)).toBe(0);
    // The same tick again draws nothing back: the shot is gone, not paused.
    sniper.fx.update(2, () => target);
    expect(drawn(sniper.graphics)).toBe(0);
    sniper.fx.destroy();

    const tesla = setUp(25);
    tesla.fx.onCharge(1, 0);
    tesla.fx.update(20, () => target);
    expect(tesla.frames.get(1)).toBeGreaterThan(0);
    tesla.fx.standDown();
    expect(tesla.frames.get(1)).toBe(0);
    tesla.fx.update(20, () => target);
    expect(tesla.frames.get(1)).toBe(0);
    expect(drawn(tesla.graphics)).toBe(0);
    tesla.fx.destroy();
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

  it("lays the Railgun's gun-balls along the whole beam the engine hurt along (#261)", () => {
    const target = creepAt(35, 235);
    const fired = (beam?: { fromIx: number; fromIy: number; toIx: number; toIy: number }) => {
      const { graphics, fx } = setUp(118);
      const shot = { tick: 1, towerId: 1, creepId: 9, ix: target.ix, iy: target.iy };
      fx.onShot(beam ? { ...shot, beam } : shot, target);
      fx.update(1, () => target);
      const bounds = graphics.getLocalBounds();
      fx.destroy();
      return bounds;
    };
    // Straight down the screen from the muzzle, 1,600 px: the drawing spans all of it.
    const whole = fired({ fromIx: 15, fromIy: 15, toIx: 1615, toIy: 1615 });
    expect(whole.height).toBeGreaterThanOrEqual(1600);
    expect(whole.height).toBeLessThan(1620);
    expect(whole.width).toBeLessThan(40);
    // Without one, the trail stops just past its target.
    expect(fired().height).toBeLessThan(400);
  });

  it("keeps the Railgun's trail solid ten frames, then fades it out over five, as Flash (#312)", () => {
    // A frame every second tick: solid to the end of frame 10, then 0.8 down to 0.2.
    expect(railFade(0)).toBe(1);
    expect(railFade(21)).toBe(1);
    expect(railFade(22)).toBeCloseTo(0.8);
    expect(railFade(28)).toBeCloseTo(0.2);
    expect(railFade(29)).toBeCloseTo(0.2);
    expect(railFade(30)).toBeNull();

    const target = creepAt(35, 235);
    const { graphics, fx } = setUp(118);
    fx.onShot({ tick: 1, towerId: 1, creepId: 9, ix: target.ix, iy: target.iy }, target);
    fx.update(25, () => target);
    expect(drawn(graphics)).toBeGreaterThan(0);
    fx.update(31, () => target);
    expect(drawn(graphics)).toBe(0);
    fx.destroy();
  });

  it("sweeps the Laser's beam along the engine's sweep, across the target 75 ticks in (#267)", () => {
    const { yard, graphics, fx } = setUp(23);
    const target = creepAt(35, 235);
    // From 35 px below the anchor to the target's point, as the engine fires it.
    const sweep = { fromIx: 35, fromIy: 35, toIx: target.ix, toIy: target.iy };
    fx.onShot({ tick: 0, towerId: 1, creepId: 9, ix: target.ix, iy: target.iy, sweep }, target);
    const ground = {
      x: target.ix - target.iy + yard.bounds.originX,
      y: (target.ix + target.iy) / 2 + yard.bounds.originY,
    };
    const reachesTarget = (tick: number) => {
      fx.update(tick, () => target);
      const bounds = graphics.getLocalBounds();
      return ground.x >= bounds.minX && ground.x <= bounds.maxX && ground.y <= bounds.maxY + 1;
    };
    // Short of it at first, on it once the sweep crosses its bearing.
    expect(reachesTarget(15)).toBe(false);
    expect(reachesTarget(75)).toBe(true);
    // Gone after its hundred ticks.
    fx.update(102, () => target);
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

/* ── The new look (beta.5 tower attack effects) ──────────────────────────── */

describe("the new look's arithmetic", () => {
  it("turns a gun the short way round, at most so many degrees a tick", () => {
    expect(stepDegrees(0, 90, 3)).toBe(3);
    // 10 to 350 is 20 back the other way.
    expect(stepDegrees(10, 350, 3)).toBe(7);
    expect(stepDegrees(359, 2, 3)).toBe(2);
    expect(stepDegrees(100, 101, 3)).toBe(101);
  });

  it("reads back the cell a heading came from, so a gun starts turning from where it shows", () => {
    for (let cell = 0; cell < 30; cell += 1) expect(facingCell(118, cellHeading(118, cell), 30)).toBe(cell);
    for (let cell = 0; cell < 54; cell += 1) expect(laserCell(cellHeading(23, cell), 54)).toBe(cell);
  });

  it("kicks a gun back at once and eases it home by the end of its recoil", () => {
    expect(recoilKick(-1)).toBe(0);
    expect(recoilKick(1)).toBe(1);
    expect(recoilKick(RECOIL_TICKS / 2)).toBeGreaterThan(0);
    expect(recoilKick(RECOIL_TICKS / 2)).toBeLessThan(1);
    expect(recoilKick(RECOIL_TICKS)).toBe(0);
  });

  it("winds the Railgun up over the ticks before its next shot, and lets go when it is overdue", () => {
    const rate = 160;
    expect(railCharge(0, rate)).toBe(0);
    expect(railCharge(rate - RAIL_CHARGE_TICKS, rate)).toBe(0);
    expect(railCharge(rate - RAIL_CHARGE_TICKS / 2, rate)).toBeCloseTo(0.5);
    expect(railCharge(rate, rate)).toBe(1);
    expect(railCharge(rate + 31, rate)).toBe(0);
  });

  it("runs the Railgun's slug down its line in a few ticks, and shoots the Laser's beam out after its barrel glows", () => {
    expect(railSlugAlong(0)).toBe(0);
    expect(railSlugAlong(RAIL_SLUG_TICKS / 2)).toBeCloseTo(0.5);
    expect(railSlugAlong(RAIL_SLUG_TICKS + 5)).toBe(1);
    // Seen for about half a second (80 ticks a second), against Flash's 30 ticks.
    expect(RAIL_LIT_TICKS).toBeGreaterThanOrEqual(40);
    expect(laserReach(0)).toBe(0);
    expect(laserReach(LASER_IGNITE_TICKS)).toBe(0);
    expect(laserReach(LASER_IGNITE_TICKS + LASER_REACH_TICKS / 2)).toBeCloseTo(0.5);
    expect(laserReach(LASER_IGNITE_TICKS + LASER_REACH_TICKS)).toBe(1);
  });

  it("gives a tracer a few ticks of its round's flight as its tail, never back past the gun", () => {
    // Nothing yet off the muzzle; then no longer than the round has come.
    expect(tracerLength(10, 0)).toBe(0);
    expect(tracerLength(10, 12)).toBe(12);
    // A slow sniper round streaks its minimum, a fast one a few ticks, a flak shell its cap.
    expect(tracerLength(2.5, 500)).toBe(TRACER_MIN);
    expect(tracerLength(10, 500)).toBe(10 * TRACER_TICKS);
    expect(tracerLength(24, 500)).toBe(TRACER_MAX);
  });

  it("brings the Sniper's aim dot on just before its next shot is due, and not while it has not fired lately", () => {
    expect(sightStrength(Number.POSITIVE_INFINITY, 80)).toBeNull();
    expect(sightStrength(80 - SIGHT_TICKS - 1, 80)).toBeNull();
    expect(sightStrength(80 - SIGHT_TICKS, 80)).toBe(0);
    expect(sightStrength(80 - SIGHT_TICKS / 2, 80)).toBeCloseTo(0.5);
    expect(sightStrength(80, 80)).toBe(1);
    expect(sightStrength(80 + SIGHT_LATE, 80)).toBe(1);
    expect(sightStrength(80 + SIGHT_LATE + 1, 80)).toBeNull();
  });

  it("lifts a flak shell in an arc that is back on its line where it bursts", () => {
    expect(flakLift(300, 0)).toBe(0);
    expect(flakLift(300, 1)).toBe(0);
    expect(flakLift(200, 0.5)).toBeCloseTo(200 * 0.16);
    expect(flakLift(5000, 0.5)).toBe(FLAK_ARC_MAX);
    expect(flakLift(300, 0.25)).toBeLessThan(flakLift(300, 0.5));
  });
});

/** A sheet the size of the real one, with nothing to fetch. */
const fakeSheet = (): Promise<Texture> =>
  Promise.resolve(new Texture({ source: new TextureSource({ width: 768, height: 1728 }) }));

const newLookSetUp = async (type: number, look: "full" | "low" | "classic" = "full") => {
  const yard = readYard(yardOf(type));
  const sparks = new Container();
  const shakes: { tick: number; amp: number }[] = [];
  const nudges: { dx: number; dy: number }[] = [];
  const frames = new Map<number, number>();
  const fx = new TowerFx(
    new Graphics(),
    towersOf(yard),
    {
      setAnimFrame: (id, _layer, frame) => frames.set(id, frame),
      nudge: (_id, _layer, dx, dy) => nudges.push({ dx, dy }),
    },
    { x: yard.bounds.originX, y: yard.bounds.originY },
    { look, sparks, glow: new Graphics(), shake: (tick, amp) => shakes.push({ tick, amp }), load: fakeSheet },
  );
  // The sheet comes in on the next turn of the event loop.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { fx, sparks, shakes, nudges, frames };
};

describe("TowerFx's new look", () => {
  const target = creepAt(35, 235);
  const shoot = (fx: TowerFx, tick: number) =>
    fx.onShot({ tick, towerId: 1, creepId: 9, ix: target.ix, iy: target.iy }, target);

  it("throws painted sparks for a Tesla zap and shakes on the first zap of a charge only", async () => {
    const { fx, sparks, shakes } = await newLookSetUp(25);
    fx.onCharge(1, 0);
    shoot(fx, 70);
    fx.update(70, () => target);
    expect(fx.sparkCount).toBeGreaterThan(0);
    expect(sparks.children.length).toBeGreaterThan(0);
    shoot(fx, 78);
    fx.update(78, () => target);
    expect(shakes).toHaveLength(1);
    fx.destroy();
  });

  it("shakes for every Railgun shot and kicks the gun back, ending in place", async () => {
    const { fx, shakes, nudges } = await newLookSetUp(118);
    shoot(fx, 10);
    for (let tick = 10; tick <= 10 + RECOIL_TICKS + 2; tick += 1) fx.update(tick, () => target);
    expect(shakes).toHaveLength(1);
    expect(nudges.some(({ dx, dy }) => dx !== 0 || dy !== 0)).toBe(true);
    expect(nudges[nudges.length - 1]).toEqual({ dx: 0, dy: 0 });
    fx.destroy();
  });

  it("shakes when a Cannon's splash shell lands, not when it fires", async () => {
    const { fx, shakes } = await newLookSetUp(20);
    fx.update(0, () => target);
    shoot(fx, 5);
    fx.update(5, () => target);
    expect(shakes).toHaveLength(0);
    expect(fx.sparkCount).toBeGreaterThan(0);
    for (let tick = 6; tick <= 400; tick += 1) fx.update(tick, () => target);
    expect(shakes).toHaveLength(1);
    fx.destroy();
  });

  it("throws fewer bits on low than on full", async () => {
    const full = await newLookSetUp(20, "full");
    const low = await newLookSetUp(20, "low");
    for (const { fx } of [full, low]) {
      fx.update(0, () => target);
      shoot(fx, 5);
      fx.update(5, () => target);
    }
    expect(low.fx.sparkCount).toBeGreaterThan(0);
    expect(low.fx.sparkCount).toBeLessThan(full.fx.sparkCount);
    full.fx.destroy();
    low.fx.destroy();
  });

  it("keeps the classic look as it was: no bits, no shake, no kick", async () => {
    const { fx, sparks, shakes, nudges } = await newLookSetUp(118, "classic");
    shoot(fx, 10);
    for (let tick = 10; tick <= 40; tick += 1) fx.update(tick, () => target);
    expect(fx.sparkCount).toBe(0);
    expect(sparks.children).toHaveLength(0);
    expect(shakes).toHaveLength(0);
    expect(nudges).toHaveLength(0);
    fx.destroy();
  });

  it("turns the Railgun onto a creep as it comes into range, a little a tick, before any shot", async () => {
    const { fx, frames } = await newLookSetUp(118);
    // Well out of range (300 at level 1, watched to 300 + AIM_WATCH_MARGIN): the gun stays put.
    const far = creepAt(35, 35 + 400);
    fx.update(1, () => far, [far]);
    expect(frames.get(1)).toBeUndefined();
    // Just short of range it already starts lining up, before the engine can fire.
    const { fx: watcher, frames: watched } = await newLookSetUp(118);
    const close = creepAt(35, 35 + 300 + AIM_WATCH_MARGIN - 10);
    watcher.update(1, () => close, [close]);
    expect(watched.get(1)).toBeDefined();
    watcher.destroy();
    // In range due south: it starts turning from where it shows, not snapping there.
    const near = creepAt(35, 235);
    const wanted = facingCell(118, bearingDegrees({ x: 0, y: 0 }, { x: near.ix, y: near.iy }), 30);
    const start = cellHeading(118, 0);
    fx.update(2, () => near, [near]);
    expect(frames.get(1)).toBe(facingCell(118, stepDegrees(start, 90, TURN_DEGREES_PER_TICK), 30));
    expect(frames.get(1)).not.toBe(wanted);
    // Given time, it is on the creep before the engine fires.
    for (let tick = 3; tick <= 80; tick += 1) fx.update(tick, () => near, [near]);
    expect(frames.get(1)).toBe(wanted);
    // A friendly creep or a dead one is no target.
    const { fx: other, frames: still } = await newLookSetUp(118);
    other.update(1, () => undefined, [{ ...near, friendly: true }, { ...near, id: 10, hp: 0 }]);
    expect(still.get(1)).toBeUndefined();
    fx.destroy();
    other.destroy();
  });

  it("turns the Laser onto a creep in range before its beam, and follows the beam without a jump", async () => {
    const { fx, frames } = await newLookSetUp(23);
    const near = creepAt(35, 135);
    fx.update(1, () => near, [near]);
    const first = frames.get(1);
    expect(first).toBeDefined();
    for (let tick = 2; tick <= 120; tick += 1) fx.update(tick, () => near, [near]);
    const aimed = frames.get(1) ?? -1;
    fx.onShot({ tick: 121, towerId: 1, creepId: 9, ix: near.ix, iy: near.iy, sweep: { fromIx: 0, fromIy: 0, toIx: near.ix, toIy: near.iy } }, near);
    let last = aimed;
    for (let tick = 121; tick <= 200; tick += 1) {
      fx.update(tick, () => near, [near]);
      const cell = frames.get(1) ?? -1;
      // Never more than a tick's catch-up a frame (54 cells round).
      const gap = Math.min(Math.abs(cell - last), 54 - Math.abs(cell - last));
      expect(gap).toBeLessThanOrEqual(Math.ceil(CATCH_UP_DEGREES_PER_TICK / 6.66) + 1);
      last = cell;
    }
    fx.destroy();
  });

  it("draws a Tesla zap from painted strips that swap as it fades, and a Laser beam the same way", async () => {
    const tesla = await newLookSetUp(25);
    tesla.fx.onCharge(1, 0);
    shoot(tesla.fx, 70);
    tesla.fx.update(70, () => target);
    // Glow, band, bolt and its core.
    expect(tesla.sparks.children.filter((child) => child.visible).length).toBeGreaterThanOrEqual(4);
    tesla.fx.update(70 + 20, () => target);
    tesla.fx.destroy();

    const laser = await newLookSetUp(23);
    laser.fx.onShot(
      { tick: 5, towerId: 1, creepId: 9, ix: target.ix, iy: target.iy, sweep: { fromIx: 0, fromIy: 0, toIx: target.ix, toIy: target.iy } },
      target,
    );
    laser.fx.update(5, () => target, [target]);
    const charging = laser.sparks.children.length;
    laser.fx.update(40, () => target, [target]);
    // Charged: the barrel, three rays, the glow and flare where it burns, and its marks.
    expect(laser.sparks.children.length).toBeGreaterThan(charging);
    expect(laser.fx.sparkCount).toBeGreaterThan(0);
    laser.fx.destroy();
  });

  it("keeps the Railgun's trail up about half a second in the new look, then takes it away", async () => {
    const { fx, sparks } = await newLookSetUp(118);
    shoot(fx, 10);
    const lit = () => sparks.children.filter((child) => child.visible).length;
    fx.update(10 + 2, () => target);
    const flying = lit();
    // Every thrown bit is spent well before the end; the trail is still there.
    fx.update(10 + RAIL_LIT_TICKS - 4, () => target);
    expect(fx.sparkCount).toBe(0);
    expect(lit()).toBeGreaterThan(0);
    expect(lit()).toBeLessThan(flying);
    fx.update(10 + RAIL_LIT_TICKS + 1, () => target);
    expect(lit()).toBe(0);
    fx.destroy();
  });

  it("lays the Laser's two plasma layers and filament only on full, so low draws its beam in fewer pieces", async () => {
    const counts: number[] = [];
    for (const look of ["full", "low"] as const) {
      const { fx, sparks } = await newLookSetUp(23, look);
      fx.onShot(
        { tick: 5, towerId: 1, creepId: 9, ix: target.ix, iy: target.iy, sweep: { fromIx: 0, fromIy: 0, toIx: target.ix, toIy: target.iy } },
        target,
      );
      fx.update(45, () => target, [target]);
      counts.push(sparks.children.filter((child) => child.visible && child instanceof TilingSprite).length);
      counts.push(sparks.children.filter((child) => child.visible).length);
      fx.destroy();
    }
    const [fullFlows, fullAll, lowFlows, lowAll] = counts;
    expect(fullFlows).toBe(2);
    expect(lowFlows).toBe(0);
    expect(lowAll).toBeLessThan(fullAll ?? 0);
  });

  /** The Aerial Defense Tower shoots only flyers. */
  const flyer: CreepSnapshot = { ...target, flying: true };
  const targetFor = (type: number): CreepSnapshot => (type === 115 ? flyer : target);
  const fire = (fx: TowerFx, type: number, tick: number) => {
    const creep = targetFor(type);
    return fx.onShot({ tick, towerId: 1, creepId: 9, ix: creep.ix, iy: creep.iy }, creep);
  };
  /** Runs a shot fired on tick 5 until it lands; the tick it landed on. */
  const landingTick = (fx: TowerFx, type: number): number => {
    const creep = targetFor(type);
    fx.update(0, () => creep, [creep]);
    fire(fx, type, 5);
    for (let tick = 5; tick <= 400; tick += 1) {
      fx.update(tick, () => creep, [creep]);
      if (fx.flyingCount === 0) return tick;
    }
    return -1;
  };

  it("flies the Sniper's round and the flak shell as painted tracers, landing when the classic look does", async () => {
    for (const type of [21, 115]) {
      const classic = await newLookSetUp(type, "classic");
      const full = await newLookSetUp(type, "full");
      const low = await newLookSetUp(type, "low");
      const creep = targetFor(type);
      const visible = (sparks: Container) => sparks.children.filter((child) => child.visible).length;
      // Mid-flight, once the muzzle flash has gone: the tracer is up, more of it on full.
      const tracers: number[] = [];
      for (const { fx, sparks } of [full, low]) {
        fx.update(0, () => creep, [creep]);
        fire(fx, type, 5);
        fx.update(5 + 7, () => creep, [creep]);
        expect(fx.flyingCount).toBe(1);
        tracers.push(visible(sparks) - fx.sparkCount);
      }
      expect(tracers[1]).toBeGreaterThanOrEqual(1);
      expect(tracers[1]).toBeLessThan(tracers[0] ?? 0);
      full.fx.destroy();
      low.fx.destroy();
      // Looks only: the round lands on the same tick in every look.
      const fresh = await newLookSetUp(type, "full");
      const painted = landingTick(fresh.fx, type);
      expect(painted).toBeGreaterThan(5);
      expect(painted).toBe(landingTick(classic.fx, type));
      fresh.fx.destroy();
      classic.fx.destroy();
    }
  });

  it("kicks the Sniper and the Aerial Defense Tower back as they fire, and jolts only for the flak burst", async () => {
    for (const type of [21, 115]) {
      const { fx, shakes, nudges } = await newLookSetUp(type);
      const creep = targetFor(type);
      fx.update(0, () => creep, [creep]);
      fire(fx, type, 5);
      fx.update(5, () => creep, [creep]);
      // Fired: a flash and a kick, never a jolt.
      expect(fx.sparkCount).toBeGreaterThan(0);
      expect(shakes).toHaveLength(0);
      for (let tick = 6; tick <= 400; tick += 1) fx.update(tick, () => creep, [creep]);
      expect(shakes).toHaveLength(type === 115 ? 1 : 0);
      expect(nudges.some(({ dx, dy }) => dx !== 0 || dy !== 0)).toBe(true);
      expect(nudges[nudges.length - 1]).toEqual({ dx: 0, dy: 0 });
      fx.destroy();
    }
  });

  it("throws fewer bits for a Sniper's strike and a flak burst on low than on full", async () => {
    for (const type of [21, 115]) {
      const counts: number[] = [];
      for (const look of ["full", "low"] as const) {
        const { fx } = await newLookSetUp(type, look);
        const landed = landingTick(fx, type);
        expect(landed).toBeGreaterThan(5);
        counts.push(fx.sparkCount);
        fx.destroy();
      }
      expect(counts[1]).toBeGreaterThan(0);
      expect(counts[1]).toBeLessThan(counts[0] ?? 0);
    }
  });

  it("turns the Sniper onto a creep in range before any shot, and the Aerial Defense Tower only onto a flyer", async () => {
    const sniper = await newLookSetUp(21);
    sniper.fx.update(1, () => target, [target]);
    expect(sniper.frames.get(1)).toBeDefined();
    sniper.fx.destroy();
    const walker = await newLookSetUp(115);
    walker.fx.update(1, () => target, [target]);
    expect(walker.frames.get(1)).toBeUndefined();
    walker.fx.destroy();
    const flak = await newLookSetUp(115);
    flak.fx.update(1, () => flyer, [flyer]);
    expect(flak.frames.get(1)).toBeDefined();
    flak.fx.destroy();
  });

  /** Sprites on screen that are not thrown bits: strips and spots drawn this frame. */
  const drawnNow = (fx: TowerFx, sparks: Container) =>
    sparks.children.filter((child) => child.visible).length - fx.sparkCount;

  it("puts a small red laser dot on the Sniper's target just before the next shot, with no beam or ring", async () => {
    /** The laser's red bits on screen. */
    const red = (sparks: Container) =>
      sparks.children.filter((child) => child.visible && (child as Sprite).tint === 0xff2a1a).length;
    const counts: number[] = [];
    for (const look of ["full", "low"] as const) {
      const { fx, sparks } = await newLookSetUp(21, look);
      fx.update(0, () => target, [target]);
      fire(fx, 21, 5);
      // Long before the next shot nothing aims.
      for (let tick = 6; tick <= 5 + 80 - SIGHT_TICKS - 2; tick += 1) {
        fx.update(tick, () => target, [target]);
        expect(red(sparks)).toBe(0);
      }
      // Just before it is due: the dot, and nothing else in red, on full as on low.
      for (let tick = 5 + 80 - SIGHT_TICKS - 1; tick <= 5 + 80 - 1; tick += 1) fx.update(tick, () => target, [target]);
      counts.push(red(sparks));
      fx.destroy();
    }
    expect(counts).toEqual([1, 1]);
  });

  it("fires the flak tower's twin barrels in a burst, only the engine's shell landing a wound or jolting", async () => {
    for (const [look, shells] of [["full", FLAK_VOLLEY_FULL], ["low", FLAK_VOLLEY_LOW]] as const) {
      const yard = readYard(yardOf(115));
      const sparks = new Container();
      const landed: number[] = [];
      const shakes: number[] = [];
      const fx = new TowerFx(
        new Graphics(),
        towersOf(yard),
        { setAnimFrame: () => undefined, landed: (key) => landed.push(key) },
        { x: yard.bounds.originX, y: yard.bounds.originY },
        { look, sparks, glow: new Graphics(), shake: (tick) => shakes.push(tick), load: fakeSheet },
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      fx.update(0, () => flyer, [flyer]);
      const key = fire(fx, 115, 5);
      // Each shell in the air is a painted shell with its hot nose (and a glow on full).
      const perShell = look === "full" ? 3 : 2;
      let most = 0;
      for (let tick = 5; tick <= 200; tick += 1) {
        fx.update(tick, () => flyer, [flyer]);
        most = Math.max(most, drawnNow(fx, sparks));
      }
      expect(most).toBeGreaterThanOrEqual(2 * perShell);
      expect(most).toBeLessThanOrEqual(shells * perShell);
      expect(landed).toEqual([key]);
      expect(shakes).toHaveLength(1);
      fx.destroy();
    }
  });

  it("keeps the classic Sniper and flak shots as they were: no bits, no shake, no kick", async () => {
    for (const type of [21, 115]) {
      const { fx, sparks, shakes, nudges } = await newLookSetUp(type, "classic");
      landingTick(fx, type);
      expect(sparks.children).toHaveLength(0);
      expect(shakes).toHaveLength(0);
      expect(nudges).toHaveLength(0);
      fx.destroy();
    }
  });

  it("clears every bit when the battle stands down", async () => {
    const { fx, sparks } = await newLookSetUp(25);
    fx.onCharge(1, 0);
    shoot(fx, 70);
    fx.update(70, () => target);
    fx.standDown();
    expect(fx.sparkCount).toBe(0);
    expect(sparks.children.filter((child) => child.visible)).toHaveLength(0);
    fx.destroy();
  });
});
