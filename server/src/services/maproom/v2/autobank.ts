import { LockMode, type EntityManager } from "@mikro-orm/core";
import {
  productionScheduleOfUser,
  weightedFactor,
  type ProductionFactor,
} from "../../alliance/productionHistory.js";
import { Save } from "../../../database/models/save.model.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { BaseType } from "../../../enums/Base.js";
import { AUTOBANK_TICK, autobankTicks } from "../../../game-rules/maproom/autobank.js";
import { MapRoomVersion } from "../../../enums/MapRoom.js";
import { LandFeature, landIncome } from "../../../game-rules/combat/index.js";
import { activeLandFeature } from "./landFeature.js";
import { productionOf } from "../../../game-data/buildingCosts.js";
import type { BuildingData, BuildingDataMap, BuildingHealthData } from "../../../types/BuildingData.js";
import type { JsonObject } from "../../../types/JsonObject.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { RESOURCE_KEYS, noAmounts, type ResourceKey } from "../../base/economy/resourceBudget.js";
import { isAttackActive } from "../../base/isAttackActive.js";
import { creditResources, type CreditSave } from "../../yard/credit.js";
import { catchUpOutpostBuildings } from "../../yard/catchUp.js";
import type { CatchUpBuildingsSave } from "../../yard/catchUpBuildings.js";
import { harvesterHealth, overdriveEnd } from "../../yard/catchUpHarvesters.js";
import { levelOf, type ResourceAmounts } from "../../yardplanner/costs.js";

/**
 * Map Room 2 outpost income, worked out and paid by the server (outposts WP4,
 * issue #185; #179 for the attack side).
 *
 * Outposts have no pool of their own and their harvesters bank nothing by
 * hand. Instead every outpost earns a fixed income into its owner's main pool,
 * which the Flash client paid through its owner saves
 * (`client/scripts/com/monsters/autobanking/AutoBankManager.as`). Owner saves
 * are retired, so the server pays it now, with Flash's rules:
 *
 * - **Rate** (`updateBuildingResources`, `:176-236`): per outpost, per 10 s,
 *   the sum over its Twig Snappers, Pebble Shiners, Putty Squishers and Goo
 *   Factories (types 1 to 4, `:192`) with health above 0 (`:193`) of
 *   `max(int(produce[l - 1] * 125 / cellHeight), 1)` (`:199-200`), from the
 *   outpost props table (`OUTPOST_YARD_PROPS`, `productionOf(t, "outpost")`).
 *   A harvester being upgraded counts at its next level (`:196-198`); one still
 *   being built is level 0 (`BFOUNDATION.as:3121-3123`), so its missing
 *   `produce[-1]` makes it the minimum 1. Damage does not lower it. 125 is
 *   `GLOBAL._averageAltitude` (`GLOBAL.as:398`); a cell with no height reads
 *   as 100 (`AutoBankManager.as:97-103`).
 * - **Payout** (`autobank`, `:238-279`): every 10 s tick funds `rate *
 *   overdrive` of each resource (`:258-269`), where `overdrive` is 2 while
 *   Production Overdrive runs and 1 otherwise (`:258-263`,
 *   `client/scripts/STORE.as:2413-2418`). Offline time counts, at most two days
 *   of it (`:75-77`). `BASE.Fund` clamps each credit to the storage cap and the
 *   overflow is lost (`client/scripts/BASE.as:4476-4536`; `credit.ts`).
 * - **Points**: `ceil(0.375 * paid)` empire points (`:278`), `paid` being
 *   what actually landed under the cap (`Fund`'s return value, `:267`).
 *
 * Differences, all deliberate:
 *
 * - The server pays whole 10 s ticks and moves `t` on by exactly those, so the
 *   part of a tick not yet reached is paid next time rather than rounded away
 *   (Flash's online clock paid whole ticks too; its offline catch-up floored
 *   `rate * seconds / 10` once).
 * - Production Overdrive counts for the ticks up to its end, as Flash's
 *   online ticks did. Flash's offline catch-up doubled the whole gap when the
 *   overdrive was still running on return and none of it when it had just run
 *   out. The overdrive is the player's, read off the main yard's `storedata`.
 * - With no `t` on record (a yard that never autobanked), nothing is paid and
 *   `t` is stamped; Flash fell back to the save's `savetime` (`:73`).
 * - The rate is worked out at every payout, each outpost's row replayed from
 *   its `savetime` the way its own catch-up would (`outpostTimeline`): a
 *   harvester whose build finished while nobody had that outpost open pays its
 *   new level from the moment it finished, and one repaired from nothing earns
 *   again from the repair's start, without the outpost being opened. Flash
 *   recomputed the rate only when an outpost session saved, so such a
 *   harvester kept its old rate until its owner next looked.
 *
 * `buildingresources` on the main yard keeps `t`, the moment income has been
 * paid up to, and one `b<baseid>: {r1..r4}` rate per outpost (the shape Flash
 * wrote). The server writes the whole column; the client never does
 * (`baseSave.ts`). The economy audit's `outpostAllowance` reads the rates.
 *
 * Every payout runs under the main yard's row lock (`SELECT … FOR UPDATE`):
 * the owner's load and every yard action (`controllers/yard/yardAction.ts`),
 * and an attack load of any yard whose owner has outposts
 * (`baseModeAttack.ts`, before the loot snapshot). The main row is the only
 * row it writes, so two payouts for one player run one after the other and
 * the second finds `t` already moved: an interval is paid once.
 *
 * The tick count, the two-day window, the overdrive and the cap clamp are the
 * shared rule in `game-rules/maproom/autobank.ts` (issue #207), which the web
 * client runs too to predict these payouts between answers.
 *
 * This module never imports `server.ts`, so it runs under test with a
 * stand-in entity manager.
 */

