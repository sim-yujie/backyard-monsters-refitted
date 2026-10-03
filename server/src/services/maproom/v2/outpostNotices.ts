import type { EntityManager } from "@mikro-orm/core";
import { Message } from "../../../database/models/message.model.js";
import { Thread } from "../../../database/models/thread.model.js";
import { Save } from "../../../database/models/save.model.js";
import { BaseType } from "../../../enums/Base.js";
import { MapRoomVersion } from "../../../enums/MapRoom.js";
import { cellCoordsFromBaseId } from "./rangeCheck.js";
import { SYSTEM_SENDER } from "../../mail/systemSender.js";

/**
 * Telling a player when one of their Map Room 2 outposts is attacked or taken
 * (outposts WP8, #187; the owner's answer to Q3, 2026-09-28).
 *
 * Flash told the owner nothing: a lost outpost simply vanished from their list.
 * Each event now leaves the outpost's owner one message in the mailbox (the
 * `thread` and `message` tables the Flash-era mail routes read), from the game
 * rather than from the attacker, so the attacker and everyone else see nothing
 * of it. The owner's next own main yard load hands the unshown ones back in
 * its `completed` list, for the "While you were away" notice, and marks them
 * read (`takeOutpostNotices`); they stay in the mailbox.
 *
 * The text is written once, here, and stored whole: the mailbox shows it as
 * it is and the away notice shows it as it is.
 */

export { SYSTEM_SENDER } from "../../mail/systemSender.js";

export const OUTPOST_ATTACKED = "outpostattacked";
export const OUTPOST_TAKEN = "outposttaken";
/**
 * A Map Room 1 main yard was attacked (bot neighbours §4.8, #242): written in
 * this same form by the after-defence hook (WP8) and handed back here with the
 * outpost notices. Map Room 1 has no cells, so the web mailbox offers no
 * "Show on map" for it.
 */
export const YARD_ATTACKED = "yardattacked";

/** The notices' kinds in the away notice, the load's `completed` list. */
export type OutpostNoticeKind = "outpostAttacked" | "outpostTaken" | "yardAttacked";

const KIND_OF: Readonly<Record<string, OutpostNoticeKind>> = {
  [OUTPOST_ATTACKED]: "outpostAttacked",
  [OUTPOST_TAKEN]: "outpostTaken",
  [YARD_ATTACKED]: "yardAttacked",
};

/** A resource amount per key, as the loot is counted. */
export type ResourceAmounts = Partial<Record<"r1" | "r2" | "r3" | "r4", number>>;

const RESOURCE_NAMES: Readonly<Record<string, string>> = {
  r1: "Twigs",
  r2: "Pebbles",
  r3: "Putty",
  r4: "Goo",
};

/** "1,234 Twigs and 500 Goo", or "" when nothing was taken. */
const amountsText = (amounts: ResourceAmounts): string => {
  const parts = (["r1", "r2", "r3", "r4"] as const).flatMap((key) => {
    const amount = Math.floor(Number(amounts[key] ?? 0));
    return amount > 0 ? [`${amount.toLocaleString("en-GB")} ${RESOURCE_NAMES[key]}`] : [];
  });
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
};

export interface OutpostCell {
  readonly x: number;
  readonly y: number;
}

/**
 * "Bramble attacked your outpost at (243, 206)" and what it cost: the damage
 * it was left at, the loot taken from the owner's pool and, when a Housing
 * fell, how many housed monsters went with it (issue #160).
 */
export const attackNoticeText = (
  attacker: string,
  cell: OutpostCell,
  damage: number,
  loot: ResourceAmounts,
  housedLost = 0,
): { subject: string; message: string } => {
  const taken = amountsText(loot);
  const looted = taken === "" ? "nothing was looted" : `${taken} were looted`;
  const lost = Math.max(0, Math.floor(housedLost));
  return {
    subject: `${attacker} attacked your outpost at (${cell.x}, ${cell.y})`,
    message:
      `It was left ${Math.max(0, Math.round(damage))}% damaged` +
      (lost === 0
        ? `, and ${looted}.`
        : `, ${looted}, and ${lost} housed ${lost === 1 ? "monster was" : "monsters were"} lost.`),
  };
};

/** "Bramble took your outpost at (243, 206)". */
export const takenNoticeText = (taker: string, cell: OutpostCell): { subject: string; message: string } => ({
  subject: `${taker} took your outpost at (${cell.x}, ${cell.y})`,
  message: "It is theirs now, with every building on it.",
});

export interface OutpostNoticeInput {
  /** The outpost's owner, who is told. */
  readonly ownerId: number;
  /** The attacker, the taker, or the player who answered an invitation: never told, and never the owner. */
  readonly byUserId: number;
  /** `outpostattacked`, `outposttaken`, or an invitation's answer (`inviteaccepted`, `invitedeclined`, #205). */
  readonly type: string;
  readonly text: { subject: string; message: string };
  readonly cell: OutpostCell;
  readonly baseid: string;
  readonly now: number;
}

