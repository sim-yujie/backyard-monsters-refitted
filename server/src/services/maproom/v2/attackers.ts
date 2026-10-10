import type { EntityManager } from "@mikro-orm/postgresql";
import { AttackLogs } from "../../../database/models/attacklogs.model.js";

/**
 * Which of `ownerIds` have ever attacked `userid` (`bym.attack_logs`,
 * `defender_userid = userid`), for the red "attacked you" plate on the Map
 * Room 2 map. No time window, the same rule as the fog of war's revealed
 * attackers (`docs/design/fog-of-war.md` §3.4): once an attacker, always one.
 * An outpost attack logs the owner's main yard as defender, so those count.
 */
export const attackersAmong = async (
  em: EntityManager,
  userid: number,
  ownerIds: number[],
): Promise<Set<number>> => {
  const others = ownerIds.filter((id) => id !== userid);
  if (others.length === 0) return new Set();
  const logs = await em.find(
    AttackLogs,
    { defender_userid: userid, attacker_userid: { $in: others } },
    { fields: ["attacker_userid"] },
  );
  return new Set(logs.map(({ attacker_userid }) => attacker_userid));
};