export {
  AUTOBANK_OVERDRIVE,
  AUTOBANK_TICK,
  autobankTicks,
  type AutobankTicks,
} from "../../../game-rules/maproom/autobank.js";

/** `GLOBAL._averageAltitude` (`client/scripts/GLOBAL.as:398`). */
export const AVERAGE_ALTITUDE = 125;

/** The height a cell with none reads as (`AutoBankManager.as:97-103`). */
export const DEFAULT_CELL_HEIGHT = 100;

/** Points per resource banked (`AutoBankManager.as:278`). */
export const AUTOBANK_POINTS = 0.375;

/** A rate of one a tick, for counting ticks with `autobankTicks`. */
const ONE_EACH: ResourceAmounts = { r1: 1, r2: 1, r3: 1, r4: 1 };

/** The four harvester types, which are also the resource they make (`AutoBankManager.as:192`). */
const isOutpostHarvester = (type: number): boolean => type >= 1 && type <= 4;

/** The slice of an outpost row the rate reads. */
export interface OutpostIncomeSave {
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  /**
   * The moment the row's countdowns and health were measured at (its last
   * catch-up or save); none means they are taken as they stand.
   */
  savetime?: number | null;
}

/** The height the rate divides by: the cell's, or 100 when it has none. */
export const incomeHeight = (terrainHeight: number | null | undefined): number => {
  const height = Number(terrainHeight);
  return Number.isFinite(height) && height > 0 ? height : DEFAULT_CELL_HEIGHT;
};

/**
 * What one outpost harvester adds per 10 s tick, or 0 for anything that is
 * not one or has no health left (`AutoBankManager.as:192-200`).
 *
 * @param building - The building row.
 * @param health - Its health, undefined at full (`harvesterHealth`).
 * @param height - The outpost cell's height ({@link incomeHeight}).
 */
