import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import { postgres } from "../../server.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { catchUpLockedYard } from "../../controllers/yard/yardAction.js";
import { isAttackActive } from "../base/isAttackActive.js";
import { ownYardsInReach } from "../maproom/v2/ownYardsInReach.js";
import type { CellCoords } from "../maproom/v2/rangeCheck.js";
import {
  countsOf,
  flungPerYard,
  subtractHoused,
  type Counts,
  type EntryHoused,
} from "./attackRoster.js";
import { academyLevels, catchUpArmy, type ArmyRow, type MonsterJob } from "./catchUpMonsters.js";
import { jobQuestEvents } from "../quests/hooks.js";
import { addQuestEvents, type QuestEvents } from "../quests/state.js";

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
 *
 * A path that WRITES such a catch-up also moves the production clock
 * (`monsters.saved`), so the owner's next full catch-up never sees the
 * monsters that finished hatching in it. Those hatches count for the hatch
 * quest here instead ({@link armyQuestEvents}), each exactly once: the caller
 * records them on the owner's main row once the row is written.
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
    // The Inferno yard has its own Control Centre (the Incubator Control Centre), as the main yard has.
    mainYard: row.type === BaseType.MAIN || row.type === BaseType.INFERNO,
  });

/**
 * The hatch quest's share of a written monsters-only catch-up (`hatch` and
 * `hatch:<monster>`): a main yard's or an outpost's hatches count for the
 * owner's quests, as the full catch-up counts them; the Inferno's never do.
 */
export const armyQuestEvents = (row: { type?: string }, jobs: readonly MonsterJob[]): QuestEvents =>
  row.type === BaseType.INFERNO ? {} : jobQuestEvents(jobs);

/**
 * Catches a row's monsters up and puts the result on the entity (the caller
 * persists, then records the hatches returned on the owner's main row).
 */
