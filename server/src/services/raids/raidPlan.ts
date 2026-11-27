import { RAID_CHAMPION_LEAVE_SECONDS, RAID_MAX_RAIDERS } from "../../config/RaidThreatConfig.js";
import { Tribe } from "../../enums/Tribes.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import { buildEngineYard } from "../../game-rules/combat/yard.js";
import type {
  BuildingHealthMap,
  CombatBuildingDataMap,
  RaidChampion,
  RaidLog,
  ResourceAmounts,
  Roster,
} from "../../game-rules/combat/types.js";
import { RAID_WALK, raidArmy, raidWalk } from "./raidArmy.js";
import { rankRaidSolutions, raidSolutions } from "./raidDirection.js";
import { byMonsterNumber, championRaider, dropTicks, pickSideBearings, stagedRaidEvents } from "./raidDrops.js";
import { RAID_PREFERENCES, type RaidPreference } from "./raidPreferences.js";
import { raidThreatStep } from "./raidThreat.js";
import { chooseRaidTribe, type RaidCamp } from "./raidTribe.js";

export { RAID_LANDING_LIMIT, SWARM_GROUP, SWARM_SPACING_DEGREES, raidLanding } from "./raidDrops.js";

/**
 * The raid planner (#226 WP1, `docs/design/wild-raids.md` §5): from a saved
 * yard, the player's level and their more / same / less choice, the raid Flash
 * would have sent, as a raid log the engine fights (`replayRaid`).
 *
 * Pure: no database, no Redis, no clock. The same input and seed always give
 * the same plan. One stream off the seed draws the tribe's roll (used only
 * with no camps, `raidTribe.ts`), then the routes' scatter (`raidDirection.ts`).
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
 * that is not enough (it would have to sit inside the 800 ring) made smaller
 * (`raidLanding`, now in `raidDrops.ts`).
 *
 * Beta 10 (owner 27 Nov 2026, "Beta 10 threat" in the design): the raid is
 * planned at the player's threat, whose row in `config/RaidThreatConfig.ts`
 * grows it: a bigger army, Vorgs and Zafreetis, more sides (the first the
 * least-defended way in, the others the next least-defended at least 90
 * degrees apart), timed groups, and one random champion. Threat 0 is exactly
 * the raid before beta 10: every new draw from the seed comes after the
 * tribe's and the routes', and one side and one group at tick 0 give the same
 * waves.
 */


/** Vorg and Zafreeti, the flying healers higher threats bring (beta 10). */
export const RAID_VORG = "C16";
export const RAID_ZAFREETI = "C15";

/** How far behind the army's furthest type the healers start, so they follow it in. */
export const HEALER_LEAD = 40;

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
  /** The player's Map Room 1 camps, which pick the tribe (`raidTribe.ts`); none on Map Room 2. */
  readonly camps?: readonly RaidCamp[] | null;
  /** The player's raid threat (`raidThreat.ts`); absent 0, the raid before beta 10. */
  readonly threat?: number;
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
  /** The threat it was planned at (beta 10); absent on a raid planned before. */
  readonly threat?: number;
  /** Every side it lands from, the first {@link bearing} (beta 10). */
  readonly sides?: readonly number[];
  /** The wild champion it brings, if any (beta 10). */
  readonly champion?: RaidChampion;
}


/**
 * The healers a threat adds: `share` of the tribe's army, rounded up (at least
 * one when the share is above 0).
 */
const healers = (share: number, armySize: number): number => (share > 0 ? Math.max(1, Math.ceil(share * armySize)) : 0);

/**
 * An army held to {@link RAID_MAX_RAIDERS}: over it, every type scaled down in
 * proportion so the whole is the cap (largest remainders round up, ties to
 * the lower monster number), and at least one of a type that had any.
 */