export const harvesterIncome = (
  building: BuildingData,
  health: number | undefined,
  height: number,
  land: number = LandFeature.OPEN
): number => {
  const type = Number(building.t);
  if (!isOutpostHarvester(type)) return 0;
  if (health !== undefined && !(health > 0)) return 0;

  const level = levelOf(building) + (Number(building.cU) > 0 ? 1 : 0);
  const produce = Math.trunc(Number(productionOf(type, "outpost")?.produce[level - 1] ?? 0));
  // The height rule, then the cell's land feature for this resource (`landIncome`).
  return landIncome(Math.max(Math.trunc((produce * AVERAGE_ALTITUDE) / height), 1), land, type);
};

/**
 * One outpost's income per 10 s tick, per resource
 * (`AutoBankManager.updateBuildingResources`, `:176-236`).
 *
 * @param outpost - The outpost's buildings and their health.
 * @param height - The outpost cell's height ({@link incomeHeight}).
 */
export const outpostIncome = (
  outpost: OutpostIncomeSave,
  height: number,
  land: number = LandFeature.OPEN
): ResourceAmounts => {
  const rate = noAmounts();
  for (const [key, building] of Object.entries(outpost.buildingdata ?? {})) {
    if (!building) continue;
    const type = Number(building.t);
    if (!isOutpostHarvester(type)) continue;
    rate[`r${type}` as ResourceKey] += harvesterIncome(
      building,
      harvesterHealth(outpost, key, building),
      height,
      land
    );
  }
  return rate;
};

/** A step in an outpost's income: from `at` on, it earns `delta` more a tick. */
export interface IncomeChange {
  /** Unix seconds. */
  at: number;
  /** Per resource, per tick; negative for less. */
  delta: ResourceAmounts;
}

/** What an outpost earns now, and the steps that took it there since its row was saved. */
export interface OutpostTimeline {
  /** Per tick, as it stands at `now`. */
  rate: ResourceAmounts;
  /** Each change since the row's `savetime`, oldest first. */
  changes: IncomeChange[];
}

/**
 * A harvester whose income a replay could change: one being built (level 0
 * until it is done) or being repaired (nothing while it has no health). An
 * upgrade already counts at its next level, so its finish changes nothing,
 * and a fortification never touches income.
 */
const isMoving = (building: BuildingData | null | undefined): boolean =>
  Boolean(building) && isOutpostHarvester(Number(building!.t)) && Boolean(building!.cB || building!.rE);

/** A copy of the outpost holding only its harvesters, for a replay to move. */
const harvestersOf = (outpost: OutpostIncomeSave): CatchUpBuildingsSave => ({
  type: BaseType.OUTPOST,
  buildingdata: Object.fromEntries(
    Object.entries(outpost.buildingdata ?? {}).filter(
      ([, building]) => building && isOutpostHarvester(Number(building.t))
    )
  ),
  buildinghealthdata: outpost.buildinghealthdata ?? null,
});

const minus = (a: ResourceAmounts, b: ResourceAmounts): ResourceAmounts => {
  const out = noAmounts();
  for (const key of RESOURCE_KEYS) out[key] = a[key] - b[key];
  return out;
};

const isNothing = (amounts: ResourceAmounts): boolean => RESOURCE_KEYS.every((key) => amounts[key] === 0);

/**
 * An outpost's income from its row's `savetime` to `now`, with the row
 * replayed the way its own catch-up would replay it
 * (`catchUpOutpostBuildings`: repairs, then countdowns): a harvester whose
 * build finished while nobody had the outpost open pays its new level from
 * the moment it finished, and one repaired from nothing earns again from the
 * repair's start. Flash froze each outpost's rate at its last session's save
 * until the owner looked again (the file comment); this pays what the outpost
 * really earned.
 *
 * Only the outpost's harvesters are replayed, on a copy: the row is read, not
 * changed (its own catch-up moves it when it is next opened). A row with no
 * harvester counting down or repairing is not replayed at all.
 *
 * @param outpost - The row as last saved.
 * @param height - The cell's height ({@link incomeHeight}).
 * @param land - The cell's land feature.
 * @param now - Unix seconds.
 */
