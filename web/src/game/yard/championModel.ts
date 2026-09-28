import type { BaseLoadResponse, ChampionSaveEntry } from "@/api/types";
import { monsterEntry } from "@/game/monsters/monsterCatalogue";
import { timeCost } from "./buildingCosts";
import {
  atChampionLevel,
  CHAMPION_CATALOGUE,
  championEntry,
  championMaxHealth,
  evolveShinyPrice,
  feedRecipe,
  feedShinyPrice,
  MAX_FOOD_BONUS,
  STARVE_SECONDS,
  type ChampionEntry,
} from "./championCatalogue";

/**
 * The Champion Cage on the client (`docs/design/yard-buildings.md` §7.2,
 * issue #124): what the cage panel shows, worked out from the save.
 *
 * The same rules the server applies (`server/src/services/yard/champion.ts`,
 * `catchUpChampions.ts`), for the labels and the local refusals only; every
 * route recomputes. Health is predicted forward from the save's `savetime` the
 * way the server's catch-up heals, `int(max × 5 / healtime)` per whole
 * 5-second period of the clock (`champions/ChampionBase.as:1047-1053`), so the
 * bar fills while the panel is open and Heal's price falls with it.
 */

/** Champion Cage type id (`client/scripts/CHAMPIONCAGE.as:22`). */
export const CHAMPION_CAGE_TYPE = 114;

/** Champion Chamber type id (`client/scripts/YARD_PROPS.as:6521`). */
export const CHAMPION_CHAMBER_TYPE = 119;

/** `ChampionBase` statuses (`champions/ChampionBase.as:26-36`). */
export const ChampionStatus = { ACTIVE: 0, FROZEN: 1, JUICED: 2 } as const;

/** The longest name `champion/rename` takes. */
export const CHAMPION_NAME_MAX = 20;

/** Seconds between two passive heals. */
const HEAL_PERIOD = 5;

const numberOf = (raw: unknown): number => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
};

/** The save's champion list, whatever shape it arrived in. */
export const championsOf = (save: BaseLoadResponse): ChampionSaveEntry[] => {
  const raw: unknown = save.champion;
  return Array.isArray(raw)
    ? raw.filter((one): one is ChampionSaveEntry => !!one && typeof one === "object")
    : [];
};

const statusOf = (champion: ChampionSaveEntry): number => numberOf(champion.status ?? 0);

/** The catalogue entry for a save entry. */
export const entryOfChampion = (champion: ChampionSaveEntry): ChampionEntry | undefined =>
  championEntry(Math.trunc(numberOf(champion.t)));

/** The basic champion in the cage, if any (`CHAMPIONCAGE.hasBasicChampion`, `:309-319`). */
export const activeChampion = (save: BaseLoadResponse): ChampionSaveEntry | null =>
  championsOf(save).find(
    (champion) =>
      statusOf(champion) === ChampionStatus.ACTIVE && entryOfChampion(champion)?.kind === "basic",
  ) ?? null;

/** Every champion frozen in the Chamber. */
export const frozenChampions = (save: BaseLoadResponse): ChampionSaveEntry[] =>
  championsOf(save).filter(
    (champion) => statusOf(champion) === ChampionStatus.FROZEN && entryOfChampion(champion),
  );

/** How the champion's hunger stands. */
export type Hunger =
  /** Fed: hungry at `hungryAt`. */
  | "fed"
  /** Hungry: feed it before `starvesAt` or it loses a feed (or a food-bonus rank). */
  | "hungry"
  /** Past `starvesAt`: the server takes the feed on its next answer. */
  | "starving";

/** One monster of the feed recipe against what housing holds. */
export interface RecipeRow {
  readonly monster: string;
  readonly name: string;
  readonly need: number;
  readonly have: number;
}

/** Everything the cage panel shows for the champion in it. */
export interface ChampionView {
  readonly entry: ChampionEntry;
  readonly champion: ChampionSaveEntry;
  /** The player's name for it, or the champion's own. */
  readonly name: string;
  readonly level: number;
  /** True at the top level, where feeding raises the food bonus instead. */
  readonly top: boolean;
  readonly feeds: number;
  /** Feeds that evolve it out of this level; 0 at the top. */
  readonly feedCount: number;
  readonly foodBonus: number;
  /** Health now, predicted from the save with the passive heal. */
  readonly health: number;
  readonly maxHealth: number;
  /** Unix seconds it will be at full health; null when it is. */
  readonly fullAt: number | null;
  readonly hunger: Hunger;
  /** Unix seconds it turns hungry (`ft`). */
  readonly hungryAt: number;
  /** Unix seconds it starves (`ft + 24 h`). */
  readonly starvesAt: number;
  readonly recipe: readonly RecipeRow[];
  /** True when housing holds the whole recipe. */
  readonly canFeedMonsters: boolean;
  /**
   * The Shiny feed, or null when it is not on offer: below the top level only
   * while hungry; at the top whenever the rank is below 3 or it is hungry
   * (doubled while not hungry).
   */
  readonly feedShiny: number | null;
  /** Shiny to evolve now; null at the top level. */
  readonly evolveShiny: number | null;
  /** Shiny to heal now; 0 at full health. */
  readonly healShiny: number;
  /** Damage with the food bonus, as the cage's stats show it. */
  readonly damage: number;
}

/** The cage's state for the panel. */
export type CageView =
  | { readonly kind: "noCage" }
  | { readonly kind: "building" }
  /** No champion in the cage: the raise cards, and which types are frozen. */
  | { readonly kind: "empty"; readonly choices: readonly RaiseChoice[] }
  | { readonly kind: "active"; readonly view: ChampionView };

