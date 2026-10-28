import { randomInt } from "node:crypto";

import type { RaidEvent, RaidLog, Roster } from "../../game-rules/combat/types.js";
import { calculateEmpirePoints } from "../base/calculateEmpirePoints.js";
import { playerLevelOf } from "../base/calculateBaseLevel.js";
import { raidLanding } from "../raids/raidPlan.js";
import { RAID_MAP_WIDTH } from "../raids/raidArmy.js";
import { newRaidId, openRaid, type OpenRaid } from "../raids/raidStore.js";
import { EMERGENCE_LEVELS } from "./emergence.js";

/**
 * Moloch's emergence raids (`docs/design/inferno.md` §2.3, WP 1.9): the army
 * Flash sent each time the cave went up (`INFERNO_PORTAL_ATTACK.as:8-49`),
 * spawned the way `WMATTACK.SpawnA`/`SpawnB` spawned it (`WMATTACK.as:678-775`),
 * and the raid opened for it on the load that raised the cave.
 *
 * The raid is an ordinary open raid (`raids/raidStore.ts`) under the tribe
 * {@link MOLOCH_TRIBE}, so the wild raid's own machinery fights and lands it
 * (`raids/raidFlow.ts`: `/raid/start`, `/raid/finish`). By the owner's I14/R5
 * the Flash rules hold rather than the wild raid's: it comes at once, with no
 * five-minute warning; bought protection does not call it off; it pays no
 * Shiny and leaves the wild raids' schedule alone (Flash's `_isAI` is false, so
 * `ResetWait` never runs, `WMATTACK.as:820-822`); and the stage counts whether
 * the yard holds or falls, or the player quits, because the cave's new level
 * was saved before the raid opened (`emergenceOnLoad.ts`).
 */

/** The open raid's tribe for Moloch's emergence raids. */
export const MOLOCH_TRIBE = "moloch";

/** Every wave comes in on this bearing, in degrees (`INFERNO_PORTAL_ATTACK.as:8`). */
export const EMERGENCE_BEARING = 186;

/**
 * The army's scale from the player's level `L` (`BASE.BaseLevel().level`):
 * `max(0.01, L/60 - 0.25)` up to level 30, then `(L-30)/16 + 0.25` held to
 * 0.25-1 (`INFERNO_PORTAL_ATTACK.as:11-29`).
 */
export const emergenceScale = (level: number): number => {
  if (level <= 30) return Math.max(0.01, level / 60 - 0.25);
  return Math.min(1, Math.max(0.25, (level - 30) / 16 + 0.25));
};

/** One of Flash's groups: `[type, "bounce", count, spread, bearing, 0, focus]`. */
export interface EmergenceGroup {
  readonly monster: string;
  readonly count: number;
  /** The landing disc's width, Flash's `param1[n][3]`: it lands `800 + spread/2` out, `spread/2` across. */
  readonly spread: number;
}

type Count = (scale: number) => number;
const ceil = (times: number): Count => (scale) => Math.ceil(scale * times);
const floor = (times: number): Count => (scale) => Math.floor(scale * times);

/** Flash's five armies, in its order (`INFERNO_PORTAL_ATTACK.as:30`). */
const ARMIES: readonly (readonly (readonly [string, Count, number])[])[] = [
  [["IC1", ceil(25), 400], ["IC1", ceil(25), 400], ["IC2", floor(50), 500], ["IC3", floor(15), 300]],
  [["IC1", ceil(45), 400], ["IC2", ceil(60), 500], ["IC3", floor(25), 300], ["IC5", floor(10), 500]],
  [["IC1", ceil(65), 400], ["IC2", ceil(60), 500], ["IC7", floor(15), 300], ["IC5", floor(15), 400], ["IC4", ceil(10), 600]],
  [["IC2", ceil(65), 500], ["IC6", floor(30), 300], ["IC3", ceil(40), 500], ["IC5", floor(20), 500], ["IC7", floor(20), 350]],
  [["IC2", ceil(70), 600], ["IC7", floor(30), 300], ["IC5", ceil(20), 500], ["IC6", ceil(30), 300], ["IC8", floor(25), 700]],
];

/**
 * The groups Moloch sends at cave level `caveLevel` (1-5; the level the cave
 * just went up to, as Flash read `INFERNOPORTAL`'s level after raising it) to
 * a player of level `level`. A group of none is left out, as Flash left it
 * (`:31-38`).
 */
export const emergenceGroups = (caveLevel: number, level: number): EmergenceGroup[] => {
  const index = Math.min(EMERGENCE_LEVELS, Math.max(1, Math.trunc(caveLevel))) - 1;
  const scale = emergenceScale(Math.trunc(level));
  return (ARMIES[index] ?? [])
    .map(([monster, count, spread]) => ({ monster, count: count(scale), spread }))
    .filter((group) => group.count > 0);
};

