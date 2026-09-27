import { Save } from "../../../../database/models/save.model.js";
import type { FlingEvent } from "../../../../game-rules/combat/index.js";
import type { AttackSession } from "../../../../services/base/attackSession.js";
import { flungOf } from "../../../../services/base/combat/abandonedAttack.js";
import { settleAttackArmies } from "../../../../services/yard/armies.js";
import type { Counts } from "../../../../services/yard/attackRoster.js";

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

type MonsterUpdatePayload = MonsterUpdate[] | Record<string, unknown>;

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
}

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
 * Handles the `monsterupdate` save key after an attack. Branches on format to
 * support both map versions.
 *
 * MR3: The client sends a plain object keyed by creatureID, where each value is an array
 * of per-creep state objects `{ health, ownerID, q }`, with an optional `Q` heal queue.
 * Written as sent (unchanged).
 *
 * MR2: The client sends an array of cell updates `[{ baseid, m: housingState }, ...]`.
 * These are no longer written (`docs/design/yard-buildings.md` §4.6): the save
 * that ends the attack takes the flung monsters out of the attacker's yards as
 * caught up now (`services/yard/armies.ts`, `services/yard/attackRoster.ts`),
 * which keeps what hatched during the attack and cannot add a monster. Only
 * that save does it, under the final lock, so the monsters leave exactly once
 * whether the attack ends by this save or by the server finishing it
 * (`finaliseAttack.ts`); an earlier save of the same attack changes nothing,
 * since every save repeats the whole log.
 *
 * @param {MonsterUpdatePayload} monsters - Parsed monsterupdate payload
 * @param {Save} userSave - The attacking user's main save
 * @param {MonsterUpdateContext} attack - The session, whether the save finalises, the log
 */
export const monsterUpdateHandler = async (
  monsters: MonsterUpdatePayload,
  userSave: Save,
  attack: MonsterUpdateContext
) => {
  if (!Array.isArray(monsters)) {
    userSave.monsters = monsters;
    return;
  }

  if (!attack.finalises) return;

  await settleAttackArmies({
    userSave,
    entries: monsters.filter((entry) => entry && entry.baseid !== undefined && entry.baseid !== null),
    entryHoused: attack.session?.entryHoused,
    logged: loggedFlung(attack.flinglog),
    now: attack.now,
  });
};