export const capRaidArmy = (army: Roster, cap = RAID_MAX_RAIDERS): Roster => {
  const total = Object.values(army).reduce((sum, count) => sum + Math.max(0, count), 0);
  if (total <= cap) return army;
  const types = Object.keys(army)
    .filter((monster) => (army[monster] ?? 0) > 0)
    .sort(byMonsterNumber);
  const exact = types.map((monster) => ((army[monster] ?? 0) * cap) / total);
  const counts = exact.map((share) => Math.floor(share));
  let left = cap - counts.reduce((sum, count) => sum + count, 0);
  const order = types
    .map((_, at) => at)
    .sort((one, other) => exact[other]! - counts[other]! - (exact[one]! - counts[one]!) || one - other);
  for (const at of order) {
    if (left <= 0) break;
    counts[at]! += 1;
    left -= 1;
  }
  return Object.fromEntries(types.map((monster, at) => [monster, Math.max(1, counts[at]!)]));
};

/**
 * Plan a raid, or null when the yard has nothing a raid could head for (no
 * harvester, storage, tower or other attackable building standing).
 */
export const planRaid = (input: RaidPlanInput): RaidPlan | null => {
  const rng = mulberry32(input.seed);
  const tribe = chooseRaidTribe(rng, input.level, input.camps ?? null);
  const yard = buildEngineYard({
    buildingdata: input.buildingdata,
    buildinghealthdata: input.buildinghealthdata ?? null,
    resources: input.resources ?? null,
    kind: "main",
  });
  const ranked = rankRaidSolutions(tribe, raidSolutions(tribe, yard, rng));
  const solution = ranked[0];
  if (!solution) return null;

  const threat = Math.max(0, Math.floor(input.threat ?? 0));
  const step = raidThreatStep(threat);
  const effect = RAID_PREFERENCES[input.preference];
  const target = solution.target;
  const tribeArmy = raidArmy(tribe, {
    types: yard.buildings.map((building) => building.type),
    level: input.level,
    amplifier: effect.amplifier * step.size,
    damageTaken: solution.damageTaken,
    resourcesGained: solution.resourcesGained,
    walk: raidWalk(Math.hypot(solution.entry.x - target.sx, solution.entry.y - target.sy)),
  });

  // The healers trail the army in; the whole is held to the cap.
  const armySize = Object.values(tribeArmy.monsters).reduce((sum, count) => sum + count, 0);
  const withHealers: Record<string, number> = { ...tribeArmy.monsters };
  const distances: Record<string, number> = { ...tribeArmy.distances };
  const behind = Math.max(RAID_WALK, ...Object.values(tribeArmy.distances)) + HEALER_LEAD;
  for (const [monster, share] of [
    [RAID_VORG, step.vorgShare],
    [RAID_ZAFREETI, step.zafreetiShare],
  ] as const) {
    const count = armySize > 0 ? healers(share, armySize) : 0;
    if (count <= 0) continue;
    withHealers[monster] = (withHealers[monster] ?? 0) + count;
    distances[monster] ??= behind;
  }
  const army = capRaidArmy(withHealers);

  // New draws only from here, so threat 0 keeps the seed's old raid.
  const sides = pickSideBearings(
    ranked.map((way) => way.bearing),
    step.sides,
  );
  const champion =
    step.championLevel > 0
      ? championRaider(rng, step.championLevel, step.championPower, undefined, dropTicks(RAID_CHAMPION_LEAVE_SECONDS))
      : undefined;

  return {
    tribe,
    bearing: solution.bearing,
    targetId: target.id,
    damageTaken: solution.damageTaken,
    army,
    log: {
      v: 1,
      seed: input.seed,
      events: stagedRaidEvents({
        bearings: sides,
        army,
        distances,
        drops: step.drops,
        dropGapTicks: dropTicks(step.dropGapSeconds),
        swarm: tribe === Tribe.KOZU,
        strength: step.strength,
        ...(champion ? { champion } : {}),
        retreatAfterTicks: dropTicks(step.retreatSeconds),
      }),
    },
    threat,
    sides,
    ...(champion ? { champion } : {}),
  };
};
