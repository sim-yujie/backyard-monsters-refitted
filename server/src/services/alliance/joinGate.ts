import type { EntityManager } from "@mikro-orm/core";
import type { EntityManager as SqlEm, PostgreSqlDriver } from "@mikro-orm/postgresql";

import { ClientSafeError } from "../../middleware/clientSafeError.js";
import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { Status } from "../../enums/StatusCodes.js";
import { OBSERVATORY, REJOIN_COOLDOWN_HOURS } from "../../config/AllianceConfig.js";
import { onMapRoom2 } from "../events/mr2Welcome.js";

/**
 * Who may be in an alliance at all (owner, 10 Nov 2026): a player on Map Room 2
 * with a finished Observatory, in the alliance's own world. No level rule and
 * no Town Hall rule. The same gate is asked when founding, asking to join,
 * being invited and accepting, so a player can never slip in by one door the
 * others close.
 */

/** Why the gate says no, in the order it asks. */
export type JoinRefusal = "noWorld" | "notMapRoom2" | "noObservatory" | "otherWorld" | "rejoinCooldown";

/** The slice of a main save the gate reads. */
export interface GateSave {
  worldid?: string | null;
  mr2upgraded?: boolean | null;
  mapversion?: number | null;
  buildingdata?: Record<string, { t?: unknown; cB?: unknown } | null | undefined> | null;
}

/** The save fields to load for {@link joinRefusal}. */
export const GATE_SAVE_FIELDS = ["worldid", "mr2upgraded", "mapversion", "buildingdata"] as const;

/**
 * Reads the gate's slice of `user`'s main save, fresh from the database, or
 * null when they have none.
 */
export const loadGateSave = async (em: EntityManager, user: User): Promise<GateSave | null> => {
  const basesaveid = user.save?.basesaveid;

  if (!basesaveid) return null;

  return em.findOne(Save, { basesaveid }, { fields: [...GATE_SAVE_FIELDS] });
};

/**
 * Locks `userid`'s main save row until the transaction ends and reads the
 * gate's slice of it from the database.
 *
 * A join asks the gate again under this lock, and leaving a world takes the
 * same lock before it decides about the alliance, so a player can never be
 * added to an alliance at the same moment they leave its world (security
 * review, 10 Nov 2026). Lock order: the alliance row, then the player row
 * (`lockMembership`), then this save, so two such transactions never deadlock.
 *
 * @param {EntityManager} em - The transaction's EntityManager.
 * @param {number} userid - The player whose main save to lock.
 * @returns {Promise<GateSave | null>} Null when the player has no main save.
 */
export const lockGateSave = async (em: SqlEm<PostgreSqlDriver>, userid: number): Promise<GateSave | null> => {
  const [row] = await em.execute<GateSave[]>(
    `SELECT s.worldid, s.mr2upgraded, s.mapversion, s.buildingdata
       FROM bym.save s
       JOIN bym."user" u ON u.save_basesaveid = s.basesaveid
      WHERE u.userid = ? AND s.type = 'main'
        FOR UPDATE OF s`,
    [userid]
  );

  return row ?? null;
};

/**
 * Whether the yard holds a finished Observatory: one of its type that is not
 * still being built (`cB` is the build job; an upgrade cannot happen, it has
 * one level).
 */
export const hasObservatory = (buildingdata: GateSave["buildingdata"]): boolean =>
  Object.values(buildingdata ?? {}).some(
    (building) => !!building && Number(building.t) === OBSERVATORY.type && !(Number(building.cB) > 0)
  );

/**
 * The first reason `save` may not be in an alliance, or null when it may.
 * `allianceWorld` is the world of the alliance being joined; leave it out
 * when founding (the new alliance takes the player's world).
 */
export const joinRefusal = (
  save: GateSave | null | undefined,
  opts: { allianceWorld?: string | null } = {}
): JoinRefusal | null => {
  if (!save?.worldid) return "noWorld";
  if (!onMapRoom2(save)) return "notMapRoom2";
  if (!hasObservatory(save.buildingdata)) return "noObservatory";
  if (opts.allianceWorld !== undefined && opts.allianceWorld !== save.worldid) return "otherWorld";

  return null;
};

const SELF_TEXT: Record<JoinRefusal, string> = {
  noWorld: "You must join a world before you can be in an alliance.",
  notMapRoom2: "Alliances are on Map Room 2. Upgrade your Map Room first.",
  noObservatory: "Build an Observatory first: it is your pass into an alliance.",
  otherWorld: "That alliance is in another world.",
  rejoinCooldown: `You left an alliance less than ${REJOIN_COOLDOWN_HOURS} hours ago. Wait a little before joining another.`,
};

const OTHER_TEXT: Record<JoinRefusal, (name: string) => string> = {
  noWorld: (name) => `${name} has not joined a world yet.`,
  notMapRoom2: (name) => `${name} is not on Map Room 2 yet.`,
  noObservatory: (name) => `${name} has no Observatory yet.`,
  otherWorld: (name) => `${name} is in another world.`,
  rejoinCooldown: (name) => `${name} left an alliance less than ${REJOIN_COOLDOWN_HOURS} hours ago.`,
};

/**
 * The refusal as an error: a 403 with `reason` for the web to pick its own
 * wording. `who` is the other player's name when it is about someone else
 * (an invite, or a leader accepting a request).
 */
export const allianceJoinGateErr = (reason: JoinRefusal, who?: string, detail: object = {}) =>
  new ClientSafeError({
    message: who === undefined ? SELF_TEXT[reason] : OTHER_TEXT[reason](who),
    status: Status.FORBIDDEN,
    data: { reason, ...detail },
    isClientFriendly: true,
  });

/** Throws the gate's refusal for `save`, if any. */
export const assertMayJoin = (
  save: GateSave | null | undefined,
  opts: { allianceWorld?: string | null; who?: string } = {}
): void => {
  const reason = joinRefusal(save, opts);

  if (reason) throw allianceJoinGateErr(reason, opts.who);
};

/**
 * When a player who last left (or was kicked from) an alliance at `leftAt`
 * may be in one again, or null when they already may.
 */
export const rejoinAvailableAt = (leftAt: Date | string | null | undefined, now: Date): Date | null => {
  if (!leftAt) return null;

  const at = new Date(new Date(leftAt).getTime() + REJOIN_COOLDOWN_HOURS * 3600_000);

  return at > now ? at : null;
};

/**
 * Throws the 24-hour re-join refusal (owner, 10 Nov 2026), with `available_at`
 * in Unix seconds, if `leftAt` is too recent.
 */
export const assertRejoinAllowed = (
  leftAt: Date | string | null | undefined,
  now: Date,
  who?: string
): void => {
  const at = rejoinAvailableAt(leftAt, now);

  if (at) throw allianceJoinGateErr("rejoinCooldown", who, { available_at: Math.floor(at.getTime() / 1000) });
};
