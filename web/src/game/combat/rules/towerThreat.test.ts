import { describe, expect, it, vi } from "vitest";

import { createBattle } from "./engine.js";
import { LASER_SWEEP_SHARE, towerPerTick } from "./stance.js";
import {
  AERIAL_DEFENSE_TYPE,
  LASER_DROP,
  LASER_PULSE_TICKS,
  LASER_TICKS,
  LASER_TYPE,
  TESLA_TYPE,
  TOWER_REARM_MULTIPLIER,
  laserEnd,
  laserPulse,
  laserSweep,
  maxHp,
  towerShotDamage,
  towerStats,
} from "./stats.js";
import {
  buildEngineYard,
  distanceSquared,
  fromIso,
  rangePointOf,
  screenPointOf,
  towerScanPoint,
  type EngineBuilding,
} from "./yard.js";
import type * as Stats from "./stats.js";

/**
 * Issue #276: the champion's tower-threat estimate (`towerPerTick`) against
 * what the engine's own fire really deals.
 *
 * No monster in the tables outlives a level 8 Aerial Defense salvo or Tesla
 * charge, so the prey here is a test-only synthetic: this file alone gives the
 * Sandal (`C14`, a flyer) and the Brain (`C12`, on the ground) health no tower
 * can get through. Each battle is one such creep at a Town Hall beside the
 * tower, so there is always exactly one live target, it never dies and never
 * has to be found again, and nothing it does touches the tower.
 */
vi.mock("./stats.js", async (importOriginal) => {
  const actual = await importOriginal<typeof Stats>();
  const endless = 1e12;
  return {
    ...actual,
    monsterStat: (id: string, key: Parameters<typeof actual.monsterStat>[1], level: number) =>
      key === "health" && (id === "C14" || id === "C12")
        ? endless
        : actual.monsterStat(id, key, level),
  };
});

const RESOURCES = { r1: 1_000_000, r2: 0, r3: 0, r4: 0 };
const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8];

/** Long enough for the creep to arrive and settle, and for ten of the slowest cycles after. */
const BATTLE_TICKS = 6000;
const SETTLE_TICKS = 1000;
/** A gap in the tower's shots longer than this starts a new cycle: salvo, charge or beam. */
const CYCLE_GAP = 16;

interface Layout {
  readonly hall: { readonly X: number; readonly Y: number };
  readonly fling: { readonly x: number; readonly y: number };
  readonly prey: "C12" | "C14";
}

/** A level 10 Town Hall east of the tower, the Sandal landing to its south-west. */
const BESIDE: Layout = { hall: { X: 120, Y: 0 }, fling: { x: 40, y: 200 }, prey: "C14" };

/** Three places the Brain stands at a Town Hall in a Laser's reach, near to far. */
const STANDS: readonly Layout[] = [
  { hall: { X: 0, Y: 100 }, fling: { x: 40, y: 260 }, prey: "C12" },
  { hall: { X: 80, Y: 40 }, fling: { x: 60, y: 200 }, prey: "C12" },
  { hall: { X: 120, Y: 0 }, fling: { x: 40, y: 200 }, prey: "C12" },
];

const towerAt = (type: number, level: number, hp: number, hall: Layout["hall"]) =>
  buildEngineYard({
    buildingdata: {
      "1": { id: 1, t: type, l: level, X: 0, Y: 0 },
      "2": { id: 2, t: 14, l: 10, ...hall },
    },
    buildinghealthdata: { "1": hp },
    resources: RESOURCES,
  });

/**
 * The tower's real damage per tick over whole cycles: from the first cycle
 * that starts after the creep has settled to the last that starts before the
 * end. Damage still in flight (a shell, a beam) is the same at both ends.
 */
const measure = (type: number, level: number, hp: number, layout: Layout) => {
  const yard = towerAt(type, level, hp, layout.hall);
  const gun = yard.buildings.find((building) => building.id === 1) as EngineBuilding;
  const battle = createBattle(yard, { seed: 1, levels: { C12: 6, C14: 6 } });
  battle.apply({ kind: "fling", t: 0, ...layout.fling, r: 0, monsters: { [layout.prey]: 1 } });
  const dealt: number[] = [0];
  const starts: number[] = [];
  let lastShot = -Infinity;
  for (let step = 0; step < BATTLE_TICKS && !battle.over(); step += 1) {
    battle.step();
    for (const event of battle.recentEvents(battle.tick - 1)) {
      if (event.kind !== "shot" || event.towerId !== 1) continue;
      if (event.tick - lastShot > CYCLE_GAP && event.tick >= SETTLE_TICKS)
        starts.push(event.tick);
      lastShot = event.tick;
    }
    dealt.push(battle.state().towers[0]?.damageDealt ?? 0);
  }
  const first = starts[0] as number;
  const last = starts.at(-1) as number;
  const creep = battle.creeps()[0];
  expect(starts.length).toBeGreaterThanOrEqual(6);
  // The creep never touched the tower, so its shot is what `hp` makes it.
  expect(battle.state().health["1"]).toBe(hp === maxHp(type, level) ? undefined : hp);
  return {
    real: ((dealt[last] as number) - (dealt[first] as number)) / (last - first),
    gun,
    stands: { x: creep?.ix ?? 0, y: creep?.iy ?? 0 },
  };
};

