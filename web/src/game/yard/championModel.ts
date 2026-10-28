import type { BaseLoadResponse, ChampionSaveEntry } from "@/api/types";
import { monsterEntry } from "@/game/monsters/monsterCatalogue";
import { championPortrait, type Portrait } from "@/game/portraits";
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
 *
 * Raising lays an egg (status 3, owner 2026-10-20): `ft` is its hatch time, a
 * day after the raise, and nothing hurries it. The server hatches it in its
 * catch-up; until the answer that does, the cage shows the egg (at 0 left,
 * "hatching", and the panel asks the server for its state).
 */

/** Champion Cage type id (`client/scripts/CHAMPIONCAGE.as:22`). */
export const CHAMPION_CAGE_TYPE = 114;

/** Champion Chamber type id (`client/scripts/YARD_PROPS.as:6521`). */
export const CHAMPION_CHAMBER_TYPE = 119;

/** `ChampionBase` statuses (`champions/ChampionBase.as:26-36`). */
export const ChampionStatus = { ACTIVE: 0, FROZEN: 1, JUICED: 2, EGG: 3 } as const;

/** How long an egg takes to hatch: one day, every time (`server/src/services/yard/champion.ts`). */
export const EGG_HATCH_SECONDS = 24 * 60 * 60;

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

/** Korath's champion type (`G4`): raised once the player owns an Inferno yard (Inferno WP 5.1, owner I10). */
export const KORATH_TYPE = 4;

/**
 * Whether Korath is unlocked: the main yard's load says so (`infernostate`,
 * sent only with the new Inferno on, `korathUnlocked` once the player owns an
 * Inferno yard). The server's `services/inferno/korath.ts` decides.
 */
export const korathUnlocked = (save: Pick<BaseLoadResponse, "infernostate">): boolean =>
  save.infernostate?.korathUnlocked === true;

/**
 * Whether the cage offers a champion to raise: Gorgo, Drull and Fomor
 * (`raisable`), and Korath once unlocked.
 */
export const canRaise = (entry: ChampionEntry, save: Pick<BaseLoadResponse, "infernostate">): boolean =>
  entry.raisable || (entry.t === KORATH_TYPE && korathUnlocked(save));

/** The basic champion in the cage, if any (`CHAMPIONCAGE.hasBasicChampion`, `:309-319`). */
export const activeChampion = (save: BaseLoadResponse): ChampionSaveEntry | null =>
  championsOf(save).find(
    (champion) =>
      statusOf(champion) === ChampionStatus.ACTIVE && entryOfChampion(champion)?.kind === "basic",
  ) ?? null;

/** A special champion (Krallen) that is out of the cage's one-champion rule: awake or frozen, or null. */
export const specialChampion = (save: BaseLoadResponse): ChampionSaveEntry | null =>
  championsOf(save).find(
    (champion) =>
      entryOfChampion(champion)?.kind === "special" &&
      [ChampionStatus.ACTIVE, ChampionStatus.FROZEN].includes(statusOf(champion) as 0 | 1),
  ) ?? null;

