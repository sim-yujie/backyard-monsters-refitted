import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { secondsOf } from "../friends/friendRules.js";
import { addPhotos } from "../profile/visiblePhoto.js";
import { onlinePlayers } from "../user/online.js";
import { seenStepOf, type SeenStep } from "../user/seenStep.js";
import { ALLIANCE_MEMBER_FIELDS, toAllianceMember, type AllianceMember } from "./allianceMember.js";

/** One row of the Members tab: a member, and how recently they played. */
export interface AllianceRosterMember extends AllianceMember {
  /**
   * "Last seen" (beta 9, `services/user/seenStep.ts`): online, today, week,
   * weeks (1-4 weeks) or month (over a month); null for a member who hides
   * their online status and is still active. Every member sees it.
   * `last_seen_at` itself is never sent.
   */
  seen: SeenStep | null;
}

/**
 * The Members tab's columns: a member's card, plus what "last seen" needs.
 * Read only here, not for the Suggested list (players outside the alliance).
 */
const ROSTER_FIELDS = [...ALLIANCE_MEMBER_FIELDS, "hide_online", "last_seen_at"] as const;

/**
 * Builds the Members tab roster for one alliance: one database read for the
 * members (and their yards), one for their photos and one Redis call for who
 * is online, however many members (up to 60).
 *
 * @param {number} allianceId - The alliance whose roster is being read.
 * @returns {Promise<AllianceRosterMember[]>} Members ordered by empire points, highest first.
 */
export const getAllianceMembers = async (allianceId: number): Promise<AllianceRosterMember[]> => {
  const members = await postgres.em.find(
    User,
    { alliance_id: allianceId },
    {
      fields: ROSTER_FIELDS,
      orderBy: { userid: "ASC" },
    },
  );

  const now = getCurrentDateTime();
  const online = await onlinePlayers(members.map((member) => member.userid), now);

  const roster: AllianceRosterMember[] = [];
  for (const member of members) {
    const row = toAllianceMember(member, online, now);
    if (!row) continue;
    roster.push({ ...row, seen: seenStepOf(!!member.hide_online, online.has(member.userid), secondsOf(member.last_seen_at), now) });
  }

  await addPhotos(postgres.em, roster, (member) => member.user_id);
  return roster.sort((member, other) => other.points - member.points);
};
