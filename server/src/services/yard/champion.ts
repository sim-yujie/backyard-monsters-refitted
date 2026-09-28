import { Filter as BadWords } from "bad-words";
import {
  atChampionLevel,
  championEntry,
  championMaxHealth,
  evolveShinyPrice,
  feedRecipe,
  feedShinyPrice,
  MAX_FOOD_BONUS,
  type ChampionEntry,
  type FeedRecipe,
} from "../../game-data/championCatalogue.js";
import type { ChampionData } from "../../schemas/ChampionSchema.js";
import type { BuildingData, BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { isMapRoom3Monsters } from "./hatchery.js";
import { juicerErr, juicerStatus, type JuiceSave } from "./juice.js";
import { readHoused } from "./production.js";
import { championHealPrice } from "./shiny.js";
import { yardBadRequestErr, yardRefusedErr } from "./yardErrors.js";

/**
 * The Champion Cage: `POST /bm/yard/champion/raise`, `/feed`, `/evolve`,
 * `/heal`, `/rename` and `/juice` (`docs/design/yard-buildings.md` §7.2,
 * decisions D11 and D17; issue #123; `docs/specs/monsters-and-hatchery.md` §7).
 *
 * **Storage** is the save's `champion` list as the original kept it
 * (`server/src/schemas/ChampionSchema.ts`): one entry per champion type, `l`
 * level 1-6, `hp`, `fd` feeds at this level, `fb` food-bonus rank 0-3, `ft` the
 * feed time (absolute while in the cage), `status` 0 in the cage, 1 frozen,
 * 2 juiced. Only one basic champion (Gorgo, Drull, Fomor, Korath) is in the
 * cage at a time (`CREATURES._guardian`, `client/scripts/CREATURES.as:219-239`);
 * every action here works on that one.
 *
 * **Raise** (`CHAMPIONSELECTPOPUP.RaiseGuard`, `CHAMPIONSELECTPOPUP.as:72-90`)
 * is free and only for Gorgo, Drull and Fomor (D17): level 1, full health, fed
 * for 23 hours. Refused while a champion is in the cage or while that type is
 * frozen in the Chamber.
 *
 * **Feed** (`CHAMPIONCAGE.FeedGuardian`, `CHAMPIONCAGE.as:682-877`), only once
 * the champion is hungry (`ft` has passed), except the top level's Shiny feed:
 *
 * - below level 6 a feed eats the level's recipe from housing (`monsters`) or
 *   costs the level's `feedShiny` (`shiny`); the feed count goes up and, at the
 *   level's `feedCount`, the champion evolves: next level, feeds back to 0,
 *   full health (`ChampionBase.levelSet`, `ChampionBase.as:731-773`);
 * - at level 6 a feed raises the food bonus one rank (at most 3) and adds that
 *   rank's bonus health; the Shiny price is the next rank's `bonusFeedShiny`,
 *   doubled while the champion is not hungry, and refused then at rank 3
 *   (`CHAMPIONCAGEPOPUP.as:445-533`);
 * - either way the next feeding is due 23 hours from now.
 *
 * **Evolve** now below level 6: `feedShiny × 2 × feeds still needed`
 * (`CHAMPIONCAGEPOPUP.EvolveClickB`, `:1223-1238`).
 *
 * **Heal**: full health for `timeCost(missing / max × healtime, false)`
 * (`ChampionBase.getHealCost`, `ChampionBase.as:1237-1241`); refused at full
 * health (`CHAMPIONCAGEPOPUP.as:434-442`).
 *
 * **Rename**: 1-20 characters, profanity refused (the original's name popup
 * took 12, `CHAMPIONNAMEPOPUP.as:27-30`; §7.2 widens it).
 *
 * **Juice** (`CHAMPIONCAGE.JuiceChampion`, `:303-307`, from the Juicer's panel,
 * `BUILDINGINFO.as:161-165`): the champion goes into a working Juicer for good,
 * status 2, and gives no goo (`BUILDING9.as:70-73`).
 *
 * Pure: the wrapper hands in the caught-up save, charges the Shiny and writes.
 */

/** Champion Cage type id (`client/scripts/CHAMPIONCAGE.as:22`). */
export const CHAMPION_CAGE_TYPE = 114;

/** Champion Chamber type id (`client/scripts/YARD_PROPS.as:6521`). */
export const CHAMPION_CHAMBER_TYPE = 119;

/** `ChampionBase` statuses (`client/scripts/com/monsters/monsters/champions/ChampionBase.as:26-36`). */
export const CHAMPION_STATUS = { ACTIVE: 0, FROZEN: 1, JUICED: 2 } as const;

/** The longest name `champion/rename` takes. */
export const CHAMPION_NAME_MAX = 20;

/** How a feed is paid for. */
export type FeedMode = "monsters" | "shiny";

/** The slice of a save the champion routes read. */
export interface ChampionSave extends JuiceSave {
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  monsters?: JsonObject | null;
  champion?: unknown;
}

/** A finite number off a jsonb field, 0 otherwise. */
const numberOf = (raw: unknown): number => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
};

