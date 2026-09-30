import type { OffsetCell } from "@/game/HexGrid";
import { dayText, type MailItem, type ThreadTruce } from "./mailbox";
import { spanText } from "./truce";

/**
 * An invitation to move and what the mailbox says about it (#205). Pure:
 * `ui/mail/MailboxScreen.ts` draws it.
 *
 * A player invites another to move their main yard onto one of their own
 * outposts (Flash's `migraterequest`). The one invited accepts, paying
 * 10,000,000 of each resource or 1,200 Shiny, and their main yard replaces the
 * outpost, whose buildings and monsters are lost; or they decline. The one who
 * invited may withdraw it while it waits. It lapses after 7 days unanswered,
 * and is void once the outpost changes hands. The server keeps it as the
 * request message's `migratestate` and says when it lapses (`migrateexpire`)
 * (`server/src/services/mail/inviteRules.ts`).
 */

/** How long an invitation waits for its answer, in days. */
export const INVITE_DAYS = 7;

/** What accepting costs the one invited: of each resource, or in Shiny (`MapRoom.as:271-272`). */
export const INVITE_PRICE = { resources: 10_000_000, shiny: 1_200 } as const;

/** Flash's own words: `invite_subject`, `invite_body`, `invite_revoke`. */
export const INVITE_SUBJECT = "Let's Join Forces";
export const INVITE_TEXT = "Move your main yard next to mine and we can work together to dominate the world map!";
export const INVITE_WITHDRAW_TEXT = "Never mind.";

/** What the inviter confirms when sending (the owner's words, 2026-09-30). */
export const INVITE_WARNING = "If they accept, this outpost and everything on it is replaced by their yard.";

export type InviteState = "pending" | "accepted" | "declined" | "withdrawn" | "lapsed" | "void";

export type InviteTone = "info" | "good" | "bad" | "muted";

/** An invitation's card: its state, what it means, and what the player may do. */
export interface InviteCard {
  readonly state: InviteState;
  readonly label: string;
  readonly tone: InviteTone;
  readonly detail: string;
  /** The player was invited and it waits: Accept, Decline, View on map. */
  readonly canAnswer: boolean;
  /** The player invited and it waits: Withdraw. */
  readonly canWithdraw: boolean;
}

/** Where an invitation stands now, or null for none. A waiting one past its lapse reads as lapsed. */
export const inviteState = (invite: ThreadTruce | null, now: number): InviteState | null => {
  if (!invite) return null;
  switch (invite.status) {
    case "requested":
      return invite.until !== null && now >= invite.until ? "lapsed" : "pending";
    case "accepted":
      return "accepted";
    case "rejected":
      return "declined";
    case "revoked":
      return "withdrawn";
    case "expired":
      return "lapsed";
    case "void":
      return "void";
    default:
      return null;
  }
};

/** The message the thread's invitation belongs to: its last one, or -1. */
export const inviteIndex = (items: readonly MailItem[]): number => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]!.type === "migraterequest") return index;
  }
  return -1;
};

const LABELS: Readonly<Record<InviteState, { label: string; tone: InviteTone; tag: string }>> = {
  pending: { label: "Waiting", tone: "info", tag: "Move invitation" },
  accepted: { label: "Accepted", tone: "good", tag: "Move accepted" },
  declined: { label: "Declined", tone: "bad", tag: "Move declined" },
  withdrawn: { label: "Withdrawn", tone: "muted", tag: "Move withdrawn" },
  lapsed: { label: "Lapsed", tone: "muted", tag: "Move invitation lapsed" },
  void: { label: "Void", tone: "muted", tag: "Move invitation void" },
};

/** The thread list's tag for a thread's invitation. */
export const inviteTag = (state: InviteState): { label: string; tone: InviteTone } => ({
  label: LABELS[state].tag,
  tone: LABELS[state].tone,
});

/** "(241, 208)", or "" when the cell is not known. */
const at = (cell: OffsetCell | null): string => (cell ? ` at (${cell.col}, ${cell.row})` : "");

/** "10,000,000 of each resource" or "1,200 Shiny". */
export const invitePriceText = (payment: "resources" | "shiny"): string =>
  payment === "shiny"
    ? `${INVITE_PRICE.shiny.toLocaleString("en-GB")} Shiny`
    : `${INVITE_PRICE.resources.toLocaleString("en-GB")} of each resource`;

/**
 * The card on a thread's invitation. `mine` when the player sent it;
 * `otherName` is the other player.
 */
export const inviteCard = (
  state: InviteState,
  until: number | null,
  mine: boolean,
  otherName: string,
  cell: OffsetCell | null,
  now: number,
): InviteCard => {
  const when = until === null ? "" : ` ${dayText(until)} (${spanText(until - now)} left)`;
  let detail: string;
  switch (state) {
    case "pending":
      detail = mine
        ? `Waiting for ${otherName} to answer. If they accept, your outpost${at(cell)} and everything on it is ` +
          `replaced by their yard.${until === null ? "" : ` It lapses on${when}.`}`
        : `${otherName} invites you to move your main yard onto their outpost${at(cell)}, for ` +
          `${invitePriceText("resources")} or ${invitePriceText("shiny")}. Your outposts stay yours, and wild ` +
          `monsters claim your old spot.${until === null ? "" : ` Answer by${when}.`}`;
      break;
    case "accepted":
      detail = mine
        ? `${otherName} moved their main yard onto your outpost${at(cell)}.`
        : `You moved your main yard${cell ? ` to (${cell.col}, ${cell.row})` : ""}.`;
      break;
    case "declined":
      detail = mine ? `${otherName} declined. The outpost stays yours.` : "You declined the invitation.";
      break;
    case "withdrawn":
      detail = mine ? "You withdrew the invitation." : `${otherName} withdrew the invitation.`;
      break;
    case "lapsed":
      detail = `No answer came${until === null ? "" : ` by ${dayText(until)}`}, so the invitation lapsed.`;
      break;
    case "void":
      detail = `The outpost${at(cell)} changed hands, so the invitation is void.`;
      break;
  }
  const { label, tone } = LABELS[state];
  return {
    state,
    label,
    tone,
    detail,
    canAnswer: state === "pending" && !mine,
    canWithdraw: state === "pending" && mine,
  };
};
