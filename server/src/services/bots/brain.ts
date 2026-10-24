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
import { levelOf } from "../yardplanner/costs.js";
import { workerCount } from "../yardplanner/workers.js";
import { TRAP_TYPES } from "./layout.js";
import { bankPoints, botPointsForBuild, botPointsForUpgrade, targetInBand } from "./progression.js";
import { BOT_WORKERS, BUNKER_FILL, HOUSING_FILL, LOOT_BAND, type BotYard } from "./yardGenerator.js";

/**
 * The bot brain's decisions (issue #240, `docs/design/bot-neighbours.md` §4.4,
 * §4.5, §4.6 and §6): what a `grow` or `repair` job does to a bot's yard.
 * Everything here is pure; the sweep (`sweep.ts`)
 * locks the rows, runs these on the caught-up save and writes.
 *
 * ## The target (§4.4)
 *
 * A bot's place on the climb (`pacePosition` in `population.ts`) sets its
 * target: that far into the level's band ({@link targetAt}).
 *
 * ## Growth (§4.4)
 *
 * The bot's yard at its target is the generator's yard for its seed and that
 * target (`yardGenerator.ts`), and the generator's yard at a smaller target is
 * always a prefix of it: same ids, same spots, levels only rising. So growing
 * is a diff of the live yard against the generator's ({@link applyGrowth}): a
 * building the live yard lacks is built, one at a lower level is upgraded,
 * every step earning the points the generator counts for it
 * (`botPointsForBuild`, `botPointsForUpgrade`: a finished job's points, as
 * `catchUpBuildings.ts` awards them, and the banking a player did to pay for
 * it). Resources are not charged (§4.4): a bot has nobody farming for it, and
 * its loot is held in its band instead (§4.6).
 *
 * The last steps are left running on a real countdown, one per worker
 * ({@link BOT_WORKERS}, on different buildings), as a player's workers would
 * be, capped to finish before the next grow job. Their banking points come at
 * once; the catch-up finishes them and awards the job's own points then.
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

/** Points-plus-base-value of a level-band position: `floor(p)` and the fraction into it. */
export const targetAt = (position: number): number => {
  const level = Math.max(1, Math.floor(position));
  return targetInBand(level, position - level);
};

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
  /** The ids left on a countdown, in id order: at most one per worker. */
  running: number[];
  /** Empire points awarded now (the running steps' job points come when they finish). */
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

/** Points for taking a building from `from` to `to`: the build at level 0, each upgrade after, banking included. */
const stepPoints = (type: number, from: number, to: number): number => {
  const costs = costOf(type)?.costs ?? [];
  let points = 0;
  for (let level = from; level < to; level++) {
    const step = costs[level];
    if (!step) break;
    points += level === 0 ? botPointsForBuild(step) : botPointsForUpgrade(step);
  }
  return points;
};