/**
 * The `champion` column as a fresh array of entries, whatever shape it holds
 * (an old save may carry the Flash client's JSON string). Entries without a
 * known type are kept as they are, so a write never drops them.
 */
export const readChampions = (raw: unknown): ChampionData[] => {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.filter((one) => one && typeof one === "object").map((one) => ({ ...one }));
};

/** The catalogue entry for a save entry, or undefined for an unknown type. */
export const entryOf = (champion: ChampionData): ChampionEntry | undefined =>
  championEntry(Math.trunc(numberOf(champion.t)));

/** The status of a save entry; a missing one is "in the cage", as the original read it. */
export const statusOf = (champion: ChampionData): number => numberOf(champion.status ?? 0);

/** A save entry's level, clamped to 1..the champion's top level. */
export const levelOf = (champion: ChampionData, entry: ChampionEntry): number =>
  Math.min(Math.max(Math.trunc(numberOf(champion.l)) || 1, 1), entry.levels);

/** A save entry's food-bonus rank, clamped to 0..3. */
export const foodBonusOf = (champion: ChampionData): number =>
  Math.min(Math.max(Math.trunc(numberOf(champion.fb)), 0), MAX_FOOD_BONUS);

/** A save entry's feeds at its level, at least 0. */
export const feedsOf = (champion: ChampionData): number => Math.max(0, Math.trunc(numberOf(champion.fd)));

/** Full health for a save entry at its level and rank. */
export const maxHealthOf = (champion: ChampionData, entry: ChampionEntry): number =>
  championMaxHealth(entry, levelOf(champion, entry), foodBonusOf(champion));

/** True once the feed time has passed (`_feedTime < Timestamp()`, `CHAMPIONCAGEPOPUP.as:447`). */
export const isHungry = (champion: ChampionData, now: number): boolean => numberOf(champion.ft) < now;

/** Index of the basic champion in the cage, or -1 (`CHAMPIONCAGE.hasBasicChampion`, `:309-319`). */
export const activeChampionIndex = (champions: readonly ChampionData[]): number =>
  champions.findIndex(
    (champion) => statusOf(champion) === CHAMPION_STATUS.ACTIVE && entryOf(champion)?.kind === "basic"
  );

/** The first building of `type`, with its key, or null. */
export const buildingOfType = (
  save: { buildingdata?: BuildingDataMap | null },
  type: number
): { key: string; building: BuildingData } | null => {
  for (const [key, building] of Object.entries(save.buildingdata ?? {})) {
    if (Number(building?.t) === type) return { key, building };
  }
  return null;
};

/** The finished Champion Cage: `409 noCage` without one, `409 busy` while it is being built. */
export const cageOrThrow = (save: ChampionSave): BuildingData => {
  const cage = buildingOfType(save, CHAMPION_CAGE_TYPE);
  if (!cage) throw yardRefusedErr("noCage", "Build a Champion Cage first.");
  if (numberOf(cage.building.cB) > 0) {
    throw yardRefusedErr("busy", "Your Champion Cage is still being built.", { id: cage.building.id });
  }
  return cage.building;
};

/** The champion in the cage: `409 noChampion` when there is none. */
const activeOrThrow = (save: ChampionSave) => {
  const champions = readChampions(save.champion);
  const index = activeChampionIndex(champions);
  if (index < 0) throw yardRefusedErr("noChampion", "There is no champion in your cage.");
  const champion = champions[index]!;
  return { champions, index, champion, entry: entryOf(champion)! };
};

/** `report` of every champion route: the champion as it now stands. */
export interface ChampionReport {
  /** The champion the action worked on, after it. */
  champion: ChampionData;
}

/** `report` of `champion/feed`. */
export interface ChampionFeedReport extends ChampionReport {
  mode: FeedMode;
  /** Monsters eaten (`monsters`), empty for `shiny`. */
  eaten: Record<string, number>;
  /** Shiny charged (`shiny`), 0 for `monsters`. */
  credits: number;
  /** True when this feed evolved the champion to the next level. */
  evolved: boolean;
}

/** `report` of the Shiny routes: what was charged. */
export interface ChampionPaidReport extends ChampionReport {
  credits: number;
}

/** The champion one level up: feeds back to 0, full health, fed for another interval (`levelSet`). */
const evolved = (champion: ChampionData, entry: ChampionEntry, level: number, now: number): ChampionData => {
  const next = { ...champion, l: level + 1, fd: 0, ft: now + entry.feedTime };
  return { ...next, hp: maxHealthOf(next, entry) };
};

