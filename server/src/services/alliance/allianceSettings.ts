import type { EntityManager, PostgreSqlDriver } from "@mikro-orm/postgresql";

import { AllianceMessageType, AllianceRole, AllianceType } from "../../enums/Alliance.js";
import { Alliance } from "../../database/models/alliance.model.js";
import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { announceShout } from "./allianceMessages.js";
import { lockAlliance, lockMembership } from "./membership.js";
import { AllianceAction, can } from "./permissions.js";
import { quoteTypeSwitch, typeSwitchOptions, type TypeSwitchQuote, type TypeSwitchState } from "./allianceTypes.js";
import { allianceTypeSwitchRefusedErr, permissionErr } from "../../errors/errors.js";
import { allianceFactor, allianceFactorOf, noteFactorChange } from "./productionHistory.js";

type Em = EntityManager<PostgreSqlDriver>;

/**
 * Reads what a type switch is worked out from: the alliance's points and last
 * switch, and its member and Officer counts. Inside a transaction that holds
 * the alliance lock, the counts cannot move under it.
 *
 * @param {Em} em - EntityManager to read through.
 * @param {number} allianceId - The alliance.
 * @returns {Promise<TypeSwitchState | null>} Null when the alliance is gone.
 */
const readSwitchState = async (em: Em, allianceId: number): Promise<TypeSwitchState | null> => {
  const [row] = await em.execute<
    { type: AllianceType; points: number; points_spent: number; type_changed_at: Date | null; members: string; officers: string }[]
  >(
    `SELECT a.type, a.points, a.points_spent, a.type_changed_at,
            (SELECT count(*) FROM bym."user" u WHERE u.alliance_id = a.id) AS members,
            (SELECT count(*) FROM bym."user" u WHERE u.alliance_id = a.id AND u.alliance_role = ?) AS officers
       FROM bym.alliance a
      WHERE a.id = ?`,
    [AllianceRole.OFFICER, allianceId]
  );

  if (!row) return null;

  return {
    type: row.type,
    points: Number(row.points),
    points_spent: Number(row.points_spent),
    type_changed_at: row.type_changed_at ? new Date(row.type_changed_at) : null,
    members: Number(row.members),
    officers: Number(row.officers),
  };
};

/**
 * What switching to each other type would do now, for the switch screen.
 *
 * @param {number} allianceId - The alliance.
 * @param {Date} now - The current time.
 * @returns {Promise<TypeSwitchQuote[]>} One quote per other type; empty when the alliance is gone.
 */
export const getTypeSwitchOptions = async (allianceId: number, now: Date): Promise<TypeSwitchQuote[]> => {
  const state = await readSwitchState(postgres.em, allianceId);

  return state ? typeSwitchOptions(state, now) : [];
};

/**
 * Switches an alliance's type (alliance audit Q1, answer C). Up is free and at
 * once; down waits and keeps a share of the points (`allianceTypes.ts`).
 * Stars reset either way, so the points come back unspent. Everything is
 * checked again under the alliance lock and the leader's, so a member joining
 * at the same moment cannot push the count past the new limit.
 *
 * @param {User} leader - The player asking; must lead the alliance.
 * @param {Alliance} alliance - The alliance.
 * @param {AllianceType} to - The type wanted.
 * @param {Date} now - The current time.
 * @returns {Promise<TypeSwitchQuote>} The switch as made.
 * @throws {ClientSafeError} When the player does not lead it, or the switch is refused.
 */
export const switchAllianceType = async (
  leader: User,
  alliance: Alliance,
  to: AllianceType,
  now: Date
): Promise<TypeSwitchQuote> => {
  const quote = await postgres.em.transactional(async (em) => {
    if (!(await lockAlliance(em, alliance.id))) throw permissionErr();

    const membership = await lockMembership(em, leader.userid);
    const may = membership?.alliance_id === alliance.id && can(membership.alliance_role, AllianceAction.SWITCH_TYPE);

    if (!may) throw permissionErr();

    const state = await readSwitchState(em, alliance.id);

    if (!state) throw permissionErr();

    const quote = quoteTypeSwitch(state, to, now);

    if (quote.refusal) throw allianceTypeSwitchRefusedErr(quote.refusal, quote.available_at);

    // Members' time before the switch stays at the old type's bonus (`productionHistory.ts`).
    const factorBefore = await allianceFactorOf(em, alliance.id);
    await noteFactorChange(em, { allianceId: alliance.id }, factorBefore, allianceFactor(to, {}), Math.floor(now.getTime() / 1000));

    await em.nativeUpdate(
      Alliance,
      { id: alliance.id },
      { type: to, type_changed_at: now, points: quote.points_after, points_spent: 0, stars: {} }
    );

    return quote;
  });

  alliance.type = to;
  alliance.type_changed_at = now;
  alliance.points = quote.points_after;
  alliance.points_spent = 0;
  alliance.stars = {};

  await announceShout({ allianceId: alliance.id, author: leader, type: AllianceMessageType.TYPE_CHANGED, body: to });

  return quote;
};
