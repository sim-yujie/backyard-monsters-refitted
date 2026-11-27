import { RAID_MAX_SECONDS, ticks, type RaidEvent, type Roster } from "../../../game-rules/combat/index.js";
import { RAID_MAP_WIDTH } from "../../raids/raidArmy.js";
import { raidLanding } from "../../raids/raidPlan.js";
import type { WaveChampionGroup, WaveEventDefinition } from "./waveTypes.js";

/**
 * Planning one wave of a wave event (beta 10): the event's table turned into
 * the raid's spawn events, which the server fights once (`waveFight.ts`) and
 * the client plays back. Pure.
 *
 * As Flash's `SPECIALEVENT.SendWave` (`SPECIALEVENT_WM1.as:938-992`): the
 * whole wave comes in turned by one random quarter turn (`_randomDirection`,
 * 0, 90, 180 or 270 degrees); each group lands in a disc a quarter of the map
 * wide (`_loc1_[0][3] = _mapWidth * 0.25`), `800 + spread/2` out on its
 * bearing, as `WMATTACK.SpawnA` placed it (the emergence raid's rule,
 * `inferno/emergenceRaid.ts`). Each group lands at its own time.
 *
 * One difference: Flash sent the next group early once the field was clear
 * (`CREEPS._creepCount == 0`); here every group lands on its own timer, the
 * longest Flash would have waited.
 */

/** Flash's group spread: a quarter of the 800-wide map. */
export const WAVE_SPREAD = RAID_MAP_WIDTH * 0.25;

/**
 * Turns a champion group into a spawn event, or null when champions cannot
 * spawn yet. THE CHAMPION SEAM: raid-core's champion raiders
 * (`RaidEvent.champion = { t, l, pl?, fb?, hp? }`, branch feat/raid-core).
 * Until that lands the default spawns none and the wave runs without them;
 * once it is merged, {@link championRaidEvent} is the whole change:
 *
 *   ({ kind: "raid", t, x, y, r, monsters: {},
 *      champion: { t: group.guardian, l: group.level, fb: group.foodbonus, hp: group.health } })
 */
export type ChampionSpawner = (group: WaveChampionGroup, at: { t: number; x: number; y: number; r: number }) => RaidEvent | null;

/** The champion seam's current answer: none yet (see {@link ChampionSpawner}). */
export const championRaidEvent: ChampionSpawner = () => null;

export interface WavePlanInput {
  readonly event: WaveEventDefinition;
  /** 1-based. */
  readonly wave: number;
  /** The wave's quarter turn, 0-3 (Flash's `_randomDirection / 90`). */
  readonly quarter: number;
  readonly champions?: ChampionSpawner;
}

export interface WavePlan {
  readonly events: readonly RaidEvent[];
  /** Every monster in the wave, by id (champions not counted). */
  readonly army: Roster;
  /** The degrees the wave was turned by. */
  readonly turn: number;
  /** The last spawn's tick: the fight does not end before it (`BattleOptions.raidSpawnsUntil`). */
  readonly lastSpawnTick: number;
  /** Champion groups the seam could not spawn yet. */
  readonly championsSkipped: number;
}

/** The plan of wave `wave`, or null for a wave the event does not have. */
export const planWave = (input: WavePlanInput): WavePlan | null => {
  const groups = input.event.waves[input.wave - 1];
  if (!groups) return null;
  const turn = (((Math.trunc(input.quarter) % 4) + 4) % 4) * 90;
  const champions = input.champions ?? championRaidEvent;
  const events: RaidEvent[] = [];
  const army: Record<string, number> = {};
  let lastSpawnTick = 0;
  let championsSkipped = 0;
  for (const group of groups) {
    const t = ticks(group.at);
    const bearing = (group.bearing + turn) % 360;
    const landing = raidLanding(bearing, RAID_MAP_WIDTH + WAVE_SPREAD / 2, WAVE_SPREAD / 2);
    if (group.kind === "champion") {
      const spawned = champions(group, { t, ...landing });
      if (!spawned) {
        championsSkipped += 1;
        continue;
      }
      events.push(spawned);
    } else {
      if (group.count <= 0) continue;
      army[group.monster] = (army[group.monster] ?? 0) + group.count;
      events.push({
        kind: "raid",
        t,
        x: landing.x,
        y: landing.y,
        r: landing.r,
        monsters: { [group.monster]: group.count },
        level: group.level,
        ...(group.rank > 0 ? { rank: group.rank } : {}),
        ...(group.rage > 0 ? { rage: group.rage } : {}),
      });
    }
    lastSpawnTick = Math.max(lastSpawnTick, t);
  }
  return { events, army, turn, lastSpawnTick, championsSkipped };
};

/**
 * Whether a wave's fight was a win (Flash's `WMATTACK` clean-up for an event,
 * `WMATTACK.as:851-858`): every group spawned and none of them left standing,
 * and more than 10% of the yard still standing (`_loc3_ <= _loc4_ * 0.1` is a
 * loss). A raid's raiders all turn back at its cap (`RAID_MAX_SECONDS` from
 * the first tick, the engine's `retreatAt`), so a fight that ran to the cap
 * had raiders left: a loss. One that ended sooner ended because none was left.
 */
export const WAVE_WIN_HEALTH = 0.1;

export const waveBeaten = (outcome: { readonly ticks: number; readonly healthShare: number }): boolean =>
  outcome.healthShare > WAVE_WIN_HEALTH && outcome.ticks < ticks(RAID_MAX_SECONDS);

/** Total monsters in a wave, for the HUD's preview. */
export const waveSize = (event: WaveEventDefinition, wave: number): number =>
  (event.waves[wave - 1] ?? []).reduce((sum, group) => sum + (group.kind === "creep" ? group.count : 1), 0);
