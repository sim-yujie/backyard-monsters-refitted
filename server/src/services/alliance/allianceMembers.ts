import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { onlinePlayers } from "../user/online.js";
import { ALLIANCE_MEMBER_FIELDS, toAllianceMember, type AllianceMember } from "./allianceMember.js";

/**
 * Builds the Members tab roster for one alliance.
 *
 * @param {number} allianceId - The alliance whose roster is being read.
 * @returns {Promise<AllianceMember[]>} Members ordered by empire points, highest first.
 */
export const getAllianceMembers = async (allianceId: number): Promise<AllianceMember[]> => {
  const members = await postgres.em.find(
    User,
    { alliance_id: allianceId },
    {
      fields: ALLIANCE_MEMBER_FIELDS,
      orderBy: { userid: "ASC" },
    },
  );

  const now = getCurrentDateTime();
  const online = await onlinePlayers(members.map((member) => member.userid), now);

  const roster = members
    .map((member) => toAllianceMember(member, online, now))
    .filter((member) => member !== null);

  return roster.sort((member, other) => other.points - member.points);
};