/**
 * `POST /bm/yard/champion/raise`: hatch a champion at the cage.
 *
 * Refusals, in order: `409 notRaisable { type }` (Korath and Krallen, D17);
 * `409 noCage` / `409 busy`; `409 championInCage` while a champion is in the
 * cage; `409 frozen { type }` while that champion is frozen in the Chamber
 * (`championchamber_alreadyfrozen`, `CHAMPIONSELECTPOPUP.as:77-80`).
 *
 * @param type - Champion type 1..5.
 * @param now - Unix seconds.
 */
export const planChampionRaise = (save: ChampionSave, type: number, now: number) => {
  const entry = championEntry(type);
  if (!entry?.raisable) {
    throw yardRefusedErr("notRaisable", "That champion cannot be raised at the cage.", { type });
  }
  cageOrThrow(save);

  const champions = readChampions(save.champion);
  if (activeChampionIndex(champions) >= 0) {
    throw yardRefusedErr("championInCage", "Your cage already holds a champion.");
  }
  const existing = champions.findIndex((champion) => Math.trunc(numberOf(champion.t)) === entry.t);
  if (existing >= 0 && statusOf(champions[existing]!) === CHAMPION_STATUS.FROZEN) {
    throw yardRefusedErr("frozen", `Your ${entry.name} is frozen in the Champion Chamber. Thaw it instead.`, {
      type,
    });
  }

  // A juiced (or otherwise gone) champion of the same type is replaced, as the
  // original re-used its entry (`RaiseGuard`, `:82-85`, then `export`).
  const champion: ChampionData = {
    t: entry.t,
    hp: atChampionLevel(entry.health, 1),
    l: 1,
    ft: now + entry.feedTime,
    fd: 0,
    fb: 0,
    pl: entry.powerLevel,
    status: CHAMPION_STATUS.ACTIVE,
  };
  if (existing >= 0) champions[existing] = champion;
  else champions.push(champion);

  const report: ChampionReport = { champion };
  return { report, slices: { champion: champions } };
};

/**
 * `POST /bm/yard/champion/feed`: feed the champion in the cage, from housing
 * or with Shiny.
 *
 * Refusals: `409 noCage` / `409 busy`; `409 noChampion`; `409 notHungry {
 * feedTime }` (monsters at any level, Shiny below level 6); `409 fullBuff` (Shiny
 * at level 6, not hungry, rank 3); for monsters `409 mapRoom3` and `409
 * notEnough { monster, have, need }`. The wrapper then refuses `409
 * shinyLocked` / `409 credits`.
 */
export const planChampionFeed = (save: ChampionSave, mode: FeedMode, now: number) => {
  cageOrThrow(save);
  const { champions, index, champion, entry } = activeOrThrow(save);
  const level = levelOf(champion, entry);
  const foodBonus = foodBonusOf(champion);
  const hungry = isHungry(champion, now);
  const top = level >= entry.levels;

  if (!hungry && (mode === "monsters" || !top)) {
    throw yardRefusedErr("notHungry", `Your ${entry.name} is not hungry yet.`, {
      feedTime: numberOf(champion.ft),
    });
  }
  if (!hungry && top && foodBonus >= MAX_FOOD_BONUS) {
    throw yardRefusedErr("fullBuff", `Your ${entry.name} is fully buffed.`);
  }

  let eaten: Record<string, number> = {};
  let credits = 0;
  let monsters: JsonObject | undefined;
  if (mode === "monsters") {
    if (isMapRoom3Monsters(save.monsters)) {
      throw yardRefusedErr("mapRoom3", "Feeding champions on a Map Room 3 yard is not supported yet.");
    }
    const recipe: FeedRecipe = feedRecipe(entry, level, foodBonus);
    const housed = readHoused(save.monsters);
    for (const [monster, need] of Object.entries(recipe)) {
      const have = housed[monster] ?? 0;
      if (have < need) {
        throw yardRefusedErr("notEnough", "You do not have enough of that monster housed.", {
          monster,
          have,
          need,
        });
      }
    }
    for (const [monster, need] of Object.entries(recipe)) {
      housed[monster] = housed[monster]! - need;
      if (housed[monster] === 0) delete housed[monster];
    }
    eaten = { ...recipe };
    monsters = { ...(save.monsters ?? {}), housed };
  } else {
    credits = feedShinyPrice(entry, level, foodBonus, hungry);
  }

  let fed: ChampionData;
  let didEvolve = false;
  if (top) {
    const rank = Math.min(foodBonus + 1, MAX_FOOD_BONUS);
    const next = { ...champion, fb: rank, ft: now + entry.feedTime };
    const max = maxHealthOf(next, entry);
    fed = { ...next, hp: Math.min(numberOf(champion.hp) + atChampionLevel(entry.bonusHealth, rank), max) };
  } else {
    const feeds = feedsOf(champion) + 1;
    if (feeds >= atChampionLevel(entry.feedCount, level)) {
      fed = evolved(champion, entry, level, now);
      didEvolve = true;
    } else {
      fed = { ...champion, fd: feeds, ft: now + entry.feedTime };
    }
  }
  champions[index] = fed;

  const report: ChampionFeedReport = { champion: fed, mode, eaten, credits, evolved: didEvolve };
  return {
    report,
    slices: { champion: champions, ...(monsters ? { monsters } : {}) },
    ...(credits > 0 ? { shiny: credits } : {}),
  };
};