/** One raise card. */
export interface RaiseChoice {
  readonly entry: ChampionEntry;
  /** True while this champion is frozen in the Chamber: thaw it instead. */
  readonly frozen: boolean;
}

/** Health now: the stored figure plus the passive heal since `savetime`, capped. */
export const predictedHealth = (
  champion: ChampionSaveEntry,
  entry: ChampionEntry,
  savetime: number,
  now: number,
): number => {
  const level = levelOf(champion, entry);
  const max = championMaxHealth(entry, level, foodBonusOf(champion));
  const hp = numberOf(champion.hp);
  if (hp >= max) return max;
  const periods = Math.max(0, Math.floor(now / HEAL_PERIOD) - Math.floor(savetime / HEAL_PERIOD));
  const rate = Math.trunc((max * HEAL_PERIOD) / atChampionLevel(entry.healtime, level));
  return Math.min(max, hp + rate * periods);
};

const levelOf = (champion: ChampionSaveEntry, entry: ChampionEntry): number =>
  Math.min(Math.max(Math.trunc(numberOf(champion.l)) || 1, 1), entry.levels);

const foodBonusOf = (champion: ChampionSaveEntry): number =>
  Math.min(Math.max(Math.trunc(numberOf(champion.fb)), 0), MAX_FOOD_BONUS);

/** The view of a champion in the cage at `now`. */
export const championView = (
  save: BaseLoadResponse,
  champion: ChampionSaveEntry,
  now: number,
): ChampionView | null => {
  const entry = entryOfChampion(champion);
  if (!entry) return null;
  const level = levelOf(champion, entry);
  const foodBonus = foodBonusOf(champion);
  const top = level >= entry.levels;
  const feeds = Math.max(0, Math.trunc(numberOf(champion.fd)));
  const maxHealth = championMaxHealth(entry, level, foodBonus);
  const health = predictedHealth(champion, entry, numberOf(save.savetime) || now, now);
  const hungryAt = numberOf(champion.ft);
  const starvesAt = hungryAt + STARVE_SECONDS;
  const hunger: Hunger = now > starvesAt ? "starving" : hungryAt < now ? "hungry" : "fed";
  const hungry = hunger !== "fed";

  const housed = (save.monsters?.housed ?? {}) as Record<string, unknown>;
  const recipe = Object.entries(feedRecipe(entry, level, foodBonus)).map(([monster, need]) => ({
    monster,
    name: monsterEntry(monster)?.name ?? monster,
    need,
    have: Math.max(0, Math.trunc(numberOf(housed[monster]))),
  }));

  const healtime = atChampionLevel(entry.healtime, level);
  const missing = Math.max(0, maxHealth - health);
  const rate = Math.trunc((maxHealth * HEAL_PERIOD) / healtime);
  const fullAt =
    missing <= 0 || rate <= 0
      ? null
      : (Math.floor(now / HEAL_PERIOD) + Math.ceil(missing / rate)) * HEAL_PERIOD;

  return {
    entry,
    champion,
    name: champion.nm?.trim() ? champion.nm.trim() : entry.name,
    level,
    top,
    feeds,
    feedCount: top ? 0 : atChampionLevel(entry.feedCount, level),
    foodBonus,
    health,
    maxHealth,
    fullAt,
    hunger,
    hungryAt,
    starvesAt,
    recipe,
    canFeedMonsters: recipe.every((row) => row.have >= row.need),
    feedShiny:
      top
        ? hungry || foodBonus < MAX_FOOD_BONUS
          ? feedShinyPrice(entry, level, foodBonus, hungry)
          : null
        : hungry
          ? feedShinyPrice(entry, level, foodBonus, true)
          : null,
    evolveShiny: top ? null : evolveShinyPrice(entry, level, feeds),
    healShiny: missing > 0 ? timeCost((missing / maxHealth) * healtime, false) : 0,
    damage:
      atChampionLevel(entry.damage, level) +
      (foodBonus > 0 ? atChampionLevel(entry.bonusDamage, foodBonus) : 0),
  };
};

/** The first finished-or-not building of `type`: its id and whether it is still being built. */
export const buildingOfType = (
  save: BaseLoadResponse,
  type: number,
): { id: number; building: boolean } | null => {
  for (const [key, building] of Object.entries(save.buildingdata ?? {})) {
    if (Number(building?.t) !== type) continue;
    return { id: Number(building.id ?? key), building: numberOf(building.cB) > 0 };
  }
  return null;
};

/** The cage panel's state at `now`. */
export const cageView = (save: BaseLoadResponse, now: number): CageView => {
  const cage = buildingOfType(save, CHAMPION_CAGE_TYPE);
  if (!cage) return { kind: "noCage" };
  if (cage.building) return { kind: "building" };
  const active = activeChampion(save);
  const view = active ? championView(save, active, now) : null;
  if (view) return { kind: "active", view };
  const frozen = new Set(frozenChampions(save).map((champion) => Math.trunc(numberOf(champion.t))));
  return {
    kind: "empty",
    choices: CHAMPION_CATALOGUE.filter((entry) => entry.raisable).map((entry) => ({
      entry,
      frozen: frozen.has(entry.t),
    })),
  };
};

/** The portrait at a level, from the game server's art (`/assets/monsters/G1_L3-150.png`). */
export const championPortraitUrl = (entry: ChampionEntry, level: number): string =>
  `/assets/monsters/${entry.id}_L${Math.min(Math.max(Math.trunc(level) || 1, 1), entry.levels)}-150.png`;