export const outpostTimeline = (
  outpost: OutpostIncomeSave,
  height: number,
  land: number,
  now: number
): OutpostTimeline => {
  const stored = outpostIncome(outpost, height, land);
  const savetime = Number(outpost.savetime);
  const buildings = Object.values(outpost.buildingdata ?? {});
  if (!(Number.isFinite(savetime) && savetime > 0 && now > savetime) || !buildings.some(isMoving)) {
    return { rate: stored, changes: [] };
  }

  const rateAt = (moment: number): ResourceAmounts => {
    const copy = harvestersOf(outpost);
    catchUpOutpostBuildings(copy, savetime, moment);
    return outpostIncome(copy, height, land);
  };

  // The moments the rate can move: every finish the replay to now reports,
  // and the first second of a repair (a harvester with no health earns again
  // as soon as it has any).
  const replay = harvestersOf(outpost);
  const moments = new Set(catchUpOutpostBuildings(replay, savetime, now).map((job) => job.at));
  if (buildings.some((building) => isMoving(building) && building!.rE)) moments.add(savetime + 1);

  const changes: IncomeChange[] = [];
  let previous = stored;
  for (const at of [...moments].filter((at) => at > savetime && at < now).sort((a, b) => a - b)) {
    const rate = rateAt(at);
    const delta = minus(rate, previous);
    if (!isNothing(delta)) changes.push({ at, delta });
    previous = rate;
  }
  const rate = outpostIncome(replay, height, land);
  const delta = minus(rate, previous);
  if (!isNothing(delta)) changes.push({ at: now, delta });

  return { rate, changes };
};

/** The slice of the main yard a payout reads and writes. */
export interface AutobankSave extends CreditSave {
  buildingresources?: JsonObject | null;
  storedata?: JsonObject | null;
  points?: string | null;
}

/** What one payout did. */
export interface AutobankReport {
  /** What landed in the pool. */
  paid: ResourceAmounts;
  /** What did not fit under the cap, and was lost. */
  overflow: ResourceAmounts;
  /** Empire points awarded. */
  points: number;
  /** Seconds paid for. */
  seconds: number;
}

