import type { ChampionData } from "../../../schemas/ChampionSchema.js";
import type { JsonObject } from "../../../types/JsonObject.js";
import { parseFlingLog } from "../attackCheckpoint.js";
import type { ChampionHealth } from "../attackSession.js";
import { entryOf, maxHealthOf, statusOf } from "../../yard/champion.js";
import { siegeAfter, type AbandonedOutcome } from "./abandonedAttack.js";

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
 * - **Champion**: a champion that fought comes home hurt, dead, or healed by
 *   Vorgs. Where the server replayed the battle, its health is the replay's
 *   ({@link championsAfterBattle}); with no replay (Map Room 3) it is taken
 *   from the client, and only downwards, and only for a champion the log
 *   flung. Everything else about it (type, level, feeding, status) stays as
 *   stored.
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
 * champion the save names that the attacker does not own is ignored. Only
 * health ever moves: no list adds a champion or changes its type, level,
 * power level, food bonus or status, and a champion not out of the cage
 * (an egg, a frozen or juiced one) cannot have fought, so keeps its own.
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
    if (!flung.has(champion.t) || Number(champion.status ?? 0) !== 0) return champion;
    const match = reported.find((entry) => entry?.t === champion.t);
    const hp = Number(match?.hp);
    if (!match || !Number.isFinite(hp)) return champion;
    const kept = Math.max(0, Math.min(Number(champion.hp), hp));
    return kept === champion.hp ? champion : { ...champion, hp: kept };
  });
};

/**
 * The attacker's champions once the server's own battle is over: a champion
 * that battle flung comes home at the health the battle left it at, healed by
 * Vorgs or Zafreeti (the game's only healers) or hurt, as Flash kept it
 * (`ChampionBase.as:1200/1310`, `BASE.as:3270`, `ATTACK.as:532`), and as the
 * finaliser already lands it from a checkpoint.
 * The client's figure is never read. Never above the champion's full health
 * for its stored level and food bonus, never below 0.
 *
 * Only a champion the attack froze a health for is taken from the battle: a
 * session minted before the freeze fought it at full health, so its figure
 * says nothing about the champion's real health, and the save's only-downwards
 * rule ({@link championsAfterAttack}) is left to stand for it. A champion not
 * out of the cage, or one the battle never flung, keeps what it has.
 *
 * @param stored - The attacker's `champion`, after {@link championsAfterAttack}.
 * @param battle - The server's replay of the attack.
 * @param frozen - The session's `championHealth`, if any.
 */
export const championsAfterBattle = (
  stored: readonly ChampionData[] | null | undefined,
  battle: Pick<AbandonedOutcome, "attackerchampion" | "championsFlung">,
  frozen: ChampionHealth | null | undefined
): ChampionData[] => {
  const flung = new Set(battle.championsFlung);
  return (stored ?? []).map((champion) => {
    if (!flung.has(champion.t) || statusOf(champion) !== 0) return champion;
    if (frozen?.[String(champion.t)] === undefined) return champion;
    const entry = entryOf(champion);
    const hp = Number(battle.attackerchampion?.find((one) => one.t === champion.t)?.hp);
    if (!entry || !Number.isFinite(hp)) return champion;
    const kept = Math.floor(Math.max(0, Math.min(maxHealthOf(champion, entry), hp)));
    return kept === champion.hp ? champion : { ...champion, hp: kept };
  });
};
