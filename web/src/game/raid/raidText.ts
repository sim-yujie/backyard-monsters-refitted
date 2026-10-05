import type { RaidPreference, RaidResult } from "@/api/raid";
import type { Roster } from "@/game/combat/rules";
import { monsterName } from "@/game/combat/rules";

/**
 * The words and pictures of the raid screens (issue #226 WP4). The text is
 * Flash's (`server/public/gamestage/assets/english.json`, the `ai_*` keys),
 * and the pictures are Flash's own: each tribe's splash
 * (`TRIBES.as` `splash`, `popups/tribe_<name>.v2.png`) and the monsters'
 * original portraits.
 */

export interface RaidTribe {
  /** "Legionnaire". */
  readonly name: string;
  /** The tribe's splash art, as Flash's alert showed it. */
  readonly splash: string;
  /** What it says as it leaves (`ai_*_taunt`), shown on the frequency popup. */
  readonly taunt: string;
}

const TRIBES: Readonly<Record<string, RaidTribe>> = {
  Legionnaire: {
    name: "Legionnaire",
    splash: "/assets/popups/tribe_legionnaire.v2.png",
    taunt: "We're just getting warmed up!",
  },
  Kozu: {
    name: "Kozu",
    splash: "/assets/popups/tribe_kozu.v2.png",
    taunt: "The source of our power is a secret.",
  },
  Abunakki: {
    name: "Abunakki",
    splash: "/assets/popups/tribe_abunakki.v2.png",
    taunt: "We'll be back for your bones!",
  },
  Dreadnaut: {
    name: "Dreadnaut",
    splash: "/assets/popups/tribe_dreadnaut.v2.png",
    taunt: "Science will prevail!",
  },
};

/** A tribe by its name on the wire; an unknown one keeps its name, with Legionnaire's picture. */
export const raidTribe = (tribe: string): RaidTribe =>
  TRIBES[tribe] ?? { ...TRIBES["Legionnaire"]!, name: tribe || "Wild Monster", taunt: "We'll be back!" };

/** `ai_popupwarning_title`. */
export const ALERT_TITLE = "WILD MONSTER ALERT";
/** `ai_monsterbar_title`. */
export const SPOTTED_TITLE = "WILD MONSTERS SPOTTED!";
/** `ai_monsterbar_sendnow_btn`. */
export const READY_NOW = "I'm Ready Now";
/** `msg_dontpanic`. */
export const DONT_PANIC = "Don't Panic!";
/** `ai_settings_title`. */
export const FREQUENCY_TITLE = "ATTACK REPELLED";

/** `ai_tribe`: "Kozu Tribe". */
export const tribeTitle = (tribe: string): string => `${raidTribe(tribe).name} Tribe`;

/** One monster type on the alert. */
export interface AlertMonster {
  readonly id: string;
  readonly name: string;
  readonly count: number;
  /** The original portrait, and the original icon if it does not load. */
  readonly picture: string;
  readonly fallback: string;
}

/**
 * Up to three monster types for the alert (`AIATTACKPOPUP.as:62-105` showed
 * three): the most numerous first, ties in id order.
 */
export const alertMonsters = (monsters: Roster, most = 3): AlertMonster[] =>
  Object.entries(monsters)
    .filter(([, count]) => count > 0)
    .sort(([oneId, one], [otherId, other]) => other - one || oneId.localeCompare(otherId))
    .slice(0, most)
    .map(([id, count]) => ({
      id,
      name: monsterName(id),
      count,
      picture: `/assets/monsters/${id}-portrait.jpg`,
      fallback: `/assets/monsters/${id}-small.png`,
    }));

/** How many raiders in all. */
export const raiderCount = (monsters: Roster): number =>
  Object.values(monsters).reduce((sum, count) => sum + Math.max(0, count), 0);

/** The good defence's headline (`ai_gooddefense`). */
export const goodDefenceText = (tribe: string): string =>
  `You successfully defended your yard from an attack by the ${raidTribe(tribe).name} Tribe`;

/** The poor defence's three lines (`ai_poordefense_ta`, `_tb`, `_tc`). */
export const POOR_DEFENCE = {
  title: "Damn those Wild Monsters!",
  line: "You took some damage in that attack",
  advice: "Build some defensive towers and traps to better defend your yard from looters and attackers.",
} as const;

/** What is left of the yard, "87%", rounded down so 89.9% never reads as 90%. */
export const healthText = (health: number): string => `${Math.floor(Math.max(0, Math.min(1, health)) * 100)}%`;

/** Whether the raiders took anything. */
export const anyStolen = (result: Pick<RaidResult, "stolen">): boolean =>
  Object.values(result.stolen).some((amount) => amount > 0);

/** The frequency popup's answers: Flash's words, and what each does in plain ones. */
export const FREQUENCY_CHOICES: readonly {
  readonly preference: RaidPreference;
  readonly label: string;
  readonly hint: string;
}[] = [
  { preference: "more", label: "“Bring more monsters next time.”", hint: "Bigger raids, every 2 days" },
  { preference: "same", label: "“I'll be waiting.”", hint: "Raids as now, every 3 days" },
  { preference: "less", label: "“Can't we all just get along?”", hint: "Smaller raids, every 4 days" },
];
