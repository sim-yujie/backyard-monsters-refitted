import { dayText, type MailItem, type ThreadTruce } from "./mailbox";

/**
 * Where a thread's truce stands and what the mailbox says about it (#203).
 * Pure: `ui/mail/MailboxScreen.ts` draws it.
 *
 * The server keeps a thread's truce as `trucestate` (requested, accepted,
 * rejected) and says when it ends (`truceexpire`); the clock decides the
 * rest. An accepted truce runs 14 days and stops attacks both ways on every
 * yard and outpost of the pair. A request waits 7 days for the recipient's
 * answer and then lapses. After a rejection, the one who asked waits 2 days
 * before asking that player again, until the rejected request's `truceexpire`
 * (`server/src/services/mail/truceRules.ts`).
 */

/** How long an accepted truce lasts, in days. */
export const TRUCE_DAYS = 14;

/** How long a request waits for its answer, in days. */
export const REQUEST_DAYS = 7;

/** The request's text unless the player writes their own (Flash's `map_trucemessage`). */
export const TRUCE_REQUEST_TEXT = "Accept my truce and we can end all this needless bloodshed.";

/** Accept's and Reject's text unless the reply box holds one (Flash's `mail_defaulttruceaccept`, `…reject`). */
export const TRUCE_ACCEPT_TEXT = "I accept your truce.";
export const TRUCE_REJECT_TEXT = "I reject your truce.";

export type TruceState = "pending" | "lapsed" | "active" | "expired" | "rejected";

/** How a state reads: blue while it waits, green while it runs, red when rejected, grey once over. */
export type TruceTone = "info" | "good" | "bad" | "muted";

/** A request's state on its card, and whether the player may answer it. */
export interface TruceCard {
  readonly state: TruceState;
  readonly label: string;
  readonly tone: TruceTone;
  readonly detail: string;
  /** The request is the other player's and still waits: Accept and Reject. */
  readonly canAnswer: boolean;
}

/** Where a thread's truce stands now, or null for a thread with none. */
export const truceState = (truce: ThreadTruce | null, now: number): TruceState | null => {
  if (!truce) return null;
  const over = truce.until !== null && now >= truce.until;
  switch (truce.status) {
    case "requested":
      return over ? "lapsed" : "pending";
    case "accepted":
      return over ? "expired" : "active";
    case "rejected":
      return "rejected";
    default:
      return null;
  }
};

/**
 * Whether the player may propose a truce in the thread: not while one waits or
 * runs, and not in the 2 days after the other player rejected the player's own
 * request (`until`, `mine`); the server refuses both.
 */
export const canPropose = (state: TruceState | null, until: number | null = null, mine = false, now = 0): boolean => {
  if (state === "pending" || state === "active") return false;
  return !(state === "rejected" && mine && until !== null && until > now);
};

/** The message the thread's truce belongs to: its last request, or -1. */
export const requestIndex = (items: readonly MailItem[]): number => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]!.type === "trucerequest") return index;
  }
  return -1;
};

/** A span of time, roughly: "13 days", "1 day", "5 h", "20 min". */
export const spanText = (seconds: number): string => {
  if (seconds >= 86_400) {
    const days = Math.floor(seconds / 86_400);
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  if (seconds >= 3_600) return `${Math.floor(seconds / 3_600)} h`;
  return `${Math.max(1, Math.floor(seconds / 60))} min`;
};

const LABELS: Readonly<Record<TruceState, { label: string; tone: TruceTone }>> = {
  pending: { label: "Waiting", tone: "info" },
  active: { label: "Active", tone: "good" },
  rejected: { label: "Rejected", tone: "bad" },
  expired: { label: "Ended", tone: "muted" },
  lapsed: { label: "Lapsed", tone: "muted" },
};

/** The thread list's tag for a thread's truce, as Flash's inbox labelled it. */
export const truceTag = (state: TruceState): { label: string; tone: TruceTone } => {
  const tags: Record<TruceState, string> = {
    pending: "Truce requested",
    active: "Truce active",
    rejected: "Truce rejected",
    expired: "Truce ended",
    lapsed: "Truce request lapsed",
  };
  return { label: tags[state], tone: LABELS[state].tone };
};

/**
 * The card on a thread's request: its state, what that means, and whether
 * the player answers it. `mine` when the player sent the request.
 */
export const truceCard = (
  state: TruceState,
  until: number | null,
  mine: boolean,
  otherName: string,
  now: number,
): TruceCard => {
  const when = until === null ? "" : ` ${dayText(until)} (${spanText(until - now)} left)`;
  let detail: string;
  switch (state) {
    case "pending":
      detail = mine
        ? `Waiting for ${otherName} to answer.${until === null ? "" : ` The request lapses on${when}.`}`
        : `Accept, and neither of you can attack the other's yards or outposts for ${TRUCE_DAYS} days.${
            until === null ? "" : ` Answer by${when}.`
          }`;
      break;
    case "active":
      detail = `Neither of you can attack the other's yards or outposts${until === null ? "." : ` until${when}.`}`;
      break;
    case "expired":
      detail = until === null ? "The truce has ended." : `The truce ended on ${dayText(until)}.`;
      break;
    case "lapsed":
      detail = `No answer came${until === null ? "" : ` by ${dayText(until)}`}, so the request lapsed.`;
      break;
    case "rejected":
      detail = !mine
        ? "You rejected the truce."
        : until !== null && until > now
          ? `${otherName} rejected the truce. You can ask again in ${spanText(until - now)}, on ${dayText(until)}.`
          : `${otherName} rejected the truce.`;
      break;
  }
  return { state, ...LABELS[state], detail, canAnswer: state === "pending" && !mine };
};
