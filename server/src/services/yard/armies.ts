import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import { postgres } from "../../server.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { catchUpLockedYard } from "../../controllers/yard/yardAction.js";
import { isAttackActive } from "../base/isAttackActive.js";
import { outpostsNearCell, type CellCoords } from "../maproom/v2/rangeCheck.js";
import {
  countsOf,
  flungPerYard,
  subtractHoused,
  type Counts,
  type EntryHoused,
} from "./attackRoster.js";
import { academyLevels, catchUpArmy, type ArmyRow } from "./catchUpMonsters.js";

/**
 * Where the server catches armies up outside a yard action
 * (`docs/design/yard-buildings.md` §2.3 "Where it runs", §4.6): attack entry,
 * the attack save, the map's own cells and monster transfers. The rules are
 * `catchUpMonsters.ts` and `attackRoster.ts`; this is the half that reads and
 * writes rows.
 *
 * Every path but attack entry catches up the **monsters only**
 * (`catchUpArmy`): it moves `monsters` (and, on a main yard whose HCC just
 * finished, `resources`), never `buildingdata` or `savetime`. That is safe on
 * a row somebody else's attack owns at that moment, and it leaves the
 * monsters exactly as the owner's next full catch-up would.
 */

/** The columns a monsters-only catch-up reads. */
const ARMY_FIELDS = [
  "basesaveid",
  "baseid",
  "type",
  "savetime",
  "monsters",
  "buildingdata",
  "buildinghealthdata",
  "storedata",
  "academy",
  "resources",
  "outposts",
  "mapversion",
  "points",
] as const;

/** The player-level state an outpost's army is caught up with: its owner's main save. */
export type ArmyOwner = Pick<Save, "academy" | "storedata"> | null | undefined;

/**
 * Catches one row's monsters up to `now` in memory, with the owner's academy
 * levels and buffs (an outpost's own columns hold neither).
 */
export const catchUpArmyRow = (row: ArmyRow & { type?: string }, owner: ArmyOwner, now: number) =>
  catchUpArmy(row, now, {
    levels: academyLevels(owner?.academy ?? row.academy),
    buffs: owner?.storedata ?? row.storedata,
    mainYard: row.type === BaseType.MAIN,
  });

/** Catches a row's monsters up and puts the result on the entity (the caller persists). */
const applyArmy = (row: Save, owner: ArmyOwner, now: number): void => {
  const army = catchUpArmyRow(row, owner, now);
  row.monsters = army.monsters;
  if (army.resources !== row.resources) row.resources = army.resources;
};

/**
 * Attack entry (`baseModeAttack`): catches up and writes the defender and the
 * attacker's own yards that can be in the roster, and says what each of the
 * attacker's yards housed then (`entryHoused`, kept in the attack session).
 *
 * - The defender's main yard gets the full locked catch-up its owner's load
 *   would give it; a defending outpost, its monsters.
 * - The attacker's main yard gets the full locked catch-up, unless someone is
 *   attacking it right now (their save owns the row): then it is only
 *   measured. Every outpost of theirs close enough to reach the target (the
 *   range rule's sweep box, `rangeCheck.ts`) gets its monsters caught up.
 *
 * Runs before the attack is committed, while nothing on either row has been
 * changed yet: the locked catch-up re-reads the row.
 *
 * @returns The defender entity to carry on with (the locked read's), and
 *   `entryHoused` (Map Room 2 attacks only).
 */
export const catchUpArmiesForAttack = async ({
  user,
  defender,
  cell,
  mapversion,
}: {
  user: User;
  defender: Save;
  cell: CellCoords | null;
  mapversion?: MapRoomVersion;
}): Promise<{ defender: Save; entryHoused: EntryHoused | undefined }> => {
  const now = getCurrentDateTime();
  const userSave = user.save!;
  let target = defender;

  if (defender.type === BaseType.MAIN) {
    ({ save: target } = await catchUpLockedYard(postgres.em, defender));
  } else if (defender.type === BaseType.OUTPOST) {
    const owner = await postgres.em.findOne(
      Save,
      { saveuserid: defender.saveuserid, type: BaseType.MAIN },
      { fields: ["academy", "storedata"] }
    );
    applyArmy(defender, owner, now);
  }

  // Only a Map Room 2 attack settles its roster through `entryHoused`: Map
  // Room 3 monsters are per creep, and a Map Room 1 attack reports its
  // attacker's army as `attackcreatures`.
  if (mapversion !== MapRoomVersion.V2) return { defender: target, entryHoused: undefined };

  const entryHoused: EntryHoused = {};

  if (isAttackActive(userSave)) {
    entryHoused[userSave.baseid] = countsOf(catchUpArmyRow(userSave, userSave, now).monsters?.housed);
  } else {
    const { save: locked } = await catchUpLockedYard(postgres.em, userSave);
    entryHoused[userSave.baseid] = countsOf(locked.monsters?.housed);
  }

  const near = cell ? outpostsNearCell(cell, userSave.outposts ?? []) : [];
  if (near.length > 0) {
    const outposts = await postgres.em.find(Save, {
      baseid: { $in: near.map((outpost) => outpost.baseid) },
      saveuserid: user.userid,
    });
    for (const outpost of outposts) {
      if (isAttackActive(outpost)) {
        entryHoused[outpost.baseid] = countsOf(catchUpArmyRow(outpost, userSave, now).monsters?.housed);
        continue;
      }
      applyArmy(outpost, userSave, now);
      entryHoused[outpost.baseid] = countsOf(outpost.monsters?.housed);
      postgres.em.persist(outpost);
    }
  }

  return { defender: target, entryHoused };
};