/**
 * `POST /bm/yard/champion/evolve`: evolve the champion to the next level now,
 * for `feedShiny × 2 × feeds still needed`.
 *
 * Refusals: `409 noCage` / `409 busy`; `409 noChampion`; `409 maxLevel` at
 * the top level. The wrapper then refuses `409 shinyLocked` / `409 credits`.
 */
export const planChampionEvolve = (save: ChampionSave, now: number) => {
  cageOrThrow(save);
  const { champions, index, champion, entry } = activeOrThrow(save);
  const level = levelOf(champion, entry);
  if (level >= entry.levels) {
    throw yardRefusedErr("maxLevel", `Your ${entry.name} is fully evolved.`, { level });
  }
  const credits = evolveShinyPrice(entry, level, feedsOf(champion));
  const next = evolved(champion, entry, level, now);
  champions[index] = next;

  const report: ChampionPaidReport = { champion: next, credits };
  return { report, slices: { champion: champions }, ...(credits > 0 ? { shiny: credits } : {}) };
};

/** Shiny to heal a save entry to full now (`ChampionBase.getHealCost`). */
export const healPriceOf = (champion: ChampionData, entry: ChampionEntry): number => {
  const max = maxHealthOf(champion, entry);
  const missing = Math.max(0, max - numberOf(champion.hp));
  return championHealPrice(missing, max, atChampionLevel(entry.healtime, levelOf(champion, entry)));
};

/**
 * `POST /bm/yard/champion/heal`: heal the champion to full now.
 *
 * Refusals: `409 noCage` / `409 busy`; `409 noChampion`; `409 fullHealth`.
 * The wrapper then refuses `409 shinyLocked` / `409 credits`.
 */
export const planChampionHeal = (save: ChampionSave) => {
  cageOrThrow(save);
  const { champions, index, champion, entry } = activeOrThrow(save);
  const max = maxHealthOf(champion, entry);
  if (numberOf(champion.hp) >= max) {
    throw yardRefusedErr("fullHealth", `Your ${entry.name} is already at full health.`);
  }
  const credits = healPriceOf(champion, entry);
  const healed = { ...champion, hp: max };
  champions[index] = healed;

  const report: ChampionPaidReport = { champion: healed, credits };
  return { report, slices: { champion: champions }, ...(credits > 0 ? { shiny: credits } : {}) };
};

const profanity = new BadWords();

/**
 * `POST /bm/yard/champion/rename`: name the champion in the cage.
 *
 * Refusals: `400 badRequest` for an empty or over-long name (after trimming);
 * `409 nameRefused` for a name the profanity filter catches; `409 noChampion`.
 */
export const planChampionRename = (save: ChampionSave, raw: string) => {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > CHAMPION_NAME_MAX) {
    throw yardBadRequestErr(`A champion's name is 1 to ${CHAMPION_NAME_MAX} characters.`, {
      max: CHAMPION_NAME_MAX,
    });
  }
  if (profanity.isProfane(name)) {
    throw yardRefusedErr("nameRefused", "That name is not allowed. Pick another.");
  }
  const { champions, index, champion } = activeOrThrow(save);
  const renamed = { ...champion, nm: name };
  champions[index] = renamed;

  const report: ChampionReport = { champion: renamed };
  return { report, slices: { champion: champions } };
};

/**
 * `POST /bm/yard/champion/juice`: put the champion in the cage into the
 * Juicer for good. It gives no goo.
 *
 * Refusals: `409 noChampion`; the Juicer's own refusals (`noJuicer`, `busy`,
 * `damaged`, `juice.ts`).
 */
export const planChampionJuice = (save: ChampionSave) => {
  const { champions, index, champion } = activeOrThrow(save);
  const juicer = juicerStatus(save);
  if (juicer.problem) throw juicerErr(juicer.problem);
  const juiced = { ...champion, status: CHAMPION_STATUS.JUICED };
  champions[index] = juiced;

  const report: ChampionReport = { champion: juiced };
  return { report, slices: { champion: champions } };
};
