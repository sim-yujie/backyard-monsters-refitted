import { GRID_CELL, GRID_WIDTH } from "../../game-rules/combat/grid.js";
import { TICKS_PER_SECOND, raidSpawnsUntilOf } from "../../game-rules/combat/index.js";
import type { Rng } from "../../game-rules/combat/rng.js";
import type { RaidChampion, RaidEvent, Roster } from "../../game-rules/combat/types.js";
import { RAID_MAP_WIDTH, RAID_WALK } from "./raidArmy.js";
import { DEGREES } from "./raidDirection.js";

/**
 * Armies that land from several sides over time, and wild champions among
 * them (beta 10, owner 27 Nov 2026, `docs/design/wild-raids.md` "Beta 10
 * threat"). Pure: no database, no clock; every random pick takes the
 * caller's stream. The wild raid's planner (`raidPlan.ts`) builds its
 * threat-scaled raids with these, and event waves (Wild Monster Invasion)
 * may build theirs with them too.
 *
 * A raid is a list of {@link RaidEvent}s, each a disc of monsters (and at most
 * one champion) landing at a tick. The engine fights them in tick order and
 * does not end the raid while a wave is still to come
 * (`BattleOptions.raidSpawnsUntil`, read from the log by
 * {@link raidSpawnsUntilOf} on the server, in its replay and on the client).
 */

export { raidSpawnsUntilOf };

/** Kozu's swarm: three to a group, 8 degrees apart (`WMATTACK.as:688`, `:694`). */
export const SWARM_GROUP = 3;
export const SWARM_SPACING_DEGREES = 8;

/** Furthest a raider may land from the yard's middle along either axis, in yard units: a cell inside the grid's edge. */
export const RAID_LANDING_LIMIT = (GRID_WIDTH / 2) * GRID_CELL - 2 * GRID_CELL;

/**
 * How far a disc of screen radius `r` reaches along a yard axis: the engine
 * scatters on screen and a screen step `(sx, sy)` is the yard step
 * `(sy + sx/2, sy - sx/2)`, at most `sqrt(1.25) r` along either axis.
 */
const SCREEN_TO_YARD_REACH = Math.sqrt(1.25);

/** A disc on a bearing, pulled in or shrunk so it stays on the pathing grid. */
export const raidLanding = (bearing: number, out: number, radius: number): { x: number; y: number; r: number } => {
  const cos = Math.cos(bearing * DEGREES);
  const sin = Math.sin(bearing * DEGREES);
  const axis = Math.max(Math.abs(cos), Math.abs(sin));
  let r = radius;
  let along = out;
  if (along * axis + SCREEN_TO_YARD_REACH * r > RAID_LANDING_LIMIT) {
    along = Math.max(RAID_MAP_WIDTH, (RAID_LANDING_LIMIT - SCREEN_TO_YARD_REACH * r) / axis);
    if (along * axis + SCREEN_TO_YARD_REACH * r > RAID_LANDING_LIMIT) {
      r = Math.max(0, (RAID_LANDING_LIMIT - along * axis) / SCREEN_TO_YARD_REACH);
    }
  }
  return { x: Math.round(cos * along), y: Math.round(sin * along), r: Math.round(r) };
};


/** Champion types a wild raid may bring: Gorgo, Drull, Fomor, Korath (Krallen never). */
export const RAID_CHAMPION_TYPES: readonly number[] = [1, 2, 3, 4];

/** Seconds to ticks for a drop time. */
export const dropTicks = (seconds: number): number => Math.max(0, Math.round(seconds * TICKS_PER_SECOND));

/** `count` split into `parts` near-equal whole shares, the larger ones first. */
export const splitEvenly = (count: number, parts: number): number[] => {
  const whole = Math.max(0, Math.floor(count));
  const n = Math.max(1, Math.floor(parts));
  const base = Math.floor(whole / n);
  const extra = whole % n;
  return Array.from({ length: n }, (_, at) => base + (at < extra ? 1 : 0));
};

/**
 * A roster split into `parts` rosters, each type spread near-evenly; a type's
 * remainder goes to the earliest parts. Empty types are left out of a part.
 */
export const splitRoster = (roster: Roster, parts: number): Roster[] => {
  const n = Math.max(1, Math.floor(parts));
  const out: Record<string, number>[] = Array.from({ length: n }, () => ({}));
  for (const monster of Object.keys(roster).sort(byMonsterNumber)) {
    splitEvenly(roster[monster] ?? 0, n).forEach((share, at) => {
      if (share > 0) (out[at] as Record<string, number>)[monster] = share;
    });
  }
  return out;
};