const estimate = (type: number, level: number, hp: number): number => {
  const stats = towerStats(type, level);
  return towerPerTick(
    type,
    level,
    stats?.damage ?? 0,
    stats?.rate ?? 0,
    TOWER_REARM_MULTIPLIER,
    hp,
    maxHp(type, level),
  );
};

/** Full health and half: the estimate scales with the tower's health as its shot does. */
const healths = (type: number, level: number): number[] => [
  maxHp(type, level),
  Math.round(maxHp(type, level) / 2),
];

/**
 * What one beam from `gun` deals a creep standing still at yard `(x, y)`, in
 * shots: fired at it as the engine's `fireLaser` fires, its pulses summed on
 * the frames `tickLaserBeams` pulses it, each by its distance from the end.
 */
const beamShotsAt = (gun: EngineBuilding, x: number, y: number, splash: number): number => {
  const target = screenPointOf(x, y);
  const sweep = laserSweep(
    gun.sx,
    gun.sy + LASER_DROP,
    Math.trunc(target.x),
    Math.trunc(target.y),
  );
  const stands = rangePointOf(x, y);
  let shots = 0;
  for (let frame = 0; frame <= LASER_TICKS; frame += LASER_PULSE_TICKS) {
    const end = laserEnd(sweep, frame + 1);
    if (!end) return 0;
    const at = fromIso(end.x, end.y);
    const squared = Math.trunc(distanceSquared(at.x, at.y, stands.x, stands.y));
    if (squared < splash * splash) shots += laserPulse(1, splash, Math.sqrt(squared));
  }
  return shots;
};

describe("the tower threat estimate against the tower's own fire (issue #276)", () => {
  it.each(LEVELS)("reads a level %i Aerial Defense Tower's salvoes exactly", (level) => {
    for (const hp of healths(AERIAL_DEFENSE_TYPE, level)) {
      const { real } = measure(AERIAL_DEFENSE_TYPE, level, hp, BESIDE);
      expect(estimate(AERIAL_DEFENSE_TYPE, level, hp) / real).toBeCloseTo(1, 9);
    }
  });

  /**
   * The wind-down starts wherever the charge's loop was at the last zap, which
   * turns on how the zaps fell against the frames; the estimate takes the
   * loop's midpoint. Where the real wind-down runs past a `Fire` the estimate
   * expects it to catch (levels 4 and 5 here, 25 zaps a charge), the charge
   * waits one reload more: eight reloads where the estimate counts seven, so
   * it reads the Tesla a seventh hot. It is never cold.
   */
  it.each(LEVELS)(
    "reads a level %i Tesla's charges, never under, at most a seventh over",
    (level) => {
      for (const hp of healths(TESLA_TYPE, level)) {
        const { real } = measure(TESLA_TYPE, level, hp, BESIDE);
        const ratio = estimate(TESLA_TYPE, level, hp) / real;
        expect(ratio).toBeGreaterThan(1 - 1e-9);
        expect(ratio).toBeLessThan(8 / 7 + 1e-9);
      }
    },
  );

  it.each(LEVELS)(
    "deals a still target at level %i what its sweep says, beam by beam",
    (level) => {
      const stats = towerStats(LASER_TYPE, level);
      for (const layout of STANDS) {
        for (const hp of healths(LASER_TYPE, level)) {
          const { real, gun, stands } = measure(LASER_TYPE, level, hp, layout);
          const shots = beamShotsAt(gun, stands.x, stands.y, stats?.splash ?? 0);
          const shot = towerShotDamage(stats?.damage ?? 0, hp, maxHp(LASER_TYPE, level));
          expect(real).toBeGreaterThan(0);
          expect(
            real / ((shot * shots) / ((stats?.rate ?? 0) * TOWER_REARM_MULTIPLIER)),
          ).toBeCloseTo(1, 9);
        }
      }
    },
  );

  /**
   * The estimate cannot know where in the reach the champion will stand, so
   * it takes the sweep's share averaged over all of it ({@link LASER_SWEEP_SHARE}),
   * worked out here again with the sweep the engine fires.
   */
  it.each(LEVELS)(
    "takes a level %i Laser's share of a beam averaged over its reach",
    (level) => {
      const stats = towerStats(LASER_TYPE, level);
      const range = stats?.range ?? 0;
      const splash = stats?.splash ?? 0;
      const gun = towerAt(LASER_TYPE, level, maxHp(LASER_TYPE, level), { X: 400, Y: 400 })
        .buildings[0] as EngineBuilding;
      const scan = towerScanPoint(gun);
      const pulses = Math.trunc(LASER_TICKS / LASER_PULSE_TICKS) + 1;
      let share = 0;
      let points = 0;
      for (let dx = -range; dx <= range; dx += 2) {
        for (let dy = -range; dy <= range; dy += 2) {
          if (dx * dx + dy * dy >= range * range) continue;
          share += beamShotsAt(gun, scan.x + dx, scan.y + dy, splash) / (pulses * 0.5);
          points += 1;
        }
      }
      expect(Math.abs(share / points - LASER_SWEEP_SHARE)).toBeLessThan(0.015);

      const shot = towerShotDamage(stats?.damage ?? 0, 1, 1);
      const beam = shot * 0.5 * pulses * LASER_SWEEP_SHARE;
      const perTick = beam / ((stats?.rate ?? 0) * TOWER_REARM_MULTIPLIER);
      expect(estimate(LASER_TYPE, level, maxHp(LASER_TYPE, level))).toBeCloseTo(perTick, 9);
    },
  );
});