/** The banking points of the step that takes a building of `type` to `level`, paid before it starts. */
const stepBank = (type: number, level: number): number => {
  const step = costOf(type)?.costs[level - 1];
  return step ? bankPoints(step) : 0;
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
  // A bot made before it had its workers gets them with its next growth.
  const liveBought = workerCount(save.storedata) - 1;
  const bought = Math.max(liveBought, yard.storedata.BEW.q);

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

  const report: GrowthReport = { built: [], upgraded: [], running: [], points: 0, picked: pick.size };
  if (builds.length === 0 && upgrades.length === 0) return report;

  // The steps left running: the latest buildings that hold a worker, one per worker.
  const holdsWorker = (want: Wanted) => want.l > 0 && !AT_ONCE_KINDS.has(costOf(want.t)?.kind ?? "");
  const running = new Set(
    [...builds, ...upgrades.map((upgrade) => upgrade.want)]
      .filter(holdsWorker)
      .sort((a, b) => b.id - a.id)
      .slice(0, BOT_WORKERS)
  );
  const secondsOf = (want: Wanted) => Math.max(1, Math.min(stepSeconds(want.t, want.l), Math.floor(runCap)));

  const buildingdata: BuildingDataMap = { ...(save.buildingdata ?? {}) };
  const health: BuildingHealthData = { ...(save.buildinghealthdata ?? {}) };

  for (const want of builds) {
    const left = running.has(want);
    const seconds = left ? secondsOf(want) : 0;
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
    report.points += stepPoints(want.t, 0, level) + (left ? stepBank(want.t, want.l) : 0);
  }

  for (const { want, key, building, from } of upgrades) {
    const left = running.has(want);
    const seconds = left ? secondsOf(want) : 0;
    const level = left ? want.l - 1 : want.l;
    const { cU: _upgrade, cB: _build, cL: _length, ...rest } = building;
    const next = { ...rest } as BuildingData;
    if (level > 0) next.l = level;
    if (left && level === 0) Object.assign(next, { cB: seconds, cL: seconds });
    else if (left) Object.assign(next, { cU: seconds, cL: seconds });
    buildingdata[key] = next;
    report.upgraded.push(want.id);
    // A step still running from the last grow had its banking paid then.
    const paid = building.cU !== undefined || building.cB !== undefined ? stepBank(want.t, from + 1) : 0;
    report.points += stepPoints(want.t, from, level) + (left ? stepBank(want.t, want.l) : 0) - paid;
  }

  report.running = [...running].map((want) => want.id).sort((a, b) => a - b);
  report.built.sort((a, b) => a - b);
  report.upgraded.sort((a, b) => a - b);

  save.buildingdata = buildingdata;
  save.buildinghealthdata = health;
  if (expansion > liveExpansion || bought > liveBought) {
    save.storedata = {
      ...(save.storedata ?? {}),
      ...(expansion > liveExpansion ? { ENL: { q: expansion } } : {}),
      ...(bought > liveBought ? { BEW: { q: bought } } : {}),
    };
  }
  if (pick.size > 0) {
    const mushrooms = readMushrooms(save.mushrooms);
    save.mushrooms = { ...(save.mushrooms ?? {}), l: mushrooms.l.filter((_, index) => !pick.has(index)) };
  }
  save.points = String(Number(save.points ?? 0) + report.points);
  return report;
};

/**
 * Lays the generator's `yard` over a live yard an older generator made
 * (`BOT_YARD_VERSION`, `yardGenerator.ts`), once: the buildings, decorations,
 * unlocks, academy levels, army and champion as a new bot of that yard has
 * them, nothing damaged or running, no trap gone off, and the mushrooms under
 * a building picked. Points become the yard's; the plot never shrinks; the
 * resources stay for {@link holdLootInBand}. Growth cannot take such a yard
 * to the new one: the new generator's yard is no growth of the old one (for
 * version 2 the build orders part at the first Town Hall upgrade), so the ids
 * no longer match and {@link applyGrowth} would refuse it. Mutates
 * `save`; the caller catches it up afterwards, as the factory settles a new
 * yard.
 */
export const rebuildYard = (save: BrainSave, yard: BotYard): void => {
  const placed = [...yard.buildings, ...yard.decorations];
  const covered = new Set<number>();
  for (const building of placed) {
    for (const index of mushroomsUnder(save, building.t, building.X, building.Y)) covered.add(index);
  }
  if (covered.size > 0) {
    const mushrooms = readMushrooms(save.mushrooms);
    save.mushrooms = { ...(save.mushrooms ?? {}), l: mushrooms.l.filter((_, index) => !covered.has(index)) };
  }
  const expansion = Math.max(currentExpansion(save.storedata), yard.storedata.ENL?.q ?? 0);
  save.storedata = { ...(save.storedata ?? {}), ...(expansion > 0 ? { ENL: { q: expansion } } : {}) };
  save.buildingdata = Object.fromEntries(
    placed.map((building) => [String(building.id), { ...building }])
  ) as unknown as BuildingDataMap;
  save.buildinghealthdata = {};
  save.firedtraps = [];
  save.points = yard.points;
  save.lockerdata = { ...yard.lockerdata };
  save.academy = { ...yard.academy };
  save.monsters = { housed: { ...yard.monsters.housed } };
  save.champion = yard.champion.map((champion) => ({ ...champion }));
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