/** The basic champion's egg in the cage, if any. */
export const cageEgg = (save: BaseLoadResponse): ChampionSaveEntry | null =>
  championsOf(save).find(
    (champion) => statusOf(champion) === ChampionStatus.EGG && entryOfChampion(champion)?.kind === "basic",
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

/** The numbers a champion's card shows; `buff` is a percentage. */
export interface ChampionStats {
  readonly damage: number;
  readonly health: number;
  readonly speed: number;
  readonly range: number;
  readonly buff: number;
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
  /** Every stat at the current level and food-bonus rank. */
  readonly stats: ChampionStats;
  /** The stats once it evolves; null at the top level. */
  readonly nextStats: ChampionStats | null;
  /** What the next food-bonus rank adds on top; null below the top level or at rank 3. */
  readonly nextBonus: ChampionStats | null;
}

/** The cage's state for the panel. */
export type CageView =
  | { readonly kind: "noCage" }
  | { readonly kind: "building" }
  /** No champion in the cage: the raise cards, and which types are frozen. */
  | { readonly kind: "empty"; readonly choices: readonly RaiseChoice[] }
  /** An egg waiting to hatch: no champion yet. */
  | { readonly kind: "egg"; readonly egg: EggView }
  | { readonly kind: "active"; readonly view: ChampionView };

/** The egg in the cage. */
export interface EggView {
  readonly entry: ChampionEntry;
  /** Unix seconds it hatches (`ft`). */
  readonly hatchAt: number;
  /** Seconds left, 0 once its time has come (the server's next answer hatches it). */
  readonly left: number;
}

/** The egg's view at `now`, or null for an entry that is not a known champion. */
export const eggView = (egg: ChampionSaveEntry, now: number): EggView | null => {
  const entry = entryOfChampion(egg);
  if (!entry) return null;
  const hatchAt = numberOf(egg.ft);
  return { entry, hatchAt, left: Math.max(0, hatchAt - now) };
};

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

const statsAt = (entry: ChampionEntry, level: number, foodBonus: number): ChampionStats => {
  const bonus = (ladder: readonly number[]): number => (foodBonus > 0 ? atChampionLevel(ladder, foodBonus) : 0);
  return {
    damage: atChampionLevel(entry.damage, level) + bonus(entry.bonusDamage),
    health: atChampionLevel(entry.health, level) + bonus(entry.bonusHealth),
    speed: atChampionLevel(entry.speed, level) + bonus(entry.bonusSpeed),
    range: atChampionLevel(entry.range, level) + bonus(entry.bonusRange),
    buff: Math.round((atChampionLevel(entry.buffs, level) + bonus(entry.bonusBuffs)) * 1000) / 10,
  };
};

/** What food-bonus rank `rank` adds over rank `rank - 1`. */
const rankGain = (entry: ChampionEntry, level: number, rank: number): ChampionStats => {
  const after = statsAt(entry, level, rank);
  const before = statsAt(entry, level, rank - 1);
  return {
    damage: after.damage - before.damage,
    health: after.health - before.health,
    speed: Math.round((after.speed - before.speed) * 100) / 100,
    range: after.range - before.range,
    buff: Math.round((after.buff - before.buff) * 10) / 10,
  };
};

/**
 * The yard with every champion in the cage at the health it has healed to by
 * `now` ({@link predictedHealth}), as the cage panel shows it: the save holds
 * the health at the last catch-up. What a practice attack on the own yard
 * defends with, so the champion comes out with the health the panel shows.
 * The same save when nothing healed.
 */
export const withChampionsHealed = (save: BaseLoadResponse, now: number): BaseLoadResponse => {
  if (!Array.isArray(save.champion)) return save;
  const savetime = numberOf(save.savetime) || now;
  let changed = false;
  const champion = save.champion.map((entry) => {
    const catalogue = entryOfChampion(entry);
    if (!catalogue || statusOf(entry) !== 0) return entry;
    const hp = predictedHealth(entry, catalogue, savetime, now);
    if (hp === numberOf(entry.hp)) return entry;
    changed = true;
    return { ...entry, hp };
  });
  return changed ? { ...save, champion } : save;
};

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
    stats: statsAt(entry, level, foodBonus),
    nextStats: top ? null : statsAt(entry, level + 1, 0),
    nextBonus: top && foodBonus < MAX_FOOD_BONUS ? rankGain(entry, level, foodBonus + 1) : null,
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
  const egg = cageEgg(save);
  const waiting = egg ? eggView(egg, now) : null;
  if (waiting) return { kind: "egg", egg: waiting };
  const frozen = new Set(frozenChampions(save).map((champion) => Math.trunc(numberOf(champion.t))));
  return {
    kind: "empty",
    choices: CHAMPION_CATALOGUE.filter((entry) => canRaise(entry, save)).map((entry) => ({
      entry,
      frozen: frozen.has(entry.t),
    })),
  };
};

/** The Champion Chamber's state, and what it and the cage allow. */
export type ChamberView =
  | { readonly kind: "noChamber" }
  | { readonly kind: "building" }
  | {
      readonly kind: "ready";
      /** The chamber is damaged: nothing thaws until it is repaired. */
      readonly damaged: boolean;
      /** The cage a thawed champion goes to. */
      readonly cage: "none" | "building" | "ready";
      /** The champion in the cage, which could be frozen. */
      readonly active: ChampionView | null;
      /** The egg in the cage: nothing thaws into the cage until it is cancelled or hatches. */
      readonly egg: EggView | null;
      readonly frozen: readonly FrozenView[];
    };