/**
 * Health and damage multiplier for every raider (`WMATTACK.SpawnB`,
 * `:729-753`), from the player's `points + basevalue`: x0.4, then x0.5 past
 * 1,000,000, x0.6 past 3,000,000, x0.7 past 6,000,000, x0.8 past 15,000,000
 * and x0.9 past 50,000,000. The owner kept Flash's strength for these raids
 * (I14), though not for the wild ones.
 */
export const emergenceStrength = (empirePoints: number): number => {
  if (empirePoints > 50_000_000) return 0.9;
  if (empirePoints > 15_000_000) return 0.8;
  if (empirePoints > 6_000_000) return 0.7;
  if (empirePoints > 3_000_000) return 0.6;
  if (empirePoints > 1_000_000) return 0.5;
  return 0.4;
};

/** The open raid's plan: what `raidFlow.ts` reads (`army`, `log`, `bearing`) and the cave level it is for. */
export interface EmergenceRaidPlan {
  readonly tribe: typeof MOLOCH_TRIBE;
  /** The cave level this raid is the stage of. */
  readonly level: number;
  readonly bearing: number;
  readonly strength: number;
  readonly army: Roster;
  readonly log: RaidLog;
}

/** What the planner is handed. */
export interface EmergenceRaidInput {
  /** The cave level just reached, 1-5. */
  readonly caveLevel: number;
  /** The main save's `points` and `basevalue`, which give the player's level and the strength. */
  readonly points?: string | null;
  readonly basevalue?: string | null;
  readonly seed: number;
}

/**
 * The raid: one wave per group, all at tick 0 on bearing
 * {@link EMERGENCE_BEARING}, each in its disc `800 + spread/2` out and
 * `spread/2` across, pulled onto the pathing grid as a wild raid's is
 * (`raidLanding`). Pure.
 */
export const planEmergenceRaid = (input: EmergenceRaidInput): EmergenceRaidPlan => {
  const level = playerLevelOf(input);
  const strength = emergenceStrength(calculateEmpirePoints(input.points ?? "0", input.basevalue ?? "0"));
  const army: Record<string, number> = {};
  const events: RaidEvent[] = [];
  for (const group of emergenceGroups(input.caveLevel, level)) {
    army[group.monster] = (army[group.monster] ?? 0) + group.count;
    const landing = raidLanding(EMERGENCE_BEARING, RAID_MAP_WIDTH + group.spread / 2, group.spread / 2);
    events.push({ kind: "raid", t: 0, x: landing.x, y: landing.y, r: landing.r, monsters: { [group.monster]: group.count }, strength });
  }
  return {
    tribe: MOLOCH_TRIBE,
    level: input.caveLevel,
    bearing: EMERGENCE_BEARING,
    strength,
    army,
    log: { v: 1, seed: input.seed, events },
  };
};

/**
 * Opens the raid for the cave level just reached, due at once: Flash's
 * warning (`INFERNO_EMERGENCE_ATTACKPOPUP`) has only the one button that
 * brings it on. Not opened when another raid already is (two loads at once:
 * the cave's raise lets only one through, so this is only a safeguard).
 *
 * @returns The opened raid, or null.
 */
export const openEmergenceRaid = async (
  userid: number,
  save: Pick<EmergenceRaidInput, "points" | "basevalue">,
  caveLevel: number,
  now: number
): Promise<OpenRaid | null> => {
  const seed = randomInt(1, 2 ** 31);
  const plan = planEmergenceRaid({ caveLevel, points: save.points, basevalue: save.basevalue, seed });
  const raid: OpenRaid = {
    id: newRaidId(),
    phase: "warning",
    tribe: MOLOCH_TRIBE,
    plan,
    seed,
    attackAt: now,
    warned: 0,
  };
  return (await openRaid(userid, raid, now)) ? raid : null;
};

/** One card of the warning screen: a monster type and its count. */
export interface EmergenceWarningGroup {
  readonly monster: string;
  readonly count: number;
}

/**
 * The raid's groups in Flash's order, as its warning screen shows them, one
 * card each (`INFERNO_EMERGENCE_ATTACKPOPUP.as` `onAdd`, fed
 * `GetVariableCreeps()`): raid 1's two Spurtz groups are two cards. Read from
 * the plan's waves, one per group; none for a raid that is not Moloch's.
 */
export const emergenceWarningGroups = (raid: OpenRaid): EmergenceWarningGroup[] => {
  if (!isEmergenceRaid(raid)) return [];
  const events = (raid.plan as Partial<EmergenceRaidPlan> | undefined)?.log?.events ?? [];
  return events.flatMap((event) =>
    event.kind === "raid" ? Object.entries(event.monsters).map(([monster, count]) => ({ monster, count: Number(count) })) : []
  );
};

/** Whether an open raid is one of Moloch's. */
export const isEmergenceRaid = (raid: Pick<OpenRaid, "tribe"> | null | undefined): boolean => raid?.tribe === MOLOCH_TRIBE;
