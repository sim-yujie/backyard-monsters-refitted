import type { EntityManager } from "@mikro-orm/core";

import { AllianceInviteStatus } from "../../enums/Alliance.js";
import { MessageType } from "../../enums/MessageType.js";
import { Alliance } from "../../database/models/alliance.model.js";
import { AllianceInvite } from "../../database/models/allianceinvite.model.js";
import { Message } from "../../database/models/message.model.js";
import { Thread } from "../../database/models/thread.model.js";
import { refreshUnread } from "../maproom/v2/outpostNotices.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";

/*
 * Alliance invites by in-game mail (owner, 10 Nov 2026). When a Leader or
 * Officer invites a player, the invite reaches that player's mailbox as a
 * message from the inviter, in a thread of its own, which they can accept or
 * decline from (`/alliance/changeinvitestatus` with the message's
 * `allianceinviteid`) or simply answer in words. The invite row stays the
 * source of truth: the message only points at it, and says where the invite
 * stands each time the mailbox is read (`allianceInviteFields`). Plain Members
 * cannot invite (`AllianceAction.INVITE`), and there is no share link.
 */

/** Where an invite delivered by mail stands, as the mailbox shows it. */
export type AllianceInviteMailState = "pending" | "accepted" | "declined" | "closed";

/** What an `allianceinvite` message adds when the mailbox is read. */
export interface AllianceInviteMailFields {
  allianceinvite: {
    /** `closed` once the invite is gone (withdrawn with a map change, cleared, or its alliance disbanded). */
    state: AllianceInviteMailState;
    alliance_id: number | null;
    alliance_name: string | null;
    alliance_image: number | null;
  };
}

/** The message's words: the inviter's name and the alliance's, as they are when it is sent. */
export const inviteMailText = (inviterName: string, allianceName: string) => ({
  subject: `Join ${allianceName}`,
  message: `${inviterName} invites you to join the alliance ${allianceName}. Accept or decline below.`,
});

export interface AllianceInviteMailInput {
  inviter: { userid: number; username: string };
  invitedId: number;
  alliance: Pick<Alliance, "name">;
  invite: Pick<AllianceInvite, "id">;
  /** Unix seconds; now by default. */
  now?: number;
}

/**
 * Leaves the invited player one unread `allianceinvite` message from the
 * inviter, in a new thread, and brings their unread count up to date (which
 * tells their game, `mailNudge.ts`). Flushes `em`: inside the invite's
 * transaction, the message lands with the invite or not at all.
 */
export const mailAllianceInvite = async (em: EntityManager, input: AllianceInviteMailInput): Promise<Message> => {
  const { inviter, invitedId, alliance, invite } = input;
  const now = input.now ?? getCurrentDateTime();
  const text = inviteMailText(inviter.username, alliance.name);

  const [last] = await em.find(Thread, {}, { orderBy: { threadid: "DESC" }, limit: 1 });
  const thread = new Thread();
  thread.threadid = (last?.threadid ?? 0) + 1;
  thread.userid = inviter.userid;
  thread.targetid = invitedId;
  thread.messagecount = 1;

  const message = em.create(Message, {
    threadid: thread.threadid,
    userid: inviter.userid,
    targetid: invitedId,
    messagetype: MessageType.ALLIANCE_INVITE,
    userUnread: 0,
    targetUnread: 1,
    subject: text.subject,
    message: text.message,
    updatetime: now,
    allianceinviteid: invite.id,
  });

  thread.lastMessage = message;
  em.persist(thread);
  await em.flush();

  await refreshUnread(em, invitedId);

  return message;
};

/**
 * Where each invite named by `allianceinvite` messages stands now, by invite
 * id: one read of the invites and one of their alliances, however many
 * messages.
 */
export const allianceInviteFields = async (
  em: EntityManager,
  inviteIds: readonly (number | null | undefined)[]
): Promise<Map<number, AllianceInviteMailFields>> => {
  const ids = [...new Set(inviteIds.filter((id): id is number => Number.isInteger(id)))];
  const fields = new Map<number, AllianceInviteMailFields>();

  if (ids.length === 0) return fields;

  const invites = await em.find(AllianceInvite, { id: { $in: ids } });
  const allianceIds = [...new Set(invites.map((invite) => invite.alliance_id))];
  const alliances = allianceIds.length ? await em.find(Alliance, { id: { $in: allianceIds } }) : [];
  const alliancesById = new Map(alliances.map((alliance) => [alliance.id, alliance]));
  const invitesById = new Map(invites.map((invite) => [invite.id, invite]));

  for (const id of ids) {
    const invite = invitesById.get(id);
    const alliance = invite ? alliancesById.get(invite.alliance_id) : undefined;
    const state: AllianceInviteMailState =
      !invite || !alliance
        ? "closed"
        : invite.status === AllianceInviteStatus.ACCEPTED
          ? "accepted"
          : invite.status === AllianceInviteStatus.DECLINED
            ? "declined"
            : "pending";

    fields.set(id, {
      allianceinvite: {
        state,
        alliance_id: alliance?.id ?? null,
        alliance_name: alliance?.name ?? null,
        alliance_image: alliance?.image ?? null,
      },
    });
  }

  return fields;
};