/** `C2` before `C10`: Flash's `_monsterKeys` order. */
export const byMonsterNumber = (one: string, other: string): number =>
  Number(one.replace(/^\D+/, "")) - Number(other.replace(/^\D+/, "")) || one.localeCompare(other);

/** Bearing difference in degrees, 0 to 180. */
export const bearingGap = (one: number, other: number): number => {
  const gap = Math.abs((((one - other) % 360) + 360) % 360);
  return gap > 180 ? 360 - gap : gap;
};

/** `count` bearings evenly round the circle from `first` (e.g. 3 sides: first, +120, +240). */
export const spreadBearings = (first: number, count: number): number[] => {
  const n = Math.max(1, Math.floor(count));
  return Array.from({ length: n }, (_, at) => (((first + (360 / n) * at) % 360) + 360) % 360);
};

/**
 * Up to `count` bearings from `ranked` (best way in first): the first, then
 * each next one at least 90 degrees from all taken, then at least 45, then
 * any; never the same bearing twice. With too few candidates, fewer come back.
 */
export const pickSideBearings = (ranked: readonly number[], count: number): number[] => {
  const taken: number[] = [];
  const want = Math.max(1, Math.floor(count));
  for (const apart of [90, 45, 0]) {
    for (const bearing of ranked) {
      if (taken.length >= want) return taken;
      if (taken.includes(bearing)) continue;
      if (taken.every((other) => bearingGap(bearing, other) >= apart)) taken.push(bearing);
    }
  }
  return taken;
};

/**
 * One random wild champion at a level (1 to 6) and power level (0 to 3),
 * drawn from `rng` (one draw). `leaveTicks`, if given, is how long after it
 * lands it leaves the yard if still standing (`RaidChampion.leave`).
 */
export const championRaider = (
  rng: Rng,
  level: number,
  power = 0,
  types: readonly number[] = RAID_CHAMPION_TYPES,
  leaveTicks?: number,
): RaidChampion => ({
  t: types[rng.int(types.length)] ?? 1,
  l: Math.max(1, Math.min(6, Math.floor(level))),
  pl: Math.max(0, Math.min(3, Math.floor(power))),
  ...(leaveTicks !== undefined && leaveTicks >= 0 ? { leave: Math.floor(leaveTicks) } : {}),
});

/** One group landing on one bearing at one tick. */
export interface RaidDropGroup {
  /** Degrees, 0 = +x on the yard. */
  readonly bearing: number;
  /** Tick it lands on. */
  readonly t: number;
  readonly monsters: Roster;
  /**
   * Per type, how far out past the 800 ring it starts (`raidArmy.ts`
   * `distances`): it lands in a disc `800 + d/2` out and `d/2` across. With
   * no map every type starts {@link RAID_WALK} out; a type the map leaves out
   * lands on the 800 ring itself.
   */
  readonly distances?: Readonly<Record<string, number>>;
  /** Kozu's swarm: each type in threes, 8 degrees further round each time. */
  readonly swarm?: boolean;
  /** Health and damage multiplier for the monsters (not the champion); absent 1. */
  readonly strength?: number;
  readonly champion?: RaidChampion;
  /** The frost tribe's (beta 10, `RaidEvent.frost`): every wave of the group is marked frost. */
  readonly frost?: boolean;
}

/**
 * One group's events: a disc per type (or Kozu's threes) in monster-number
 * order, then the champion in a disc of its own. For one group at tick 0
 * this is exactly the wild raid's waves before beta 10.
 */
