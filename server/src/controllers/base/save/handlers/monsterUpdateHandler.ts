import { Save } from "../../../../database/models/save.model.js";
import type { FlingEvent } from "../../../../game-rules/combat/index.js";
import type { AttackSession } from "../../../../services/base/attackSession.js";
import { flungOf } from "../../../../services/base/combat/abandonedAttack.js";
import { settleAttackArmies } from "../../../../services/yard/armies.js";
import type { Counts } from "../../../../services/yard/attackRoster.js";
import { logger } from "../../../../utils/logger.js";

export interface MonsterUpdate {
  m: {
    housed: {};
    hid: [];
    space: number;
    hcc: [];
    overdrivetime: number;
    h: [];
    hstage: [];
    hcount: number;
    saved: number;
  };
  baseid: number;
}


/** What the attack save knows about the attack beyond the payload. */
export interface MonsterUpdateContext {
  /** The attack session the save was bound to. */
  session: AttackSession | null;
  /** Whether this save ends the attack (`over`), holding the final lock. */
  finalises: boolean;
  /** The save's fling log as parsed (`BaseSaveSchema`), if it sent one. */
  flinglog: unknown;
  /** Server seconds. */
  now: number;
  /** Whether the attacker's own save is on Map Room 3 (`userSave.mapversion`). */
  mapRoom3: boolean;
}

/** Which `monsterupdate` an attack save may settle its army with. */
export type MonsterUpdateMode = "roster" | "mapRoom3" | "none";

/**
 * The settlement path this attack expects (issue #164), decided by the
 * server, never by the payload's shape:
 *
 * - `roster`: a Map Room 1 or 2 attack, whose session recorded what the
 *   attacker's yards housed at entry (#103, #132). Only the array of cell
 *   updates, settled through the fling log.
 * - `mapRoom3`: no recorded roster and the attacker's own save is on Map
 *   Room 3. Only Flash's per-creep object, written as sent as it always was.
 * - `none`: anything else — a session without a roster for a player not on
 *   Map Room 3 is an attack load that named the wrong map room (the load
 *   takes `mapversion` from the client). Nothing is written.
 */
export const monsterUpdateMode = (attack: Pick<MonsterUpdateContext, "session" | "mapRoom3">): MonsterUpdateMode => {
  if (attack.session?.entryHoused) return "roster";
  return attack.mapRoom3 ? "mapRoom3" : "none";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One Map Room 2 cell update: an object naming the cell by a whole base id. */
const isCellUpdate = (entry: unknown): entry is MonsterUpdate => {
  if (!isRecord(entry)) return false;
  const { baseid } = entry;
  if (typeof baseid === "number") return Number.isSafeInteger(baseid) && baseid > 0;
  return typeof baseid === "string" && /^\d{1,20}$/.test(baseid);
};

/**
 * Flash's Map Room 3 shape: creature id to a list of per-creep state objects
 * (and the optional `Q` heal queue, also a list). Anything else is not it.
 */
export const isMapRoom3Update = (value: unknown): value is Record<string, unknown[]> =>
  isRecord(value) &&
  Object.values(value).every((creeps) => Array.isArray(creeps) && creeps.every(isRecord));

/**
 * Monsters flung per a fling log, summed per id (`flungOf`), or null when the
 * save has no usable log. A malformed event counts nothing.
 */
const loggedFlung = (flinglog: unknown): Counts | null => {
  const events = (flinglog as { events?: unknown } | null | undefined)?.events;
  if (!Array.isArray(events)) return null;
  const flings = events.filter(
    (event): event is FlingEvent =>
      typeof event === "object" &&
      event !== null &&
      event.kind === "fling" &&
      typeof event.monsters === "object" &&
      event.monsters !== null
  );
  const flung = flungOf(flings);
  for (const [id, count] of Object.entries(flung)) {
    if (!Number.isFinite(count)) delete flung[id];
    else flung[id] = Math.floor(count);
  }
  return flung;
};

/**
 * Handles the `monsterupdate` save key after an attack, on the path the attack
 * expects ({@link monsterUpdateMode}); a payload of the other shape, or a
 * malformed one, is ignored and logged. It used to branch on the payload's
 * shape, so any attack save could write an object straight over the
 * attacker's `monsters` (issue #164).
 *
 * MR3: The client sends a plain object keyed by creatureID, where each value is an array
 * of per-creep state objects `{ health, ownerID, q }`, with an optional `Q` heal queue.
 * Written as sent (unchanged), on a Map Room 3 attack only.
 *
 * MR2 and MR1: The client sends an array of cell updates `[{ baseid, m: housingState }, ...]`.
 * These are no longer written (`docs/design/yard-buildings.md` §4.6): the save
 * that ends the attack takes the flung monsters out of the attacker's yards as
 * caught up now (`services/yard/armies.ts`, `services/yard/attackRoster.ts`),
 * which keeps what hatched during the attack and cannot add a monster. Only
 * that save does it, under the final lock, so the monsters leave exactly once
 * whether the attack ends by this save or by the server finishing it
 * (`finaliseAttack.ts`); an earlier save of the same attack changes nothing,
 * since every save repeats the whole log.
 *
 * @param {unknown} monsters - Parsed monsterupdate payload
 * @param {Save} userSave - The attacking user's main save
 * @param {MonsterUpdateContext} attack - The session, whether the save finalises, the log, the map room
 */
export const monsterUpdateHandler = async (
  monsters: unknown,
  userSave: Save,
  attack: MonsterUpdateContext
) => {
  const mode = monsterUpdateMode(attack);

  if (mode === "mapRoom3" && isMapRoom3Update(monsters)) {
    userSave.monsters = monsters as Save["monsters"];
    return;
  }

  if (mode !== "roster" || !Array.isArray(monsters)) {
    logger.warn("Attack save's monsterupdate ignored for userid {userid}: {mode} attack", {
      event: "attack-monsterupdate-ignored",
      userid: userSave.saveuserid,
      mode,
      shape: Array.isArray(monsters) ? "array" : typeof monsters,
    });
    return;
  }

  if (!attack.finalises) return;

  await settleAttackArmies({
    userSave,
    entries: monsters.filter(isCellUpdate),
    entryHoused: attack.session?.entryHoused,
    logged: loggedFlung(attack.flinglog),
    now: attack.now,
  });
};