/** One `monsterupdate` entry, as the attack save carries it. */
export interface SentCell {
  baseid: string | number;
  m?: JsonObject | null;
}

/**
 * The attack save that ends an attack: takes the flung monsters out of the
 * attacker's yards, each caught up to now first (`attackRoster.ts`). The
 * client's blobs are never written. Yards are the save's own-yard entries, in
 * its order, scoped to the attacker; with none, the yards recorded at entry.
 *
 * @param userSave - The attacker's main save (written by the caller's flush).
 * @param entries - The save's `monsterupdate` entries.
 * @param entryHoused - From the attack session, if it has one.
 * @param logged - Monsters flung per the fling log, or null without one.
 * @param now - Server seconds.
 */
export const settleAttackArmies = async ({
  userSave,
  entries,
  entryHoused,
  logged,
  now,
}: {
  userSave: Save;
  entries: readonly SentCell[];
  entryHoused?: EntryHoused;
  logged: Counts | null;
  now: number;
}): Promise<void> => {
  const sent: Record<string, Counts> = {};
  const order: string[] = [];
  for (const entry of entries) {
    const baseid = String(entry.baseid);
    if (order.includes(baseid)) continue;
    order.push(baseid);
    sent[baseid] = countsOf(entry.m?.housed);
  }
  if (order.length === 0) order.push(...Object.keys(entryHoused ?? {}));

  const others = order.filter((baseid) => baseid !== userSave.baseid);
  const found =
    others.length === 0
      ? []
      : await postgres.em.find(Save, { baseid: { $in: others }, saveuserid: userSave.saveuserid });
  const byBaseid = new Map(found.map((row) => [row.baseid, row]));

  const rows = order
    .map((baseid) => (baseid === userSave.baseid ? userSave : byBaseid.get(baseid)))
    .filter((row): row is Save => row !== undefined);

  const armies = rows.map((row) => ({ row, army: catchUpArmyRow(row, userSave, now) }));
  const taken = flungPerYard({
    cells: armies.map(({ row, army }) => ({ baseid: row.baseid, housed: countsOf(army.monsters?.housed) })),
    sent,
    entryHoused,
    logged,
  });

  for (const { row, army } of armies) {
    row.monsters = subtractHoused(army.monsters, taken[row.baseid]);
    if (army.resources !== row.resources) row.resources = army.resources;
    if (row !== userSave) {
      // As `updateMonsters` did: a yard that flung loses its protection.
      row.protected = 0;
      postgres.em.persist(row);
    }
  }
};

/**
 * The map's `m` for one of the viewer's own cells: the stored blob caught up
 * in memory (§2.3), so the roster the map shows equals what the next write
 * will store. Nothing is written.
 *
 * @param basesaveid - The cell's save.
 * @param ownerSave - The viewer's main save, for academy levels and buffs.
 * @param now - Server seconds.
 */
export const monstersForMap = async (
  basesaveid: number,
  ownerSave: () => Promise<ArmyOwner>,
  now: number
): Promise<JsonObject | null | undefined> => {
  const row = await postgres.em.findOne(Save, { basesaveid }, { fields: ARMY_FIELDS });
  if (!row) return undefined;
  const owner = row.type === BaseType.MAIN ? row : await ownerSave();
  return catchUpArmyRow(row, owner, now).monsters;
};

/** The viewer's main save's academy and buffs, for {@link monstersForMap}. */
export const loadArmyOwner = (basesaveid: number): Promise<ArmyOwner> =>
  postgres.em.findOne(Save, { basesaveid }, { fields: ["academy", "storedata"] });

/**
 * Monster transfers (`transferMonsters.ts`): both yards caught up and put on
 * their entities before the transfer rules read them.
 */
export const catchUpTransferYards = (yards: readonly Save[], owner: ArmyOwner, now: number): void => {
  for (const yard of yards) applyArmy(yard, owner, now);
};
