import type { MailMessage, MailTarget } from "@/api/mail";
import type { OffsetCell } from "@/game/HexGrid";

/**
 * What the mailbox screen shows (#193), worked out from what the mail routes
 * send. Pure: `ui/mail/MailboxScreen.ts` draws it.
 *
 * The game's own notices (outpost attacked, outpost taken, #187) come from
 * `userid` 0, which no player has: they read as notices, with no reply and no
 * block, and a way to the cell they are about.
 */

/** The game's own sender (`server/src/services/mail/systemSender.ts`). */
export const SYSTEM_SENDER = 0;

/** The name the game's notices go under. */
export const SYSTEM_SENDER_NAME = "Backyard Monsters";

/**
 * The notice that the player's Map Room 1 yard was attacked (bot neighbours
 * �8, #242; `server/src/services/maproom/v2/outpostNotices.ts`). Map Room 1
 * has no cells, so it never offers "Show on map", whatever `coords` it carries.
 */
export const YARD_ATTACKED = "yardattacked";

/** The most a message may hold (`SendMessageSchema`). */
export const MESSAGE_LIMIT = 580;

/** A new message's subject when the player leaves it empty. */
export const NO_SUBJECT = "(no subject)";

/** One line of the thread list. */
export interface MailThread {
  readonly threadid: number;
  /** The other party, or {@link SYSTEM_SENDER} for a notice. */
  readonly otherId: number;
  readonly otherName: string;
  readonly subject: string;
  /** The last message's first line. */
  readonly preview: string;
  /** Unix seconds of the last message. */
  readonly time: number;
  /** The last message is unread. */
  readonly unread: boolean;
  /** From the game: read-only, not blockable. */
  readonly notice: boolean;
  readonly count: number;
  /** The thread's truce, as the server keeps it, or null for none (#203). */
  readonly truce: ThreadTruce | null;
  /** The thread's latest invitation to move, as the server keeps it, or null for none (#205). */
  readonly invite: ThreadTruce | null;
}

/**
 * A thread's truce as the server keeps it: `trucestate` and `truceexpire`
 * (#203). An invitation to move has the same shape: `migratestate` and
 * `migrateexpire` (#205).
 */
export interface ThreadTruce {
  /** `requested`, `accepted` or `rejected`; an invitation also `revoked`, `expired` or `void`. */
  readonly status: string;
  /** When it ends: an accepted truce's expiry, or when a waiting request lapses. */
  readonly until: number | null;
}

/** An invitation to move as its message carries it (#205): where it stands, when it lapses, and its outpost's cell. */
export interface MessageInvite extends ThreadTruce {
  readonly cell: OffsetCell | null;
}

/** One message of an open thread. */
export interface MailItem {
  /** Sent by the player. */
  readonly mine: boolean;
  readonly notice: boolean;
  /** "Truce request", "Truce accepted", …, or null for a plain message. */
  readonly label: string | null;
  /** The server's `messagetype`: `message`, `trucerequest`, a notice's kind, … */
  readonly type: string;
  readonly text: string;
  readonly time: number;
  /** A notice's cell, for "Show on map". */
  readonly cell: OffsetCell | null;
  /** On an invitation to move, the invitation (#205); null on anything else. */
  readonly invite: MessageInvite | null;
}

/** A past contact, for a new message's recipient list. */
export interface MailContact {
  readonly userid: number;
  readonly name: string;
}

/** How many characters of a message the thread list shows. */
const PREVIEW_LENGTH = 90;

/** A message's first line, cut to the list's width. */
export const previewOf = (text: string | null): string => {
  const line = (text ?? "").split(/\r?\n/).find((one) => one.trim() !== "")?.trim() ?? "";
  return line.length > PREVIEW_LENGTH ? `${line.slice(0, PREVIEW_LENGTH - 1)}…` : line;
};

/** Whose name a user id goes under. */
export const nameOf = (userid: number, targets: Readonly<Record<string, MailTarget>>): string => {
  if (userid === SYSTEM_SENDER) return SYSTEM_SENDER_NAME;
  return targets[String(userid)]?.first_name || `Player ${userid}`;
};

/**
 * The thread list: one line per thread, newest first (ties by the newer
 * thread), the other party named, the game's notices marked.
 */