/**
 * Leaves the owner one unread message in a thread of its own, from the game,
 * and brings their unread count up to date. Nothing when the "owner" is the
 * attacker. Flushes `em`; inside a transaction it lands with it.
 */
export const writeOutpostNotice = async (em: EntityManager, input: OutpostNoticeInput): Promise<void> => {
  const { ownerId, byUserId, type, text, cell, baseid, now } = input;
  if (!ownerId || ownerId === byUserId) return;

  const [last] = await em.find(Thread, {}, { orderBy: { threadid: "DESC" }, limit: 1 });
  const thread = new Thread();
  thread.threadid = (last?.threadid ?? 0) + 1;
  thread.userid = SYSTEM_SENDER;
  thread.targetid = ownerId;
  thread.messagecount = 1;
  const message = em.create(Message, {
    threadid: thread.threadid,
    userid: SYSTEM_SENDER,
    targetid: ownerId,
    messagetype: type,
    userUnread: 0,
    targetUnread: 1,
    subject: text.subject,
    message: text.message,
    coords: [cell.x, cell.y],
    baseid,
    updatetime: now,
  });
  thread.lastMessage = message;
  em.persist(thread);
  await em.flush();

  await refreshUnread(em, ownerId);
};

/** One notice as the away notice takes it, in the load's `completed` list. */
export interface OutpostNoticeJob {
  kind: OutpostNoticeKind;
  /** The outpost's base id. */
  id: string;
  t: null;
  at: number;
  detail: { text: string; x: number | null; y: number | null };
}

/**
 * The owner's outpost notices not shown yet, oldest first, marked read as
 * they are handed over: the away notice shows each once, and the mailbox
 * keeps them.
 */
export const takeOutpostNotices = async (em: EntityManager, userid: number): Promise<OutpostNoticeJob[]> => {
  const unread = await em.find(
    Message,
    {
      targetid: userid,
      userid: SYSTEM_SENDER,
      targetUnread: 1,
      messagetype: { $in: [OUTPOST_ATTACKED, OUTPOST_TAKEN, YARD_ATTACKED] },
    },
    { orderBy: { updatetime: "ASC" } },
  );
  if (unread.length === 0) return [];

  for (const message of unread) message.targetUnread = 0;
  await em.flush();
  await refreshUnread(em, userid);

  return unread.map((message) => ({
    kind: KIND_OF[message.messagetype] ?? "outpostAttacked",
    id: message.baseid ?? "",
    t: null,
    at: message.updatetime,
    detail: {
      text: `${message.subject}. ${message.message}`,
      x: message.coords?.[0] ?? null,
      y: message.coords?.[1] ?? null,
    },
  }));
};

/**
 * The owner's main save's `unreadmessages`, as `sendMessage.ts` keeps it
 * (`countUnreadMessage.ts`'s query), counted through `em` so a notice written
 * inside a transaction is counted with it.
 */
const refreshUnread = async (em: EntityManager, userid: number): Promise<void> => {
  const count = await em.count(Message, {
    $or: [
      { userid, userUnread: 1 },
      { targetid: userid, targetUnread: 1 },
    ],
  });
  await em.nativeUpdate(Save, { saveuserid: userid, type: BaseType.MAIN }, { unreadmessages: count });
};

/** Most a single attack can take of one resource (`defenderLootHandler.ts`). */
const MAX_LOOT_PER_RESOURCE = 10_000_000;

/**
 * At the end of an attack on a Map Room 2 outpost, live or finished by the
 * server: tells its owner who attacked it, the damage it was left at and what
 * was looted. `defenderDelta` is the owner's loss as the attack landed it
 * (never positive), taken as `defenderLootHandler` takes it.
 */
export const noticeOutpostAttack = async (
  em: EntityManager,
  input: {
    outpost: Pick<Save, "baseid" | "saveuserid" | "type" | "damage" | "mapversion">;
    attacker: { userid: number; username: string };
    defenderDelta: ResourceAmounts | null | undefined;
    /** Housed monsters lost with the outpost's fallen Housings (issue #160). */
    housedLost?: number;
    now: number;
  },
): Promise<void> => {
  const { outpost, attacker, defenderDelta, housedLost, now } = input;
  if (outpost.type !== BaseType.OUTPOST || outpost.mapversion === MapRoomVersion.V3) return;
  // Its base id carries its cell, as every outpost began as a camp (`rangeCheck.ts`).
  const cell = cellCoordsFromBaseId(outpost.baseid);
  if (!cell) return;

  const loot: ResourceAmounts = {};
  for (const key of ["r1", "r2", "r3", "r4"] as const) {
    const delta = Number(defenderDelta?.[key] ?? 0);
    if (Number.isFinite(delta) && delta < 0) loot[key] = Math.min(-delta, MAX_LOOT_PER_RESOURCE);
  }

  await writeOutpostNotice(em, {
    ownerId: outpost.saveuserid,
    byUserId: attacker.userid,
    type: OUTPOST_ATTACKED,
    text: attackNoticeText(attacker.username, cell, Number(outpost.damage) || 0, loot, housedLost),
    cell,
    baseid: outpost.baseid,
    now,
  });
};