/** A champion asleep in the chamber. */
export interface FrozenView {
  readonly entry: ChampionEntry;
  readonly champion: ChampionSaveEntry;
  readonly name: string;
  readonly level: number;
  readonly health: number;
  readonly maxHealth: number;
  /** Seconds of feeding it has left once thawed (its relative `ft`); 0 or less is hungry at once. */
  readonly fedFor: number;
}

/** Whether a building's save entry counts as damaged (the server's `isDamaged`). */
const damagedEntry = (save: BaseLoadResponse, id: number): boolean => {
  const building = save.buildingdata?.[String(id)];
  if (!building) return false;
  return (
    building.hp != null ||
    Number(building.rE) === 1 ||
    (save.buildinghealthdata != null && String(id) in save.buildinghealthdata)
  );
};

/** The chamber panel's state at `now`. */
export const chamberView = (save: BaseLoadResponse, now: number): ChamberView => {
  const chamber = buildingOfType(save, CHAMPION_CHAMBER_TYPE);
  if (!chamber) return { kind: "noChamber" };
  if (chamber.building) return { kind: "building" };
  const cage = buildingOfType(save, CHAMPION_CAGE_TYPE);
  const active = activeChampion(save);
  const egg = cageEgg(save);
  return {
    kind: "ready",
    damaged: damagedEntry(save, chamber.id),
    cage: !cage ? "none" : cage.building ? "building" : "ready",
    active: active ? championView(save, active, now) : null,
    egg: egg ? eggView(egg, now) : null,
    frozen: frozenChampions(save).map((champion) => {
      const entry = entryOfChampion(champion)!;
      const level = levelOf(champion, entry);
      const name = champion.nm?.trim() ? champion.nm.trim() : entry.name;
      return {
        entry,
        champion,
        name,
        level,
        health: numberOf(champion.hp),
        maxHealth: championMaxHealth(entry, level, foodBonusOf(champion)),
        fedFor: numberOf(champion.ft),
      };
    }),
  };
};

/**
 * Why the champion in the cage cannot be frozen now, or null
 * (`CHAMPIONCHAMBER.FreezeGuardian`, `CHAMPIONCHAMBER.as:103-141`).
 */
export const freezeGate = (save: BaseLoadResponse, view: ChampionView): string | null => {
  const chamber = buildingOfType(save, CHAMPION_CHAMBER_TYPE);
  if (!chamber) return "Build a Champion Chamber to keep a champion on ice while you raise another.";
  if (chamber.building) return "Your Champion Chamber is still being built.";
  if (view.health < view.maxHealth) return `Heal ${view.name} to full health before you freeze it.`;
  if (view.hunger !== "fed") return `Feed ${view.name} before you freeze it.`;
  return null;
};

/** Why a frozen champion cannot be thawed now, or null (`ThawGuardian`, `:143-221`). */
export const thawGate = (view: ChamberView, special = false): string | null => {
  if (view.kind !== "ready") return view.kind === "building" ? "Your Champion Chamber is still being built." : "Build a Champion Chamber first.";
  if (view.damaged) return "Your Champion Chamber is damaged. Repair it before you thaw a champion.";
  if (view.cage === "none") return "Build a Champion Cage first.";
  if (view.cage === "building") return "Your Champion Cage is still being built.";
  if (view.active && !special) return `Freeze ${view.active.name} first: the cage holds one champion at a time.`;
  if (view.egg && !special) return `Your cage holds a ${view.egg.entry.name} egg. Cancel it before you thaw a champion.`;
  return null;
};

/** The portrait at a level, clamped to the champion's levels: painted, else the original (`game/portraits.ts`). */
export const championPicture = (entry: ChampionEntry, level: number): Portrait =>
  championPortrait(entry.id, Math.min(Math.max(Math.trunc(level) || 1, 1), entry.levels), "card");