export const threadList = (
  threads: readonly MailMessage[],
  targets: Readonly<Record<string, MailTarget>>,
): MailThread[] =>
  threads
    .map((last) => ({
      threadid: Number(last.threadid),
      otherId: Number(last.userid),
      otherName: nameOf(Number(last.userid), targets),
      subject: last.subject || NO_SUBJECT,
      preview: previewOf(last.message),
      time: Number(last.updatetime) || 0,
      unread: Number(last.unread) === 1,
      notice: Number(last.userid) === SYSTEM_SENDER,
      count: Number(last.messagecount) || 1,
      truce: last.trucestate
        ? { status: last.trucestate, until: Number(last.truceexpire) > 0 ? Number(last.truceexpire) : null }
        : null,
      invite: last.migratestate ? inviteOf(last) : null,
    }))
    .sort((one, other) => other.time - one.time || other.threadid - one.threadid);

/** How many threads hold something unread: the Mail button's badge after a mailbox visit. */
export const unreadThreads = (threads: readonly MailThread[]): number =>
  threads.filter((thread) => thread.unread).length;

const TRUCE_LABELS: Readonly<Record<string, string>> = {
  trucerequest: "Truce request",
  truceaccept: "Truce accepted",
  trucereject: "Truce turned down",
  migraterequest: "Invitation to move",
  migraterevoke: "Invitation withdrawn",
};

/** A message's invitation to move, as the server gives it (#205). */
const inviteOf = (message: Pick<MailMessage, "migratestate" | "migrateexpire" | "coords">): MessageInvite => ({
  status: message.migratestate ?? "requested",
  until: Number(message.migrateexpire) > 0 ? Number(message.migrateexpire) : null,
  cell: noticeCell(message),
});

/** A notice's cell from its `coords`, or null. */
export const noticeCell = (message: Pick<MailMessage, "coords">): OffsetCell | null => {
  const [x, y] = message.coords ?? [];
  return Number.isInteger(x) && Number.isInteger(y) ? { col: x as number, row: y as number } : null;
};

/** An open thread, oldest first, each message the player's or the other side's. */
export const threadItems = (messages: readonly MailMessage[], myId: number): MailItem[] =>
  messages.map((message) => {
    const notice = Number(message.userid) === SYSTEM_SENDER;
    return {
      mine: Number(message.userid) === myId,
      notice,
      label: TRUCE_LABELS[message.messagetype] ?? null,
      type: message.messagetype,
      text: message.message ?? "",
      time: Number(message.updatetime) || 0,
      cell: notice && message.messagetype !== YARD_ATTACKED ? noticeCell(message) : null,
      invite: message.messagetype === "migraterequest" ? inviteOf(message) : null,
    };
  });

/** Everyone the player has written with, by name, the game left out: the recipients a new message offers. */
export const contactsOf = (targets: Readonly<Record<string, MailTarget>>): MailContact[] =>
  Object.entries(targets)
    .map(([userid, target]) => ({ userid: Number(userid), name: target.first_name || `Player ${userid}` }))
    .filter((contact) => Number.isSafeInteger(contact.userid) && contact.userid !== SYSTEM_SENDER)
    .sort((one, other) => one.name.localeCompare(other.name) || one.userid - other.userid);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** When a message was sent, as the list says it: "just now", "5 min ago", "3 h ago", "12 Sep". */
export const sentText = (time: number, now: number): string => {
  const ago = Math.max(0, now - time);
  if (ago < 60) return "just now";
  if (ago < 3_600) return `${Math.floor(ago / 60)} min ago`;
  if (ago < 86_400) return `${Math.floor(ago / 3_600)} h ago`;
  return dayText(time);
};

/** A day, as the mailbox says it: "12 Sep". */
export const dayText = (time: number): string => {
  const date = new Date(time * 1000);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
};

/** What a message may be sent as: trimmed, and not empty. Null when there is nothing to send. */
export const sendable = (text: string): string | null => {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed.slice(0, MESSAGE_LIMIT);
};

/** "340 / 580": how much of a message is used. */
export const counterText = (text: string): string => `${text.length} / ${MESSAGE_LIMIT}`;
