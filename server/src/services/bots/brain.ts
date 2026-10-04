import { costOf } from "../../game-data/buildingCosts.js";
import { MUSHROOM_TYPE } from "../../game-data/buildingFootprints.js";
import type { ChampionData } from "../../schemas/ChampionSchema.js";
import type { BuildingData, BuildingDataMap, BuildingHealthData, FiredTrap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { storageCap } from "../base/economy/resourceBudget.js";
import { placementProblem, type PlacementProblem } from "../yard/build.js";
import { BUNKER_TYPE, bunkerCapacity, bunkerSpace, readBunker } from "../yard/bunker.js";
import { CHAMPION_STATUS, entryOf, maxHealthOf, readChampions } from "../yard/champion.js";
import { cullHousing, housingCapacity, housingUsedBy } from "../yard/housing.js";
import { readMushrooms } from "../yard/mushrooms.js";
import { currentExpansion, overlaps, rectOf } from "../yardplanner/layoutGeometry.js";
import { levelOf, pointsForBuild, pointsForUpgrade } from "../yardplanner/costs.js";
import { BOT_MAX_LEVEL } from "./factory.js";
import { TRAP_TYPES } from "./layout.js";
import { targetInBand } from "./progression.js";
import { BUNKER_FILL, HOUSING_FILL, LOOT_BAND, type BotYard } from "./yardGenerator.js";

/**
 * The bot brain's decisions (issue #240, `docs/design/bot-neighbours.md` §4.4,
 * §4.5, §4.6 and §6): what a `grow` or `repair` job does to a bot's yard, and
 * the daily rebalance's plan. Everything here is pure; the sweep (`sweep.ts`)
 * locks the rows, runs these on the caught-up save and writes.
 *
 * ## The pace (§4.4, decision 17)
 *
 * A bot climbs one level every `BOTS_DAYS_PER_LEVEL` days. Its place on the
 * climb is `level + (now - level_since) × speed / T` levels ({@link pacePosition}),
 * and its target is that far into the level's band ({@link targetAt}): the
 * bottom of the band at `level_since`, the top `T` days later. `speed` is 1
 * unless the rebalance nudged it ({@link planRebalance}). When the yard's
 * level changes, `level_since` is moved so the place stays where it was
 * ({@link anchorFor}): a bot that could not grow for a while (damaged, under
 * attack) catches up on its next grow, it never loses the time.
 *
 * ## Growth (§4.4)
 *
 * The bot's yard at its target is the generator's yard for its seed and that
 * target (`yardGenerator.ts`), and the generator's yard at a smaller target is
 * always a prefix of it: same ids, same spots, levels only rising. So growing
 * is a diff of the live yard against the generator's ({@link applyGrowth}): a
 * building the live yard lacks is built, one at a lower level is upgraded,
 * every step earning the points a finished job earns (`pointsForBuild`,
 * `pointsForUpgrade`, as `catchUpBuildings.ts` awards them). Resources are
 * not charged (§4.4): a bot has nobody farming for it, and its loot is held
 * in its band instead (§4.6).
 *
 * The last step is left running on a real countdown, as a player's worker
 * would be, capped to finish before the next grow job, and the catch-up
 * finishes it and awards its points then.
 *
 * The live yard also holds what the generator does not know about: mushrooms
 * grow on free ground (`catchUpMushrooms.ts`). Every new spot is checked with
 * the build route's own rule (`placementProblem`) against the live yard; a
 * mushroom in the way is picked first, as a player would. Anything else in
 * the way means the yard is not the generator's, and the growth is refused as
 * a whole, nothing changed, for the sweep to log.
 *
 * ## Refills (§4.5, §4.6)
 *
 * Bunkers and Housing below their band go back to the generator's garrison
 * and army ({@link refillArmy}); the champion is fed, and on a repair healed
 * ({@link tendChampion}); each resource outside 25-70% of the storage cap is
 * moved to a random point inside it ({@link holdLootInBand}); traps that went
 * off are put back where they stood, with the ids they had
 * ({@link rearmFiredTraps}).
 */

const DAY = 24 * 60 * 60;

/** A bot retires once its place on the climb passes level 40 (decision 17). */
export const RETIRE_POSITION = BOT_MAX_LEVEL + 1;

/** The rebalance's pace nudges `[PLACEHOLDER]`: a slowed bot takes 4 days a level, a hurried one 2. */
export const SLOW_PACE = 0.75;
export const FAST_PACE = 1.5;

/** A bot may stand this many bots' places off its spot in the queue before the rebalance nudges it (§4.4). */
export const REBALANCE_SLACK = 2;

/**
 * With the rebalance running daily, no level should sit more than this many
 * bots off its share once it has had a few days (issue #251); the rebalance
 * logs a warning when one does.
 */
export const SPREAD_TOLERANCE = 4;

/** Points-plus-base-value of a level-band position: `floor(p)` and the fraction into it. */
export const targetAt = (position: number): number => {
  const level = Math.max(1, Math.floor(position));
  return targetInBand(level, position - level);
};

/** What the pace reads of a bot. */
export interface PaceBot {
  level: number;
  level_since: Date;
}

/**
 * Where on the climb a bot stands at `now` (unix seconds), in levels: its
 * level plus the share of `T / speed` days spent on it.
 */
export const pacePosition = (bot: PaceBot, now: number, daysPerLevel: number, speed = 1): number => {
  const since = bot.level_since.getTime() / 1000;
  return bot.level + (Math.max(0, now - since) * speed) / (daysPerLevel * DAY);
};

/**
 * `level_since` for a bot now on `level` that keeps it at `position`: the
 * part of the position past `level`, counted back at the bot's pace. Never in
 * the future.
 */
export const anchorFor = (position: number, level: number, now: number, daysPerLevel: number, speed = 1): Date =>
  new Date((now - (Math.max(0, position - level) * daysPerLevel * DAY) / speed) * 1000);

/** The slices of a save the brain reads and writes. */
export interface BrainSave {
  type?: string;
  points?: string;
  basevalue?: string;
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  storedata?: JsonObject | null;
  mushrooms?: JsonObject | null;
  resources?: JsonObject | null;
  monsters?: JsonObject | null;
  lockerdata?: JsonObject | null;
  academy?: JsonObject | null;
  champion?: ChampionData[];
  firedtraps?: FiredTrap[];
  outposts?: readonly unknown[] | null;
}

/** What {@link applyGrowth} did. */
export interface GrowthReport {
  /** Ids built, in id order. */
  built: number[];
  /** Ids upgraded, in id order. */
  upgraded: number[];
  /** The id left on a countdown, or null. */
  running: number | null;
  /** Empire points awarded now (the running step's come when it finishes). */
  points: number;
  /** Mushrooms picked to clear a spot. */
  picked: number;
}

/** Why a growth was refused: the live yard is not the generator's at some id. */
export interface GrowthRefusal {
  refused: { id: number; t: number; problem: PlacementProblem | { placement: "typeMismatch"; with: number } };
}

/** A building or decoration of the generator's yard, as the diff reads it. */
interface Wanted {
  id: number;
  t: number;
  X: number;
  Y: number;
  /** 0 for a decoration (it has no ladder). */
  l: number;
  extra: Partial<BuildingData>;
}

const wantedOf = (yard: BotYard): Wanted[] =>
  [
    ...yard.buildings.map(({ id, t, X, Y, l, m, st, pr }) => ({
      id,
      t,
      X,
      Y,
      l,
      extra: {
        ...(m ? { m } : {}),
        ...(st !== undefined ? { st } : {}),
        ...(pr !== undefined ? { pr } : {}),
      } as Partial<BuildingData>,
    })),
    ...yard.decorations.map(({ id, t, X, Y }) => ({ id, t, X, Y, l: 0, extra: {} })),
  ].sort((a, b) => a.id - b.id);

/** Kinds a worker never holds: they finish the moment they go up (`build.ts`, D13). */
const AT_ONCE_KINDS: ReadonlySet<string> = new Set(["wall", "trap"]);

/** Points for taking a building from `from` to `to`: the build at level 0, each upgrade after. */
const stepPoints = (type: number, from: number, to: number): number => {
  const costs = costOf(type)?.costs ?? [];
  let points = 0;
  for (let level = from; level < to; level++) {
    const step = costs[level];
    if (!step) break;
    points += level === 0 ? pointsForBuild(step) : pointsForUpgrade(step);
  }
  return points;
};

/** The countdown of the step that takes a building of `type` to `level` (`costs[level - 1]` time). */
const stepSeconds = (type: number, level: number): number => costOf(type)?.costs[level - 1]?.[4] ?? 0;

/** Every building keyed by id. */
const byId = (buildingdata: BuildingDataMap | null | undefined): Map<number, [string, BuildingData]> => {
  const map = new Map<number, [string, BuildingData]>();
  for (const [key, building] of Object.entries(buildingdata ?? {})) {
    if (building) map.set(Number(building.id ?? key), [key, building]);
  }
  return map;
};

/** Mushrooms whose footprint a building of `type` at `x`, `y` would cover. */
const mushroomsUnder = (save: BrainSave, type: number, x: number, y: number): number[] => {
  const rect = rectOf(type, x, y);
  return readMushrooms(save.mushrooms)
    .l.map((entry, index) => ({ index, rect: rectOf(MUSHROOM_TYPE, entry[1], entry[2]) }))
    .filter(({ rect: other }) => overlaps(rect, other))
    .map(({ index }) => index);
};

/**
 * Grows the live yard to the generator's `yard` (see the file comment).
 * Mutates `save` (new top-level objects for every slice it changes) unless it
 * refuses, in which case nothing is changed.
 *
 * @param save - The caught-up bot yard.
 * @param yard - The generator's yard at the bot's target.
 * @param runCap - The longest countdown the last step may be left on, seconds.
 */
export const applyGrowth = (save: BrainSave, yard: BotYard, runCap: number): GrowthReport | GrowthRefusal => {
  const live = byId(save.buildingdata);
  const wanted = wantedOf(yard);

  // The plot first: a new spot is measured against the plot it was laid out on.
  const liveExpansion = currentExpansion(save.storedata);
  const expansion = Math.max(liveExpansion, yard.storedata.ENL?.q ?? 0);
  const view: BrainSave = { ...save, storedata: { ...(save.storedata ?? {}), ENL: { q: expansion } } };

  const builds: Wanted[] = [];
  const upgrades: { want: Wanted; key: string; building: BuildingData; from: number }[] = [];
  const pick = new Set<number>();

  for (const want of wanted) {
    const found = live.get(want.id);
    if (!found) {
      const problem = placementProblem(view, { type: want.t, x: want.X, y: want.Y });
      if (problem) return { refused: { id: want.id, t: want.t, problem } };
      for (const index of mushroomsUnder(save, want.t, want.X, want.Y)) pick.add(index);
      builds.push(want);
      continue;
    }
    const [key, building] = found;
    if (Number(building.t) !== want.t) {
      return { refused: { id: want.id, t: want.t, problem: { placement: "typeMismatch", with: Number(building.t) } } };
    }
    const from = levelOf(building);
    if (want.l > from) upgrades.push({ want, key, building, from });
  }

  const report: GrowthReport = { built: [], upgraded: [], running: null, points: 0, picked: pick.size };
  if (builds.length === 0 && upgrades.length === 0) return report;

  // The step left running: the latest building that holds a worker.
  const holdsWorker = (want: Wanted) => want.l > 0 && !AT_ONCE_KINDS.has(costOf(want.t)?.kind ?? "");
  const running = [...builds, ...upgrades.map((upgrade) => upgrade.want)]
    .filter(holdsWorker)
    .reduce<Wanted | null>((latest, want) => (!latest || want.id > latest.id ? want : latest), null);
  const seconds = running ? Math.max(1, Math.min(stepSeconds(running.t, running.l), Math.floor(runCap))) : 0;

  const buildingdata: BuildingDataMap = { ...(save.buildingdata ?? {}) };
  const health: BuildingHealthData = { ...(save.buildinghealthdata ?? {}) };

  for (const want of builds) {
    const left = want === running;
    const level = left ? want.l - 1 : want.l;
    // A garrison or buffer sized for the finished level waits for the refill after it.
    const extra = left ? {} : want.extra;
    const building = { id: want.id, t: want.t, X: want.X, Y: want.Y, ...extra } as BuildingData;
    if (want.l > 0) {
      if (level > 0) building.l = level;
      if (left && level === 0) Object.assign(building, { cB: seconds, cL: seconds });
      else if (left) Object.assign(building, { cU: seconds, cL: seconds });
    }
    buildingdata[String(want.id)] = building;
    // A trap that went off left a zero here under its id (`rearmTraps.ts`).
    delete health[String(want.id)];
    report.built.push(want.id);
    report.points += stepPoints(want.t, 0, level);
  }

  for (const { want, key, building, from } of upgrades) {
    const left = want === running;
    const level = left ? want.l - 1 : want.l;
    const { cU: _upgrade, cB: _build, cL: _length, ...rest } = building;
    const next = { ...rest } as BuildingData;
    if (level > 0) next.l = level;
    if (left && level === 0) Object.assign(next, { cB: seconds, cL: seconds });
    else if (left) Object.assign(next, { cU: seconds, cL: seconds });
    buildingdata[key] = next;
    report.upgraded.push(want.id);
    report.points += stepPoints(want.t, from, level);
  }

  report.running = running?.id ?? null;
  report.built.sort((a, b) => a - b);
  report.upgraded.sort((a, b) => a - b);

  save.buildingdata = buildingdata;
  save.buildinghealthdata = health;
  if (expansion > liveExpansion) save.storedata = view.storedata;
  if (pick.size > 0) {
    const mushrooms = readMushrooms(save.mushrooms);
    save.mushrooms = { ...(save.mushrooms ?? {}), l: mushrooms.l.filter((_, index) => !pick.has(index)) };
  }
  save.points = String(Number(save.points ?? 0) + report.points);
  return report;
};

/** Monster id to academy level, as the space rules read it. */
const academyLevels = (academy: JsonObject | null | undefined): Record<string, number> =>
  Object.fromEntries(
    Object.entries(academy ?? {}).map(([id, entry]) => [id, Number((entry as { level?: unknown })?.level) || 1])
  );

/**
 * Unlocks and academy levels never go back; bunkers and Housing below their
 * band's floor get the generator's garrison and army (§4.2 step 3, §4.5).
 *
 * @returns Whether the bunkers or Housing were refilled.
 */
export const refillArmy = (save: BrainSave, yard: BotYard): { bunkers: number; housing: boolean } => {
  save.lockerdata = { ...yard.lockerdata, ...(save.lockerdata ?? {}) };
  const academy: JsonObject = { ...(save.academy ?? {}) };
  for (const [id, entry] of Object.entries(yard.academy)) {
    const have = Number((academy[id] as { level?: unknown } | undefined)?.level) || 0;
    if (entry.level > have) academy[id] = { ...(academy[id] ?? {}), level: entry.level };
  }
  save.academy = academy;
  const levels = academyLevels(academy);

  const garrisons = new Map(yard.buildings.filter((b) => b.t === BUNKER_TYPE).map((b) => [b.id, b]));
  const buildingdata: BuildingDataMap = { ...(save.buildingdata ?? {}) };
  let bunkers = 0;
  for (const [key, building] of Object.entries(buildingdata)) {
    if (Number(building?.t) !== BUNKER_TYPE) continue;
    const want = garrisons.get(Number(building.id ?? key));
    const level = levelOf(building);
    const room = bunkerCapacity(level);
    // A bunker still growing to the generator's level is refilled once it gets there.
    if (!want?.m || want.l !== level || room <= 0) continue;
    if (bunkerSpace(readBunker(building), levels) >= Math.ceil(room * BUNKER_FILL.min)) continue;
    buildingdata[key] = { ...building, m: { ...want.m } };
    bunkers++;
  }
  if (bunkers > 0) save.buildingdata = buildingdata;

  const housed = (save.monsters?.housed ?? {}) as Record<string, number>;
  const room = housingCapacity({ buildingdata: save.buildingdata, buildinghealthdata: save.buildinghealthdata }, false);
  const housing = room > 0 && housingUsedBy(housed, levels) < Math.ceil(room * HOUSING_FILL.min);
  // The generator's army fits the generator's Housing; a Housing still upgrading holds less.
  if (housing) save.monsters = { ...(save.monsters ?? {}), housed: cullHousing(yard.monsters.housed, room, levels).housed };
  return { bunkers, housing };
};

/**
 * The champion in its cage at the generator's level for the bot's level (never
 * lower), fed now; on a repair (`heal`) also at full health and active.
 * A yard with no cage keeps whatever it has.
 */
export const tendChampion = (save: BrainSave, yard: BotYard, heal: boolean): boolean => {
  const want = yard.champion[0];
  if (!want) return false;
  const champions = readChampions(save.champion);
  const have = champions[0];
  const entry = have ? entryOf(have) : undefined;
  if (!have || !entry || Number(have.t) !== want.t) {
    save.champion = [{ ...want }];
    return true;
  }
  const fresh: ChampionData = {
    ...have,
    l: Math.max(Number(have.l) || 1, want.l),
    fb: Math.max(Number(have.fb) || 0, want.fb ?? 0),
    pl: want.pl,
    ft: want.ft,
    fd: 0,
  };
  const grew = fresh.l !== Number(have.l) || fresh.fb !== (Number(have.fb) || 0);
  if (heal || grew) Object.assign(fresh, { hp: maxHealthOf(fresh, entry), status: CHAMPION_STATUS.ACTIVE });
  save.champion = [fresh, ...champions.slice(1)];
  return true;
};

const RESOURCE_KEYS = ["r1", "r2", "r3", "r4"] as const;

/**
 * Each resource outside {@link LOOT_BAND} of the storage cap moves to a random
 * point inside it (§4.6); one inside stays. The caps are written as the
 * generator writes them.
 *
 * @returns The resources moved.
 */
export const holdLootInBand = (save: BrainSave, rng: () => number): string[] => {
  const cap = storageCap(save);
  const resources: JsonObject = { ...(save.resources ?? {}) };
  const moved: string[] = [];
  for (const key of RESOURCE_KEYS) {
    const have = Number(resources[key]) || 0;
    if (have < cap * LOOT_BAND.min || have > cap * LOOT_BAND.max) {
      resources[key] = Math.floor(cap * (LOOT_BAND.min + (LOOT_BAND.max - LOOT_BAND.min) * rng()));
      moved.push(key);
    }
    resources[`${key}max`] = cap;
  }
  save.resources = resources;
  return moved;
};

/**
 * Puts back the traps that went off (`firedtraps`): each generator trap of
 * the same type and spot that the yard lacks, under its own id, and strikes
 * the record off as the planner's re-arm does (`rearmTraps.ts`). A spot that
 * is taken now is left.
 *
 * @returns How many traps were put back.
 */
export const rearmFiredTraps = (save: BrainSave, yard: BotYard): number => {
  const fired = save.firedtraps ?? [];
  if (fired.length === 0) return 0;
  const live = byId(save.buildingdata);
  const traps = yard.buildings.filter((building) => TRAP_TYPES.has(building.t) && !live.has(building.id));

  const buildingdata: BuildingDataMap = { ...(save.buildingdata ?? {}) };
  const health: BuildingHealthData = { ...(save.buildinghealthdata ?? {}) };
  const left: FiredTrap[] = [];
  let rearmed = 0;
  for (const record of fired) {
    const index = traps.findIndex((trap) => trap.t === record.t && trap.X === record.X && trap.Y === record.Y);
    const trap = index >= 0 ? traps[index]! : null;
    if (
      !trap ||
      placementProblem({ ...save, buildingdata }, { type: trap.t, x: trap.X, y: trap.Y }) ||
      mushroomsUnder(save, trap.t, trap.X, trap.Y).length > 0
    ) {
      left.push(record);
      continue;
    }
    traps.splice(index, 1);
    buildingdata[String(trap.id)] = { id: trap.id, t: trap.t, X: trap.X, Y: trap.Y, l: trap.l } as unknown as BuildingData;
    delete health[String(trap.id)];
    rearmed++;
  }
  if (rearmed === 0) return 0;
  save.buildingdata = buildingdata;
  save.buildinghealthdata = health;
  save.firedtraps = left;
  return rearmed;
};

/** One active bot as the rebalance sees it. */
export interface RebalanceBot {
  userid: number;
  level: number;
  level_since: Date;
  speed: number;
}

/** A pace the rebalance sets, with the anchor that keeps the bot where it stands. */
export interface PaceNudge {
  userid: number;
  speed: number;
  level_since: Date;
}

/** The daily rebalance's plan. */
export interface RebalancePlan {
  nudges: PaceNudge[];
  /** Level 1 bots to make. */
  topUp: number;
}

/**
 * The daily rebalance (§4.4) against the even spread `share` (index 0 is
 * level 1). The bots queue up by their place on the climb, furthest on first,
 * and each place in the queue has a spot: the first `share[39]` places spread
 * evenly through level 40, the next `share[38]` through level 39, and so on.
 * A bot more than {@link REBALANCE_SLACK} bots' places ahead of its spot is
 * slowed to {@link SLOW_PACE}, one as far behind it hurried to
 * {@link FAST_PACE}, and one near it goes back to the normal pace. So a
 * crowded level's furthest-on bots move on sooner and its newest arrivals
 * linger behind, and the bots around a thin level close in on it, until every
 * level holds about its share.
 *
 * A nudge lasts until the bot's next level (the grow job sets the pace back
 * to 1 then) or the next rebalance, and moves `level_since` so the bot keeps
 * its place on the climb ({@link anchorFor}). A bot already at the pace asked
 * is left alone.
 *
 * The total is topped back up with level 1 bots, at most as many as level 1
 * has room for within its share and the slack, so a near-empty table is not
 * refilled at level 1 all at once (the factory's `create --fill` spreads a
 * fresh population over the levels; the rest follow on later days). While
 * the table is short no pace is nudged: the queue's spots assume a full table,
 * and the gaps are the fill's and the top-up's to close.
 */
export const planRebalance = (
  bots: readonly RebalanceBot[],
  share: readonly number[],
  total: number,
  now: number,
  daysPerLevel: number
): RebalancePlan => {
  const levelOne = bots.filter((bot) => bot.level === 1).length;
  const missing = Math.max(0, total - bots.length);
  const levelOneRoom = Math.max(0, (share[0] ?? 0) + REBALANCE_SLACK - levelOne);
  const topUp = Math.min(missing, levelOneRoom);
  if (missing > 0) return { nudges: [], topUp };

  // A bot that could not grow stands at the top of its level, not past it.
  const placed = bots
    .map((bot) => ({ bot, at: Math.min(pacePosition(bot, now, daysPerLevel, bot.speed), bot.level + 0.999999) }))
    .sort((a, b) => b.at - a.at);

  const nudges: PaceNudge[] = [];
  let level = share.length;
  let inLevel = 0;
  for (const { bot, at } of placed) {
    while (level > 1 && inLevel >= (share[level - 1] ?? 0)) {
      level--;
      inLevel = 0;
    }
    const want = Math.max(1, share[level - 1] ?? 0);
    const spot = level + 1 - (inLevel + 0.5) / want;
    inLevel++;
    const ahead = (at - spot) * want;
    const speed = ahead > REBALANCE_SLACK ? SLOW_PACE : ahead < -REBALANCE_SLACK ? FAST_PACE : 1;
    if (speed === bot.speed) continue;
    nudges.push({ userid: bot.userid, speed, level_since: anchorFor(at, bot.level, now, daysPerLevel, speed) });
  }

  return { nudges, topUp };
};
