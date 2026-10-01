import { TICKS_PER_SECOND } from "./stats.js";
import { RESOURCE_KEYS, type FlingEvent, type ResourceAmounts } from "./types.js";

/**
 * The attack report: the plain text the defender's row keeps of an attack,
 * one line per fling, bomb, siege and retreat in the log, then the result
 * (`docs/design/attack-flow.md` §7, Q5).
 *
 * Shared so that the server writes it from its own replay (issue #23, C6) in
 * exactly the words the web client shows: an honest client's report and the
 * server's are the same text.
 */

/** Display names by roster id (`server/src/game-data/stats/monsterKeys.ts`). */
export const MONSTER_NAMES: Readonly<Record<string, string>> = {
  C1: "Pokey",
  C2: "Octo-ooze",
  C3: "Bolt",
  C4: "Fink",
  C5: "Eye-ra",
  C6: "Ichi",
  C7: "Bandito",
  C8: "Fang",
  C9: "Brain",
  C10: "Crabatron",
  C11: "Project X",
  C12: "D.A.V.E.",
  C13: "Wormzer",
  C14: "Teratorn",
  C15: "Zafreeti",
  C16: "Vorg",
  C17: "Slimeattikus",
  C19: "Rezghul",
  C200: "Looter",
  IC1: "Spurtz",
  IC2: "Zagnoid",
  IC3: "Malphus",
  IC4: "Valgos",
  IC5: "Balthazar",
  IC6: "Grokus",
  IC7: "Sabnox",
  IC8: "King Wormzer",
};

/** A monster's display name, or its id when the table has none. */
export const monsterName = (id: string): string => MONSTER_NAMES[id] ?? id;

/** `m:ss` of a tick, the clock's own spelling. */
export const clockOf = (tick: number): string => {
  const whole = Math.max(0, Math.floor(tick / TICKS_PER_SECOND));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest < 10 ? "0" : ""}${rest}`;
};

const BOMB_RESOURCE: Readonly<Record<string, string>> = {
  tw: "twig",
  pb: "pebble",
  pu: "putty",
};

/** `tw2` reads as "twig bomb (tier 3)"; an id the table lacks is shown as is. */
const bombName = (id: string): string => {
  const resource = BOMB_RESOURCE[id.slice(0, 2)];
  const tier = Number(id.slice(2));
  if (!resource || !Number.isInteger(tier)) return `${id} bomb`;
  return `${resource} bomb (tier ${tier + 1})`;
};

const at = (x: number, y: number): string => `at (${Math.round(x)}, ${Math.round(y)})`;

/** One line for one event (§7, Q5). */
export const reportLine = (
  event: FlingEvent,
  nameOf: (id: string) => string = monsterName,
): string => {
  const when = clockOf(event.t);
  switch (event.kind) {
    case "fling": {
      const parts = Object.entries(event.monsters)
        .filter(([, count]) => count > 0)
        .map(([id, count]) => `${count} ${nameOf(id)}`);
      if (event.champion) parts.push(`the champion (G${event.champion.t})`);
      return `${when} Flung ${parts.join(", ")} ${at(event.x, event.y)}`;
    }
    case "bomb":
      return `${when} Fired a ${bombName(event.id)} ${at(event.x, event.y)}`;
    case "siege":
      return `${when} Deployed ${event.weapon} ${at(event.x, event.y)}`;
    case "retreat":
      return `${when} Retreated`;
    case "championRetreat":
      return `${when} Called back the champion (G${event.c})`;
  }
};

/** How the battle ended, as the report's last lines say it. */
export interface ReportOutcome {
  /** The tick the battle stopped at. */
  readonly tick: number;
  /** The attacker left the attack screen, so it stopped there (issue #138). */
  readonly left: boolean;
  /** `damagePercent()` of the yard, 0 to 100. */
  readonly damagePercent: number;
  readonly buildingsDestroyed: number;
  /** The attacker's gain. */
  readonly loot: ResourceAmounts;
  /** The defender's caged champion died in the battle (issue #195). */
  readonly defenderChampionFell?: boolean;
}

/**
 * The whole report: the events' lines, "Left the attack" when the attacker
 * left, a line when the defender's champion fell (issue #195), then the result.
 */
export const attackReport = (
  events: readonly FlingEvent[],
  outcome: ReportOutcome,
  nameOf: (id: string) => string = monsterName,
): string => {
  const lines = events.map((event) => reportLine(event, nameOf));
  if (outcome.left) lines.push(`${clockOf(outcome.tick)} Left the attack`);
  if (outcome.defenderChampionFell) lines.push("The defending champion fell.");
  const loot = RESOURCE_KEYS.map((key) => Math.floor(outcome.loot[key]));
  lines.push(
    `Result: ${Math.floor(outcome.damagePercent)}% damage, ` +
      `${outcome.buildingsDestroyed} buildings destroyed, ` +
      `looted ${loot[0]} twigs, ${loot[1]} pebbles, ${loot[2]} putty, ${loot[3]} goo.`,
  );
  return lines.join("\n");
};
