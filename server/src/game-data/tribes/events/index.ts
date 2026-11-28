import type { SaveData } from "../../../types/EntityData.js";
import { brukkargBases, brukkargCopyBase } from "./brukkarg.js";
import { creatureCarnageBases } from "./creatureCarnage.js";

/**
 * The Brukkarg tribe's event yards (beta 10, bruk-port; the layouts are
 * upstream Refitted's, see the data files):
 *
 * - Creature Carnage (`carnage`): ten small Town Hall 3 yards, `"906"`-`"915"`,
 *   attacked in order (Flash's `Battletoads.as`, event id 1).
 * - Brukkarg War (`brukwar`): four yards, `"901"`-`"904"`, then `"905"`, a
 *   copy of the player's own yard (`BrukkargWarEvent.as`, event id 5).
 *
 * The ids sit in the range the baseid sequence leaves to the game
 * (`20250101_CreateUserBaseIdSeq.ts`: player yards start at 1000), above the
 * Map Room 1 tribes (1-35) and the Inferno's (201-234); Map Room 2 camps are
 * 14 digits. Every player fights their own copy, so none has a row
 * (`services/events/yards/`).
 */

export type YardEventKey = "carnage" | "brukwar";

/** Each event's yards, in attack order; the copy yard is not among them. */
export const EVENT_YARDS: Readonly<Record<YardEventKey, readonly SaveData[]>> = {
  carnage: creatureCarnageBases,
  brukwar: brukkargBases,
};

/** The yard of each event that is a copy of the player's own yard, attacked last. */
export const EVENT_COPY_YARDS: Readonly<Partial<Record<YardEventKey, SaveData>>> = {
  brukwar: brukkargCopyBase,
};

/** Every event yard by base id, the copy yard's empty template included. */
export const EVENT_YARDS_MAP: ReadonlyMap<string, SaveData> = new Map(
  (Object.keys(EVENT_YARDS) as YardEventKey[]).flatMap((key) => {
    const copy = EVENT_COPY_YARDS[key];
    return [...EVENT_YARDS[key], ...(copy ? [copy] : [])].map((yard) => [String(yard.baseid), yard] as const);
  })
);

/** The event each yard belongs to. */
export const EVENT_OF_YARD: ReadonlyMap<string, YardEventKey> = new Map(
  (Object.keys(EVENT_YARDS) as YardEventKey[]).flatMap((key) => {
    const copy = EVENT_COPY_YARDS[key];
    return [...EVENT_YARDS[key], ...(copy ? [copy] : [])].map((yard) => [String(yard.baseid), key] as const);
  })
);

/** Whether `baseid` names an event yard. */
export const isEventYardId = (baseid: unknown): boolean => EVENT_YARDS_MAP.has(String(baseid ?? ""));

/** Whether `baseid` names the copy-of-your-own-yard yard. */
export const isCopyYardId = (baseid: unknown): boolean =>
  Object.values(EVENT_COPY_YARDS).some((yard) => yard && String(yard.baseid) === String(baseid ?? ""));

/** The event's attack order: its yards' ids, then its copy yard's. */
export const eventYardOrder = (key: YardEventKey): string[] => {
  const copy = EVENT_COPY_YARDS[key];
  return [...EVENT_YARDS[key].map((yard) => String(yard.baseid)), ...(copy ? [String(copy.baseid)] : [])];
};