export const dropGroupEvents = (group: RaidDropGroup): RaidEvent[] => {
  const events: RaidEvent[] = [];
  const strength = {
    ...(group.strength !== undefined && group.strength !== 1 ? { strength: group.strength } : {}),
    ...(group.frost ? { frost: true as const } : {}),
  };
  const disc = (angle: number, d: number) => raidLanding(angle, RAID_MAP_WIDTH + d / 2, d / 2);
  const wave = (angle: number, monster: string, count: number): void => {
    // A type the distances leave out lands on the ring, as the raid before beta 10 did.
    const landing = disc(angle, group.distances ? (group.distances[monster] ?? 0) : RAID_WALK);
    events.push({ kind: "raid", t: group.t, ...landing, monsters: { [monster]: count }, ...strength });
  };
  for (const monster of Object.keys(group.monsters).sort(byMonsterNumber)) {
    const count = group.monsters[monster] ?? 0;
    if (count <= 0) continue;
    if (!group.swarm) {
      wave(group.bearing, monster, count);
      continue;
    }
    const groups = Math.trunc(count / SWARM_GROUP);
    let angle = group.bearing;
    for (let three = 0; three < groups; three += 1) {
      angle += SWARM_SPACING_DEGREES;
      wave(angle, monster, SWARM_GROUP);
    }
    const left = count % SWARM_GROUP;
    if (left > 0) wave(groups === 0 ? angle + SWARM_SPACING_DEGREES : angle, monster, left);
  }
  if (group.champion) {
    const landing = disc(group.bearing, RAID_WALK);
    events.push({
      kind: "raid",
      t: group.t,
      ...landing,
      monsters: {},
      champion: group.champion,
      ...(group.frost ? { frost: true as const } : {}),
    });
  }
  return events;
};

/** What {@link stagedRaidEvents} is handed. */
export interface StagedRaidInput {
  /** One bearing per side, the first the main way in. */
  readonly bearings: readonly number[];
  /** The whole army, split over the sides and drops. */
  readonly army: Roster;
  readonly distances?: Readonly<Record<string, number>>;
  /** Groups per side, landing one after another; 1 lands it all at tick 0. */
  readonly drops: number;
  /** Ticks between a side's groups ({@link dropTicks}). */
  readonly dropGapTicks: number;
  readonly swarm?: boolean;
  readonly strength?: number;
  /** The frost tribe's army (beta 10): every wave is marked frost (`RaidEvent.frost`). */
  readonly frost?: boolean;
  /** One champion, landing with the last group on the first side. */
  readonly champion?: RaidChampion;
  /**
   * Ticks after the last group lands that every raider still on the yard
   * leaves ({@link retreatEvent}); absent or 0, they stay until they fall or
   * run out of things to attack.
   */
  readonly retreatAfterTicks?: number;
}

/** The wave that sends every raider still on the yard home at tick `t` (`RaidEvent.retreat`). */
export const retreatEvent = (t: number): RaidEvent => ({
  kind: "raid",
  t: Math.max(0, Math.floor(t)),
  x: 0,
  y: 0,
  r: 0,
  monsters: {},
  retreat: true,
});

/**
 * A whole army landing from several sides in timed groups. Each type is
 * split near-evenly over the sides, then each side's share over its drops
 * ({@link splitRoster}). Group `d` on side `s` of `S` lands at
 * `d x gap + s x gap / S`: the sides take turns inside each gap, so groups
 * come round the yard one after another. The champion lands with the last
 * group of the first side, and a retreat wave ends it all
 * `retreatAfterTicks` after the last group. Events come back in tick order.
 */
export const stagedRaidEvents = (input: StagedRaidInput): RaidEvent[] => {
  const sides = input.bearings.length > 0 ? input.bearings : [0];
  const drops = Math.max(1, Math.floor(input.drops));
  const gap = Math.max(0, Math.floor(input.dropGapTicks));
  const groups: RaidDropGroup[] = [];
  splitRoster(input.army, sides.length).forEach((sideArmy, side) => {
    splitRoster(sideArmy, drops).forEach((monsters, drop) => {
      const last = drop === drops - 1;
      groups.push({
        bearing: sides[side] as number,
        t: drop * gap + Math.floor((side * gap) / sides.length),
        monsters,
        ...(input.distances ? { distances: input.distances } : {}),
        ...(input.swarm ? { swarm: true } : {}),
        ...(input.strength !== undefined ? { strength: input.strength } : {}),
        ...(input.frost ? { frost: true } : {}),
        ...(last && side === 0 && input.champion ? { champion: input.champion } : {}),
      });
    });
  });
  // Stable: ties keep side, then drop, order.
  const events = groups
    .map((group, at) => ({ group, at }))
    .sort((one, other) => one.group.t - other.group.t || one.at - other.at)
    .flatMap(({ group }) => dropGroupEvents(group));
  const retreat = Math.floor(input.retreatAfterTicks ?? 0);
  if (retreat > 0) events.push(retreatEvent(raidSpawnsUntilOf(events) + retreat));
  return events;
};
