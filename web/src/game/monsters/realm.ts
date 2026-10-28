import type { YardKind } from "@/game/yard/buildingCosts";
import {
  INFERNO_LISTED_MONSTERS,
  LISTED_MONSTERS,
  isInfernoListed,
  isInfernoMonster,
  isListed,
  maxTrainingLevel,
  type MonsterEntry,
} from "./monsterCatalogue";

/**
 * Which roster a yard's monster screens serve (Inferno WP 2.4,
 * `docs/design/inferno.md` §2.6): the surface monsters (`C…`) on a main yard
 * or outpost, the Inferno ones (`IC…`) on the Inferno yard, as Flash's
 * `BASE.isInfernoMainYardOrOutpost` picks them and as the server's
 * `monsterRealmOf` (`server/src/services/yard/locker.ts`) does.
 *
 * The Inferno yard's buildings carry Flash's Inferno names: the Strongbox
 * unlocks, the Incubator hatches, the Compound houses and the Infernal
 * Academy trains; Sulfur pays for unlocks and training, Magma for hatching
 * (`english.json` `#bi_monsterlocker#`, `#bi_hatchery#`, `#bi_housing#`,
 * `#bi_academy#`). {@link monsterWords} has them for the screens.
 */
export type MonsterRealm = "surface" | "inferno";

/** The realm of a yard of `kind`. */
export const monsterRealmOf = (kind: YardKind | null | undefined): MonsterRealm =>
  kind === "inferno" ? "inferno" : "surface";

/** True when `id` is of `realm`'s roster: `C<n>` on the surface, `IC<n>` in the Inferno. */
export const inRealm = (id: string, realm: MonsterRealm): boolean =>
  realm === "inferno" ? isInfernoMonster(id) : /^C\d+$/.test(id);

/** Every monster `realm`'s yards unlock, hatch and house, in list order. */
export const listedMonstersOf = (realm: MonsterRealm): readonly MonsterEntry[] =>
  realm === "inferno" ? INFERNO_LISTED_MONSTERS : LISTED_MONSTERS;

/** True for a monster `realm`'s yards can unlock, hatch and house. */
export const isListedIn = (id: string, realm: MonsterRealm): boolean =>
  realm === "inferno" ? isInfernoListed(id) : isListed(id);

/**
 * The highest level an Inferno monster reaches in the Infernal Academy: five.
 * Its four levels let level 4 train on to 5, and Flash calls a monster there
 * fully trained (`ACADEMY.as:86-90`), though the table holds a sixth level
 * (`INFERNO_TOP_TRAINING_LEVEL`, `server/src/services/yard/academy.ts`).
 */
export const INFERNO_TOP_TRAINING_LEVEL = 5;

/** The top of `id`'s training ladder on a yard of `realm`. */
export const topTrainingLevel = (id: string, realm: MonsterRealm): number =>
  realm === "inferno"
    ? Math.min(maxTrainingLevel(id), INFERNO_TOP_TRAINING_LEVEL)
    : maxTrainingLevel(id);

/** The words the monster screens use for a realm's buildings and resources. */
export interface MonsterWords {
  /** The building that unlocks: "Monster Locker", "Strongbox". */
  readonly locker: string;
  /** The building that hatches: "Hatchery", "Incubator". */
  readonly hatchery: string;
  readonly hatcheries: string;
  /** Where monsters live: "Housing", "Compound". */
  readonly housing: string;
  /** The timed power-up that adds 25% room. */
  readonly expansion: string;
  /** The building that trains, in a sentence: "Monster Academy", "Infernal Academy". */
  readonly academy: string;
  /** The hatching resource, as a sentence spells it: "goo", "Magma". */
  readonly goo: string;
  /** The unlock and training resource: "putty", "Sulfur". */
  readonly putty: string;
}

const SURFACE_WORDS: MonsterWords = {
  locker: "Monster Locker",
  hatchery: "Hatchery",
  hatcheries: "Hatcheries",
  housing: "Housing",
  expansion: "Housing Expansion",
  academy: "Monster Academy",
  goo: "goo",
  putty: "putty",
};

/** Flash's Inferno names (`english.json`; `store_exh_title` for the expansion). */
const INFERNO_WORDS: MonsterWords = {
  locker: "Strongbox",
  hatchery: "Incubator",
  hatcheries: "Incubators",
  housing: "Compound",
  expansion: "Compound Expansion",
  academy: "Infernal Academy",
  goo: "Magma",
  putty: "Sulfur",
};

/** The words for `realm`'s monster screens. */
export const monsterWords = (realm: MonsterRealm): MonsterWords =>
  realm === "inferno" ? INFERNO_WORDS : SURFACE_WORDS;