const applyArmy = (row: Save, owner: ArmyOwner, now: number): QuestEvents => {
  const army = catchUpArmyRow(row, owner, now);
  row.monsters = army.monsters;
  if (army.resources !== row.resources) row.resources = army.resources;
  return armyQuestEvents(row, army.jobs);
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
 *   measured. Every outpost of theirs whose own flinger reaches the target
 *   (`ownYardsInReach`) gets its monsters caught up.
 * - On Map Room 2, `entryHoused` lists only the yards whose flinger reaches
 *   the target, the main yard included: the yards the Attack window sums, and
 *   the only ones the attack can fling from and spend.
 *
 * Runs before the attack is committed, while nothing on either row has been
 * changed yet: the locked catch-up re-reads the row.
 *
 * @returns The defender entity to carry on with (the locked read's),
 *   `entryHoused` (Map Room 2 attacks; Map Room 1 attacks, main yard only),
 *   and the hatches the outposts' written catch-ups finished, for the hatch
 *   quest: `attackerHatched` (the attacker's outposts) and `defenderHatched`
 *   (a defending outpost, its owner's). The main yards' locked catch-ups
 *   count their own. The caller records them once the rows are written.
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
}): Promise<{
  defender: Save;
  entryHoused: EntryHoused | undefined;
  attackerHatched: QuestEvents;
  defenderHatched: QuestEvents;
}> => {
  const now = getCurrentDateTime();
  const userSave = user.save!;
  let target = defender;
  let defenderHatched: QuestEvents = {};
  const attackerHatched: QuestEvents[] = [];

  if (defender.type === BaseType.MAIN) {
    ({ save: target } = await catchUpLockedYard(postgres.em, defender));
  } else if (defender.type === BaseType.OUTPOST) {
    const owner = await postgres.em.findOne(
      Save,
      { saveuserid: defender.saveuserid, type: BaseType.MAIN },
      { fields: ["academy", "storedata"] }
    );
    defenderHatched = applyArmy(defender, owner, now);
  }

  // Map Room 2 and Map Room 1 attacks settle their roster through
  // `entryHoused`; Map Room 3 monsters are per creep. A Map Room 1 attacker
  // flings from their main yard's housing only (issue #132): the web client
  // reports the army as `monsterupdate`, never Flash's `attackcreatures`.
  const mapRoom1 = mapversion === MapRoomVersion.V1;
  if (mapversion !== MapRoomVersion.V2 && !mapRoom1) {
    return { defender: target, entryHoused: undefined, attackerHatched: {}, defenderHatched };
  }

  const entryHoused: EntryHoused = {};

  // A Map Room 2 attack flings only from the yards whose own flinger reaches
  // the target (`ownYardsInReach`), the cells the Attack window sums; the
  // others are left out of the roster, so nothing can be flung or spent from
  // them. With no cell to measure to, the main yard alone, as before.
  const reaching = cell && !mapRoom1 ? await ownYardsInReach(user, cell) : [userSave.baseid];
  const mainHoused = isAttackActive(userSave)
    ? countsOf(catchUpArmyRow(userSave, userSave, now).monsters?.housed)
    : countsOf((await catchUpLockedYard(postgres.em, userSave)).save.monsters?.housed);
  if (reaching.includes(userSave.baseid)) entryHoused[userSave.baseid] = mainHoused;

  const near = reaching.filter((baseid) => baseid !== userSave.baseid);
  if (near.length > 0) {
    const outposts = await postgres.em.find(Save, {
      baseid: { $in: near },
      saveuserid: user.userid,
    });
    for (const outpost of outposts) {
      if (isAttackActive(outpost)) {
        entryHoused[outpost.baseid] = countsOf(catchUpArmyRow(outpost, userSave, now).monsters?.housed);
        continue;
      }
      attackerHatched.push(applyArmy(outpost, userSave, now));
      entryHoused[outpost.baseid] = countsOf(outpost.monsters?.housed);
      postgres.em.persist(outpost);
    }
  }

  return { defender: target, entryHoused, attackerHatched: addQuestEvents(...attackerHatched), defenderHatched };
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
 * @returns The hatches the yards' catch-ups finished since the attack began
 *   (`hatch`, `hatch:<monster>`), for the caller to count on the attacker's
 *   quests once the landing commits: written here, they are no later
 *   catch-up's to count (issue: Slimeattikus hatch quest, 17 Nov 2026).
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
}): Promise<QuestEvents> => {
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
  return addQuestEvents(...armies.map(({ row, army }) => armyQuestEvents(row, army.jobs)));
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

/**
 * {@link monstersForMap} for many of the viewer's own cells at once: one
 * query for every row instead of one per cell (a zone holding a dozen own
 * outposts asked a dozen times, one after another; map-lag fix, 25 Nov 2026).
 * The same rows, fields and catch-up, so each answer is what
 * {@link monstersForMap} gives for that cell. A row that is gone is left out
 * of the map (the caller falls back to the stored blob, as for `undefined`).
 *
 * @param basesaveids - The cells' saves.
 * @param ownerSave - The viewer's main save, read only if some row is an outpost.
 * @param now - Server seconds.
 */
export const monstersForMapMany = async (
  basesaveids: readonly number[],
  ownerSave: () => Promise<ArmyOwner>,
  now: number
): Promise<Map<number, JsonObject | null | undefined>> => {
  const unique = [...new Set(basesaveids)];
  const answers = new Map<number, JsonObject | null | undefined>();
  if (!unique.length) return answers;
  const rows = await postgres.em.find(Save, { basesaveid: { $in: unique } }, { fields: ARMY_FIELDS });
  let viewerMain: Promise<ArmyOwner> | undefined;
  for (const row of rows) {
    const owner = row.type === BaseType.MAIN ? row : await (viewerMain ??= ownerSave());
    answers.set(row.basesaveid, catchUpArmyRow(row, owner, now).monsters);
  }
  return answers;
};

/** The viewer's main save's academy and buffs, for {@link monstersForMap}. */
export const loadArmyOwner = (basesaveid: number): Promise<ArmyOwner> =>
  postgres.em.findOne(Save, { basesaveid }, { fields: ["academy", "storedata"] });

/**
 * Monster transfers (`transferMonsters.ts`): both yards caught up and put on
 * their entities before the transfer rules read them. Returns their hatches,
 * for the caller to count on the player's quests once the transfer commits.
 */
export const catchUpTransferYards = (yards: readonly Save[], owner: ArmyOwner, now: number): QuestEvents =>
  addQuestEvents(...yards.map((yard) => applyArmy(yard, owner, now)));
