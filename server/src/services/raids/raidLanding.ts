import type { Save } from "../../database/models/save.model.js";
import type { ResourceAmounts } from "../../game-rules/combat/index.js";
import type { BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { buildingDataHandler } from "../../controllers/base/save/handlers/buildingDataHandler.js";
import { buildingDataWithout } from "../base/combat/abandonedAttack.js";
import { garrisonsAfterBattle } from "../base/combat/bunkerGarrison.js";
import { championsAfterDefence } from "../base/combat/defenderChampion.js";
import { landHousingLoss, lostCount } from "../base/combat/housingLoss.js";
import { storedDamage } from "../base/storedDamage.js";
import { damagedBuildings } from "../yard/repair.js";
import type { RaidFightOutcome } from "./raidFight.js";
import { readSchedule, recordRaidFinished, scheduleColumn, type RaidRecord } from "./raidSchedule.js";

/**
 * Applying a wild monster raid's outcome to the player's yard at finish (#226
 * WP3, `docs/design/wild-raids.md` §6.3): the defender's half of an attack
 * landing, on the caught-up save under its row lock. The outcome is the
 * server's own (`raidFight.ts`, run at the fight's start); nothing comes from
 * the client.
 *
 * - **Traps** that fired are gone and kept in `firedtraps` for re-arming, as
 *   any defence lands them (`buildingDataHandler`).
 * - **Bunkers and the caged champion** as the fight left them
 *   (`garrisonsAfterBattle`, `championsAfterDefence`).
 * - **Health** into `buildinghealthdata` and each building's `hp`, which the
 *   repairs keep in step (`services/yard/repair.ts`); the stored damage
 *   percentage as an attack stores it.
 * - **Housing**: a Housing that fell takes its share of the housed monsters,
 *   as in any defence (Flash's `BUILDING15`, `housingLoss.ts`).
 * - **Repairs** (D3): `rE: 1` on every damaged building not already
 *   repairing, Flash's `CleanUp` (`WMATTACK.as:829-840`); the catch-up heals
 *   them from here.
 * - **Theft** (D3): the bank loses what storage hits and falls took, and each
 *   harvester what it gave up from its unbanked amount (`st`), each clamped
 *   at what is there now, since harvesters kept filling during the fight and
 *   nothing may take the bank below 0. The PvP landing never wrote a drained
 *   harvester back; this is new.
 * - **Good defence** (D4, new): a health share of 90% or more pays 10 Shiny.
 * - **Schedule**: the wait starts again from the fight's start, and the raid
 *   is kept in `recent` (`recordRaidFinished`), which also lifts the yard's
 *   fight lock.
 *
 * Pure apart from mutating the save it is handed.
 */

/** A health share at or above this is a good defence (D4; Flash's popup threshold, `WMATTACK.as:860-865`). */
export const GOOD_DEFENCE_SHARE = 0.9;

/** Shiny a good defence pays (D4). */
export const GOOD_DEFENCE_SHINY = 10;

/** The slice of the main save the landing reads and writes. */
export type RaidLandingSave = Pick<
  Save,
  | "type"
  | "mapversion"
  | "wmid"
  | "buildingdata"
  | "buildinghealthdata"
  | "resources"
  | "credits"
  | "champion"
  | "monsters"
  | "academy"
  | "storedata"
  | "firedtraps"
  | "damage"
  | "aiattacks"
>;

/** What the player is told; `recent` keeps its core. */
export interface RaidResult {
  readonly id: string;
  readonly tribe: string;
  /** Unix seconds the fight started. */
  readonly at: number;
  /** The yard held at least {@link GOOD_DEFENCE_SHARE}. */
  readonly defended: boolean;
  /** The health share, 0 to 1, over the damage percentage's buildings (`raidFight.ts`). */
  readonly health: number;
  /** What the raiders took, bank and harvesters together, as it came off. */
  readonly stolen: ResourceAmounts;
  /** Shiny paid: {@link GOOD_DEFENCE_SHINY} or 0. */
  readonly shiny: number;
  /** Buildings left damaged, all repairing now, in id order. */
  readonly damaged: readonly number[];
  /** Housed monsters lost with fallen Housings. */
  readonly housedLost: number;
}

/** The raid being landed. */
export interface RaidLandingInput {
  readonly id: string;
  readonly tribe: string;
  /** Unix seconds the fight started. */
  readonly startedAt: number;
  readonly outcome: RaidFightOutcome;
}

const RESOURCES = ["r1", "r2", "r3", "r4"] as const;
type ResourceKey = (typeof RESOURCES)[number];

/** A harvester's resource by its type: 1 twigs, 2 pebbles, 3 putty, 4 goo. */
const HARVESTER_RESOURCE: Readonly<Record<number, ResourceKey>> = { 1: "r1", 2: "r2", 3: "r3", 4: "r4" };

const amount = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Every building's `hp` in step with the health map: set where the map has it below full. */
const withHealth = (buildingdata: BuildingDataMap, health: BuildingHealthData): BuildingDataMap => {
  const out: BuildingDataMap = {};
  for (const [key, building] of Object.entries(buildingdata)) {
    if (!building) continue;
    const hp = health[String(building.id ?? key)];
    out[key] = hp === undefined ? building : { ...building, hp: Math.max(0, Math.floor(Number(hp))) };
  }
  return out;
};

/**
 * Lands a raid on the save, and the schedule with it.
 *
 * @param save - The player's main yard, caught up and locked; mutated.
 * @param raid - The raid and the fight's outcome.
 * @param now - Unix seconds, for the Housing rules.
 */
export const landRaid = (save: RaidLandingSave, raid: RaidLandingInput, now: number): RaidResult => {
  const { outcome } = raid;
  const healthBefore = save.buildinghealthdata;

  buildingDataHandler(buildingDataWithout(save.buildingdata as JsonObject, outcome.firedTraps), save as Save);
  const health: BuildingHealthData = { ...outcome.health };
  save.buildingdata = withHealth(
    garrisonsAfterBattle(save.buildingdata, { buildinghealthdata: health, bunkerGarrisons: outcome.bunkerGarrisons }),
    health
  );
  save.buildinghealthdata = health;
  save.champion = championsAfterDefence(save.champion, outcome.defenderChampion) ?? save.champion;
  save.damage = storedDamage(outcome.damage) ?? save.damage;
  const housing = landHousingLoss(save, { before: healthBefore, after: health }, save, now);

  const buildingdata: BuildingDataMap = { ...save.buildingdata };
  const damaged: number[] = [];
  for (const damage of damagedBuildings(save)) {
    damaged.push(damage.id);
    if (!damage.repairing) buildingdata[damage.key] = { ...buildingdata[damage.key]!, rE: 1 };
  }

  const keyOfId = new Map(Object.entries(buildingdata).map(([key, building]) => [String(building?.id ?? key), key]));
  const stolen: Record<ResourceKey, number> = { r1: 0, r2: 0, r3: 0, r4: 0 };
  for (const [id, gave] of Object.entries(outcome.harvesterLoss)) {
    const key = keyOfId.get(id);
    const building = key === undefined ? undefined : buildingdata[key];
    const resource = building ? HARVESTER_RESOURCE[Number(building.t)] : undefined;
    if (key === undefined || !building || !resource) continue;
    const held = Math.max(0, amount(building.st));
    const taken = Math.min(held, Math.max(0, Math.trunc(gave)));
    if (taken <= 0) continue;
    buildingdata[key] = { ...building, st: held - taken };
    stolen[resource] += taken;
  }
  save.buildingdata = buildingdata;

  const resources: JsonObject = { ...(save.resources ?? {}) };
  for (const key of RESOURCES) {
    const held = Math.max(0, amount(resources[key]));
    const taken = Math.min(held, Math.max(0, Math.trunc(outcome.bankLoss[key])));
    if (taken <= 0) continue;
    resources[key] = held - taken;
    stolen[key] += taken;
  }
  save.resources = resources;

  const defended = outcome.healthShare >= GOOD_DEFENCE_SHARE;
  const shiny = defended ? GOOD_DEFENCE_SHINY : 0;
  if (shiny > 0) save.credits = amount(save.credits) + shiny;

  const share = Math.round(outcome.healthShare * 1000) / 1000;
  const record: RaidRecord = { id: raid.id, at: raid.startedAt, tribe: raid.tribe, health: share, stolen: { ...stolen }, shiny };
  save.aiattacks = scheduleColumn(recordRaidFinished(readSchedule(save.aiattacks), record));

  return {
    id: raid.id,
    tribe: raid.tribe,
    at: raid.startedAt,
    defended,
    health: share,
    stolen: { ...stolen },
    shiny,
    damaged,
    housedLost: housing ? lostCount(housing) : 0,
  };
};

/** A raid already landed, as `recent` kept it, for a finish sent twice. */
export const landedResult = (aiattacks: unknown, raidId: string): RaidResult | null => {
  const record = readSchedule(aiattacks).recent.find((entry) => entry.id === raidId);
  if (!record) return null;
  return {
    id: record.id,
    tribe: record.tribe,
    at: record.at,
    defended: record.shiny > 0,
    health: record.health,
    stolen: { r1: 0, r2: 0, r3: 0, r4: 0, ...record.stolen },
    shiny: record.shiny,
    damaged: [],
    housedLost: 0,
  };
};
