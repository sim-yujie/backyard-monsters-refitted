import { Maproom } from "../../../database/models/maproom.model.js";
import { User } from "../../../database/models/user.model.js";
import { postgres } from "../../../server.js";
import { calculateBaseLevel } from "../../base/calculateBaseLevel.js";
import { createNeighbourData } from "../createNeighbourData.js";
import { dayStart, noteDropped } from "../neighbourCache.js";
import { AttackPermission } from "../../../enums/MapRoom.js";
import { attackedRecently, vengeanceOwed } from "./mr1AttackRules.js";
import type { NeighbourData } from "../../../types/NeighbourData.js";

/** A list longer than this is cut back, keeping anyone who attacked its owner in the revenge window. */
const LIST_CAP = 25;

/**
 * Adds the attacker to the defender's neighbor list for retaliation purposes.
 *
 * When a player attacks another player's MR1 base, the attacker is automatically
 * added to the defender's neighbor list (if not already present). This allows the
 * defender to see who attacked them and enables potential retaliation.
 *
 * The 10th attack in a day on the same neighbour drops the pair from both
 * lists and notes the drop on both maproom rows, so a re-search leaves the
 * pair out until the day rolls over (issue #247).
 *
 * Map Room 1 vengeance (`mr1AttackRules.ts`): an attack made from more than
 * the level gap below (`permission` HIGHER_LEVEL) gives the defender one
 * vengeance on the attacker; one made in vengeance (VENGEANCE_MODE) spends
 * one of the attacker's. Every attack stamps `lastattackfrom` on the
 * defender's entry for the attacker, which starts the 14-day window again.
 *
 * @notes the client has a maximum of 180 neighbors that can theoretically be displayed
 *
 * @param {User} attacker - The user who initiated the attack
 * @param {User} defender - The user who was attacked
 * @param {AttackPermission} permission - What the level rule allowed when the attack began
 * @param {Date} now - The current time
 */
export const registerAttacker = async (
  attacker: User,
  defender: User,
  permission: AttackPermission = AttackPermission.ATTACKABLE,
  now: Date = new Date()
) => {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const earned = permission === AttackPermission.HIGHER_LEVEL ? 1 : 0;
  // Vengeance still owed before this attack restarts the window: an expired
  // count never comes back to life.
  const stamp = (entry: NeighbourData) => {
    entry.vengeance = vengeanceOwed(entry, nowSeconds) + earned;
    entry.lastattackfrom = nowSeconds;
  };

  let [defenderMaproom, attackerMaproom] = await Promise.all([
    postgres.em.findOne(Maproom, { userid: defender.userid }),
    postgres.em.findOne(Maproom, { userid: attacker.userid }),
  ]);

  if (!defenderMaproom) defenderMaproom = await Maproom.setupMapRoomData(postgres.em, defender);
  if (!attackerMaproom) attackerMaproom = await Maproom.setupMapRoomData(postgres.em, attacker);

  if (!attacker.save) throw new Error("Attacker save not found.");

  const { neighbors: defenderNeighbor } = defenderMaproom;

  // Check if attacker already exists in the defender's neighbors
  const existingAttacker = defenderNeighbor.find(
    (neighbor) => neighbor.userid === attacker.userid
  );

  if (!existingAttacker) {
    const attackerLevel = calculateBaseLevel(
      attacker.save.points,
      attacker.save.basevalue
    );

    const attackerNeighbour = createNeighbourData(
      attacker.save,
      attacker,
      attackerLevel
    );

    attackerNeighbour.attacksfrom = 1;
    stamp(attackerNeighbour);

    defenderNeighbor.unshift(attackerNeighbour);

    if (defenderNeighbor.length > LIST_CAP) {
      defenderMaproom.neighbors = defenderNeighbor.filter(
        (entry, index) => index < LIST_CAP || attackedRecently(entry, nowSeconds)
      );
    }
  } else {
    existingAttacker.attacksfrom = (existingAttacker.attacksfrom ?? 0) + 1;
    stamp(existingAttacker);
  }

  // Update attacker's neighbor list, defender should already exist from initial seeding.
  const existingDefender = attackerMaproom.neighbors.find(
    (neighbor) => neighbor.userid === defender.userid
  );

  if (existingDefender) {
    existingDefender.attacksto = (existingDefender.attacksto ?? 0) + 1;

    if (permission === AttackPermission.VENGEANCE_MODE) {
      existingDefender.vengeance = Math.max(0, vengeanceOwed(existingDefender, nowSeconds) - 1);
    }

    const todayStart = dayStart(now);

    if (existingDefender.attacksTodayDate < todayStart) {
      existingDefender.attacksTodayCount = 0;
      existingDefender.attacksTodayDate = todayStart;
    }

    existingDefender.attacksTodayCount++;

    if (existingDefender.attacksTodayCount >= 10) {
      attackerMaproom.neighbors = attackerMaproom.neighbors.filter(
        (neighbor) => neighbor.userid !== defender.userid
      );

      defenderMaproom.neighbors = defenderMaproom.neighbors.filter(
        (neighbor) => neighbor.userid !== attacker.userid
      );

      attackerMaproom.droppedNeighbours = noteDropped(attackerMaproom.droppedNeighbours, defender.userid, now);
      defenderMaproom.droppedNeighbours = noteDropped(defenderMaproom.droppedNeighbours, attacker.userid, now);
    }
  }

  postgres.em.persist(defenderMaproom);
  postgres.em.persist(attackerMaproom);
  await postgres.em.flush();
};
