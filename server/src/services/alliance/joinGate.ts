import type { EntityManager } from "@mikro-orm/core";

import { ClientSafeError } from "../../middleware/clientSafeError.js";
import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { Status } from "../../enums/StatusCodes.js";
import { OBSERVATORY } from "../../config/AllianceConfig.js";
import { onMapRoom2 } from "../events/mr2Welcome.js";

/**
 * Who may be in an alliance at all (owner, 10 Nov 2026): a player on Map Room 2
 * with a finished Observatory, in the alliance's own world. No level rule and
 * no Town Hall rule. The same gate is asked when founding, asking to join,
 * being invited and accepting, so a player can never slip in by one door the
 * others close.
 */

/** Why the gate says no, in the order it asks. */
export type JoinRefusal = "noWorld" | "notMapRoom2" | "noObservatory" | "otherWorld";

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
};

const OTHER_TEXT: Record<JoinRefusal, (name: string) => string> = {
  noWorld: (name) => `${name} has not joined a world yet.`,
  notMapRoom2: (name) => `${name} is not on Map Room 2 yet.`,
  noObservatory: (name) => `${name} has no Observatory yet.`,
  otherWorld: (name) => `${name} is in another world.`,
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
