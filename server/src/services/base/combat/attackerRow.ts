import type { ChampionData } from "../../../schemas/ChampionSchema.js";
import type { JsonObject } from "../../../types/JsonObject.js";
import { parseFlingLog } from "../attackCheckpoint.js";
import { siegeAfter } from "./abandonedAttack.js";

/**
 * What an attack does to the attacker's own row, worked out by the server
 * (issue #23, C1).
 *
 * The attack save used to write the attacker's `champion` and `siege` exactly
 * as sent, so one hand-made save could leave a champion at any level on full
 * health, or a stock of every siege weapon. An attack can do two things to
 * them, and only these:
 *
 * - **Siege**: each weapon used spends one. The save's fling log records
 *   every use (`siege` events), so the stock is the stored one less those, as
 *   the server's finaliser already takes it (`siegeAfter`,
 *   `finaliseAttack.ts`). The client's copy is not read.
 * - **Champion**: a champion that fought comes home hurt, or dead. Its health
 *   is the one thing taken from the client, and only downwards, and only for
 *   a champion the log flung. Everything else about it (type, level, feeding,
 *   status) stays as stored.
 *
 * Only the save that ends the attack applies either, like the loot, so an
 * attack spends its siege once however many saves it sends.
 *
 * Pure: the caller reads the rows and writes the result.
 */

/** The champion types the log flung. */
const flungChampions = (flinglog: unknown): Set<number> => {
  const flung = new Set<number>();
  for (const event of parseFlingLog(flinglog)?.events ?? []) {
    if (event.kind === "fling" && event.champion) flung.add(event.champion.t);
  }
  return flung;
};

/**
 * The attacker's siege stock once the attack's log has spent its weapons: the
 * stored stock less one per `siege` event. Without a usable log nothing was
 * spent that the server can see, and the stock is left as it is.
 *
 * @param stored - The attacker's `siege` as stored.
 * @param flinglog - The save's `flinglog`, as parsed from the body.
 */
export const siegeAfterAttack = (
  stored: JsonObject | null | undefined,
  flinglog: unknown
): JsonObject | null | undefined => {
  const log = parseFlingLog(flinglog);
  if (!log || !stored) return stored;
  return siegeAfter(stored, log.events) ?? stored;
};

/**
 * The attacker's champions once the attack is over: as stored, except that a
 * champion the log flung takes the health the save reports for it, when that
 * is lower (a death is 0). A champion the save leaves out, or reports at more
 * health than it had, or one the log never flung, keeps its stored health; a
 * champion the save names that the attacker does not own is ignored.
 *
 * @param stored - The attacker's `champion` as stored.
 * @param reported - The save's `attackerchampion`.
 * @param flinglog - The save's `flinglog`, as parsed from the body.
 */
export const championsAfterAttack = (
  stored: readonly ChampionData[] | null | undefined,
  reported: readonly (ChampionData | null)[] | null | undefined,
  flinglog: unknown
): ChampionData[] => {
  const champions = [...(stored ?? [])];
  if (!reported || champions.length === 0) return champions;
  const flung = flungChampions(flinglog);

  return champions.map((champion) => {
    if (!flung.has(champion.t)) return champion;
    const match = reported.find((entry) => entry?.t === champion.t);
    const hp = Number(match?.hp);
    if (!match || !Number.isFinite(hp)) return champion;
    const kept = Math.max(0, Math.min(Number(champion.hp), hp));
    return kept === champion.hp ? champion : { ...champion, hp: kept };
  });
};
