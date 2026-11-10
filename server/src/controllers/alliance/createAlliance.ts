import { UniqueConstraintViolationException } from "@mikro-orm/core";

import { Status } from "../../enums/StatusCodes.js";
import { AllianceMessageType, AllianceRole } from "../../enums/Alliance.js";
import { Alliance } from "../../database/models/alliance.model.js";
import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { CreateAllianceSchema } from "../../schemas/AllianceSchemas.js";
import { addAllianceMember, lockMembership } from "../../services/alliance/membership.js";
import { getWorldMapVersion } from "../../services/maproom/knownWorlds.js";
import { assertMayJoin, assertRejoinAllowed, GATE_SAVE_FIELDS, lockGateSave } from "../../services/alliance/joinGate.js";
import { assertDescriptionAllowed, assertNameAllowed } from "../../services/alliance/textFilter.js";
import { adOf } from "../../services/alliance/allianceAd.js";
import {
  allianceNameTakenErr,
  allianceNoWorldErr,
  alreadyInAllianceErr,
  unknownWorldErr,
} from "../../errors/errors.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * Creates an alliance in the user's world, with them as leader. Rejects if they
 * are already in an alliance, have no world, the name is taken, or either the
 * name or description trips the profanity filter.
 *
 * @param {Context} ctx - Koa context.
 */
export const createAlliance: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  await postgres.em.populate(user, ["save"], { fields: GATE_SAVE_FIELDS.map((field) => `save.${field}` as const) });

  if (user.alliance_id) throw alreadyInAllianceErr();

  const worldid = user.save?.worldid;

  if (!worldid) throw allianceNoWorldErr();

  // Map Room 2 and a finished Observatory (owner, 10 Nov 2026).
  assertMayJoin(user.save);
  assertRejoinAllowed(user.alliance_left_at, new Date());

  const data = CreateAllianceSchema.parse(ctx.request.body);

  assertNameAllowed(data.alliance_name);
  assertDescriptionAllowed(data.alliance_desc);

  const mapVersion = await getWorldMapVersion(worldid);

  if (mapVersion === undefined) throw unknownWorldErr();

  const allianceData = {
    name: data.alliance_name,
    image: data.alliance_image,
    description: data.alliance_desc,
    leader_userid: user.userid,
    leader_name: user.username,
    world_id: worldid,
    map_version: mapVersion,
    type: data.alliance_type,
    // The marketplace ad (design v5 §7a); each left out keeps the column's default.
    ...(data.join_mode !== undefined ? { join_mode: data.join_mode } : {}),
    ...(data.language !== undefined ? { language: data.language } : {}),
    ...(data.time_zone !== undefined ? { time_zone: data.time_zone } : {}),
    ...(data.min_level !== undefined ? { min_level: data.min_level } : {}),
  };

  const alliance = await postgres.em.transactional(async (em) => {
      // The gate again, on the player's row and main save locked until the
      // alliance exists: leaving the world takes the same locks first, so a
      // founder can never end up leading an alliance in a world they just left.
      await lockMembership(em, user.userid);
      assertMayJoin(await lockGateSave(em, user.userid), { allianceWorld: worldid });

      const newAlliance = em.create(Alliance, allianceData);

      em.persist(newAlliance);
      await em.flush();

      await addAllianceMember(user, newAlliance, AllianceRole.LEADER, AllianceMessageType.CREATED, em);

      return newAlliance;
    }).catch((error) => {
      if (error instanceof UniqueConstraintViolationException) throw allianceNameTakenErr();
      throw error;
    });

  ctx.status = Status.OK;
  ctx.body = {
    error: 0,
    alliance: {
      alliance_id: alliance.id,
      name: alliance.name,
      image: alliance.image,
      description: alliance.description,
      leader: user.username,
      world_id: alliance.world_id,
      type: alliance.type,
      ...adOf(alliance),
    },
  };
};
