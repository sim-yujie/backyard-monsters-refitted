import { Tribe } from "../../enums/Tribes.js";
import { GRID_CELL, GRID_WIDTH } from "../../game-rules/combat/grid.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import { buildEngineYard } from "../../game-rules/combat/yard.js";
import type {
  BuildingHealthMap,
  CombatBuildingDataMap,
  RaidEvent,
  RaidLog,
  ResourceAmounts,
  Roster,
} from "../../game-rules/combat/types.js";
import { RAID_MAP_WIDTH, raidArmy, raidWalk } from "./raidArmy.js";
import { DEGREES, chooseRaidDirection } from "./raidDirection.js";
import { RAID_PREFERENCES, type RaidPreference } from "./raidPreferences.js";
import { pickRaidTribe } from "./raidTribe.js";

/**
 * The raid planner (#226 WP1, `docs/design/wild-raids.md` §5): from a saved
 * yard, the player's level and their more / same / less choice, the raid Flash
 * would have sent, as a raid log the engine fights (`replayRaid`).
 *
 * Pure: no database, no Redis, no clock. The same input and seed always give
 * the same plan. One stream off the seed draws the tribe, then the routes'
 * scatter (`raidDirection.ts`).
 *
 * Every type lands in a disc `800 + d/2` out on the chosen bearing, `d/2`
 * across, where `d` is its distance from `raidArmy.ts` (`WMATTACK.SpawnA`,
 * `:678-722`). Kozu's swarm lands in threes instead, each three 8 degrees
 * further round than the last, and any one or two left over with the last
 * three (`:691-708`). Flash's loop spawned a whole three while any were left,
 * then the leftovers again, so a count that was not a multiple of three
 * came with three extra; here the swarm is exactly its planned size.
 *
 * The engine's grid stops 1,300 yard units out, and a raider landed off it
 * walks straight through walls until it is on (raid00's WP0 note), so a disc
 * that would reach past the grid is pulled in along its bearing, and only if
 * that is not enough (it would have to sit inside the 800 ring) made smaller.
 */

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

/** What the planner is handed. */
export interface RaidPlanInput {
  readonly buildingdata: CombatBuildingDataMap;
  readonly buildinghealthdata?: BuildingHealthMap | null;
  /** The bank, for what a silo or Town Hall is worth to Abunakki and Dreadnaut. */
  readonly resources?: Partial<ResourceAmounts> | null;
  /** The player's level, which picks the monsters. */
  readonly level: number;
  readonly preference: RaidPreference;
  /** The raid's own seed. */
  readonly seed: number;
}

/** A planned raid. */
export interface RaidPlan {
  readonly tribe: Tribe;
  /** Degrees the raid comes in on, 0 to 337.5. */
  readonly bearing: number;
  /** The building the route was planned to (the first target). */
  readonly targetId: number;
  /** Tower fire along the chosen route (0: no tower covers it). */
  readonly damageTaken: number;
  readonly army: Roster;
  readonly log: RaidLog;
}

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

/** `C2` before `C10`: Flash's `_monsterKeys` order. */
const byMonsterNumber = (one: string, other: string): number =>
  Number(one.slice(1)) - Number(other.slice(1)) || one.localeCompare(other);

/** The raid's waves: one disc per type, or Kozu's threes. */
const raidEvents = (
  tribe: Tribe,
  bearing: number,
  army: Roster,
  distances: Readonly<Record<string, number>>,
): RaidEvent[] => {
  const events: RaidEvent[] = [];
  const wave = (angle: number, monster: string, count: number): void => {
    const d = distances[monster] ?? 0;
    const landing = raidLanding(angle, RAID_MAP_WIDTH + d / 2, d / 2);
    events.push({ kind: "raid", t: 0, x: landing.x, y: landing.y, r: landing.r, monsters: { [monster]: count } });
  };
  for (const monster of Object.keys(army).sort(byMonsterNumber)) {
    const count = army[monster] ?? 0;
    if (count <= 0) continue;
    if (tribe !== Tribe.KOZU) {
      wave(bearing, monster, count);
      continue;
    }
    const groups = Math.trunc(count / SWARM_GROUP);
    let angle = bearing;
    for (let group = 0; group < groups; group += 1) {
      angle += SWARM_SPACING_DEGREES;
      wave(angle, monster, SWARM_GROUP);
    }
    const left = count % SWARM_GROUP;
    if (left > 0) wave(groups === 0 ? angle + SWARM_SPACING_DEGREES : angle, monster, left);
  }
  return events;
};

/**
 * Plan a raid, or null when the yard has nothing a raid could head for (no
 * harvester, storage, tower or other attackable building standing).
 */
export const planRaid = (input: RaidPlanInput): RaidPlan | null => {
  const rng = mulberry32(input.seed);
  const tribe = pickRaidTribe(rng);
  const yard = buildEngineYard({
    buildingdata: input.buildingdata,
    buildinghealthdata: input.buildinghealthdata ?? null,
    resources: input.resources ?? null,
    kind: "main",
  });
  const solution = chooseRaidDirection(tribe, yard, rng);
  if (!solution) return null;

  const effect = RAID_PREFERENCES[input.preference];
  const target = solution.target;
  const { monsters, distances } = raidArmy(tribe, {
    types: yard.buildings.map((building) => building.type),
    level: input.level,
    amplifier: effect.amplifier,
    damageTaken: solution.damageTaken,
    resourcesGained: solution.resourcesGained,
    walk: raidWalk(Math.hypot(solution.entry.x - target.sx, solution.entry.y - target.sy)),
  });

  return {
    tribe,
    bearing: solution.bearing,
    targetId: target.id,
    damageTaken: solution.damageTaken,
    army: monsters,
    log: { v: 1, seed: input.seed, events: raidEvents(tribe, solution.bearing, monsters, distances) },
  };
};