/** `buildingresources.t`, or undefined when there is none. */
const lastPaid = (buildingresources: JsonObject | null | undefined): number | undefined => {
  const raw = buildingresources?.t;
  if (raw === undefined || raw === null || raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

/**
 * Pays the main yard what its outposts earned since `buildingresources.t`, and
 * writes the rates and the new `t` (the file comment). Pure apart from
 * mutating `main`.
 *
 * @param main - The owner's main yard, locked. Its `resources`, `points` and
 *   `buildingresources` are written.
 * @param rates - Each outpost's income per tick, by `baseid`.
 * @param now - Unix seconds.
 * @param completed - What the main yard's catch-up finished in this request:
 *   a Production Overdrive that ran out in it is gone from `storedata`, and its
 *   end is read from here (`overdriveEnd`).
 * @param changes - How the rates moved during the interval
 *   ({@link outpostTimeline}): `rates` are the rates at `now`, and each tick
 *   that ran out at or before a change's `at` is paid without its `delta`.
 *   A change at or before the start of the interval counts for all of it.
 * @param factor - The owner's alliance production factor, or its schedule
 *   when it changed during the interval (`productionHistory.ts`).
 */
export const payAutobank = (
  main: AutobankSave,
  rates: Readonly<Record<string, ResourceAmounts>>,
  now: number,
  completed: readonly unknown[] = [],
  changes: readonly IncomeChange[] = [],
  factor: ProductionFactor = 1
): AutobankReport => {
  const total = noAmounts();
  const column: JsonObject = {};
  for (const [baseid, rate] of Object.entries(rates)) {
    column[`b${baseid}`] = { ...rate };
    for (const key of RESOURCE_KEYS) total[key] += rate[key];
  }

  const last = lastPaid(main.buildingresources);
  const until = overdriveEnd(main, completed);
  const { owed, ticks, t } = autobankTicks(total, last, now, until);
  if (ticks > 0 && changes.length > 0) {
    // The ticks paid from `start` to now, overdrive doubling included, by the
    // same count as the whole interval's.
    const paidFrom = (start: number): number => autobankTicks(ONE_EACH, start, now, until).owed.r1;
    const from = t - ticks * AUTOBANK_TICK;
    const all = paidFrom(from);
    for (const { at, delta } of changes) {
      if (!(at > from)) continue;
      const before = Math.min(ticks, Math.floor((at - from) / AUTOBANK_TICK));
      const earlier = all - paidFrom(from + before * AUTOBANK_TICK);
      for (const key of RESOURCE_KEYS) owed[key] -= delta[key] * earlier;
    }
    for (const key of RESOURCE_KEYS) owed[key] = Math.max(0, owed[key]);
  }
  // The owner's alliance production bonus (`allianceBonuses.ts`), on what the
  // ticks earned: each tick at the factor that held when it ran
  // (`productionHistory.ts`), so a bonus gained or lost while away is not
  // applied to time before it.
  const paidFactor =
    ticks > 0
      ? weightedFactor(t - ticks * AUTOBANK_TICK, now, factor, (start) => autobankTicks(ONE_EACH, start, now, until).owed.r1)
      : 1;
  if (paidFactor !== 1) for (const key of RESOURCE_KEYS) owed[key] = Math.max(0, Math.floor(owed[key] * paidFactor));
  const { credited, overflow } = creditResources(main, owed);

  const banked = credited.r1 + credited.r2 + credited.r3 + credited.r4;
  const points = Math.ceil(banked * AUTOBANK_POINTS);
  if (points > 0) main.points = String(Number(main.points ?? "0") + points);

  main.buildingresources = { t, ...column };

  return { paid: credited, overflow, points, seconds: ticks * AUTOBANK_TICK };
};

/** The outpost columns the rate reads. */
const OUTPOST_FIELDS = [
  "basesaveid",
  "baseid",
  "type",
  "saveuserid",
  "mapversion",
  "buildingdata",
  "buildinghealthdata",
  "savetime",
] as const;

/** The player's outposts' income: each one's rate now, and how they moved. */
export interface OutpostIncomes {
  /** Per tick, by `baseid`, at `now`. */
  rates: Record<string, ResourceAmounts>;
  /** Every outpost's changes since its row was saved ({@link outpostTimeline}). */
  changes: IncomeChange[];
}

/**
 * Each of the player's Map Room 2 outposts' income per tick, by `baseid`: the
 * outposts listed in the main yard's `outposts` that are theirs, over their
 * cells' heights (`world_map_cell.terrainHeight`, as `combatCellHeight` reads
 * it for the towers), each replayed from its row's `savetime` to `now`
 * ({@link outpostTimeline}).
 *
 * @param em - The transaction's entity manager.
 * @param main - The owner's main yard.
 * @param now - Unix seconds.
 * @param inHand - An outpost row the caller already holds (locked, and not
 *   yet caught up), used as it is rather than read again. One already caught
 *   up to `now` is fine too: it simply has nothing left to replay.
 */
export const outpostIncomes = async (
  em: EntityManager,
  main: Pick<Save, "outposts" | "saveuserid">,
  now: number,
  inHand: Save | null = null
): Promise<OutpostIncomes> => {
  const none: OutpostIncomes = { rates: {}, changes: [] };
  const listed = [...new Set((main.outposts ?? []).map(([, , baseid]) => String(baseid)))];
  if (listed.length === 0) return none;

  const others = listed.filter((baseid) => baseid !== inHand?.baseid);
  const rows: Save[] = [];
  if (inHand && listed.includes(inHand.baseid)) rows.push(inHand);
  if (others.length > 0) {
    const found = await em.find(
      Save,
      { baseid: { $in: others }, saveuserid: main.saveuserid, type: BaseType.OUTPOST },
      { fields: OUTPOST_FIELDS }
    );
    rows.push(...(found as unknown as Save[]));
  }

  const outposts = rows.filter(
    (row) =>
      row.type === BaseType.OUTPOST &&
      row.saveuserid === main.saveuserid &&
      Number(row.mapversion) !== MapRoomVersion.V3
  );
  if (outposts.length === 0) return none;

  const cells = await em.find(
    WorldMapCell,
    { baseid: { $in: outposts.map((row) => row.baseid) }, map_version: MapRoomVersion.V2 },
    { fields: ["baseid", "terrainHeight", "x", "y", "world"] }
  );
  const heights = new Map(cells.map((cell) => [String(cell.baseid), cell.terrainHeight]));
  // Each cell's land feature (`landFeature.ts`), open with the switch off.
  const lands = new Map(
    cells.map((cell) => [
      String(cell.baseid),
      cell.world?.uuid ? activeLandFeature(cell.world.uuid, cell.x, cell.y, cell.terrainHeight) : 0,
    ])
  );

  const result: OutpostIncomes = { rates: {}, changes: [] };
  for (const row of outposts) {
    const { rate, changes } = outpostTimeline(
      row,
      incomeHeight(heights.get(row.baseid)),
      lands.get(row.baseid) ?? 0,
      now
    );
    result.rates[row.baseid] = rate;
    result.changes.push(...changes);
  }
  return result;
};

/**
 * Autobanks one player: works out their outposts' rates and pays the main
 * yard up to `now` ({@link payAutobank}). Only a Map Room 2 player autobanks
 * (`AutoBankManager.as:251`; Map Room 3 has its own, in `baseLoad.ts`); for
 * anyone else it does nothing and returns null.
 *
 * The caller holds the main row's lock and flushes.
 *
 * @param em - The transaction's entity manager.
 * @param main - The owner's main yard row, locked.
 * @param now - Unix seconds.
 * @param completed - What the main yard's catch-up finished in this request.
 * @param inHand - The outpost row the request acts on, if any.
 */
export const autobankYard = async (
  em: EntityManager,
  main: Save,
  now: number,
  completed: readonly unknown[] = [],
  inHand: Save | null = null
): Promise<AutobankReport | null> => {
  if (main.type !== BaseType.MAIN || Number(main.mapversion) !== MapRoomVersion.V2) return null;
  const { rates, changes } = await outpostIncomes(em, main, now, inHand);
  if (Object.keys(rates).length === 0) return payAutobank(main, rates, now, completed, changes);
  const factor = await productionScheduleOfUser(em, main.saveuserid);
  return payAutobank(main, rates, now, completed, changes, factor);
};

/**
 * The attack load's autobank of a defending outpost's owner (issue #179):
 * their main yard is locked, paid and written, so the pool the attack load
 * then snapshots for the loot (`baseModeAttack.ts`) holds what the outposts
 * earned. A defending main yard gets the same inside its locked catch-up
 * (`catchUpLockedYard`). Skipped while the main yard itself is being attacked:
 * that attack's save owns the pool then.
 *
 * @param em - The request's entity manager.
 * @param saveuserid - The defender's owner.
 */
export const autobankOwner = async (
  em: EntityManager,
  saveuserid: number
): Promise<AutobankReport | null> =>
  em.transactional(async (tx) => {
    const main = await tx.findOne(
      Save,
      { saveuserid, type: BaseType.MAIN },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }
    );
    if (!main || isAttackActive(main)) return null;

    const report = await autobankYard(tx, main, getCurrentDateTime());
    await tx.flush();
    return report;
  });
