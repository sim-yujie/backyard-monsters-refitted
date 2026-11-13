import { BaseType } from "../../enums/Base.js";
import { AllianceInviteStatus } from "../../enums/Alliance.js";
import { AllianceInvite } from "../../database/models/allianceinvite.model.js";
import type { Alliance } from "../../database/models/alliance.model.js";
import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { addPhotos } from "../profile/visiblePhoto.js";
import { onlinePlayers } from "../user/online.js";
import { ALLIANCE_MEMBER_FIELDS, toAllianceMember, type AllianceMember } from "./allianceMember.js";

const SUGGESTED_LIMIT = 50;

/**
 * Builds the Suggested tab's candidate list for one alliance.
 *
 * Candidates are unaffiliated players in the alliance's own world (one world
 * per alliance, owner 10 Nov 2026), newest player first. The join gate's other
 * rules (Map Room 2, Observatory) are checked when the invite is sent. Ordering on save.savetime is what makes the list worth reading: an
 * invite only pays off if it reaches someone still playing.
 *
 * Anyone with a pending exchange already open with this alliance is left out.
 *
 * @param {Alliance} alliance - The alliance doing the recruiting.
 * @returns {Promise<AllianceMember[]>} Candidate rows, most recently active first.
 */
export const getSuggestedMembers = async (alliance: Alliance): Promise<AllianceMember[]> => {
  const worldIds = [alliance.world_id];

  const invite = await postgres.em.find(
    AllianceInvite,
    { alliance_id: alliance.id, status: AllianceInviteStatus.PENDING },
    { fields: ["user_id"] },
  );

  const alreadyAsked = invite.map((invite) => invite.user_id);

  const candidates = await postgres.em.find(
    User,
    {
      alliance_id: null,
      userid: { $nin: alreadyAsked },
      save: { type: BaseType.MAIN, worldid: { $in: worldIds } },
    },
    {
      fields: ALLIANCE_MEMBER_FIELDS,
      orderBy: { save: { savetime: "DESC" } },
      limit: SUGGESTED_LIMIT,
    },
  );

  const now = getCurrentDateTime();
  const online = await onlinePlayers(candidates.map((user) => user.userid), now);

  const rows = candidates
    .map((user) => toAllianceMember(user, online, now))
    .filter((user) => user !== null);
  return addPhotos(postgres.em, rows, (user) => user.user_id);
};
