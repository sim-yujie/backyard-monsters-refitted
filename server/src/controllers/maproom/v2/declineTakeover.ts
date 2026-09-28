import z from "zod";
import { LockMode } from "@mikro-orm/core";
import type { KoaController } from "../../../utils/KoaController.js";
import type { User } from "../../../database/models/user.model.js";
import { Save } from "../../../database/models/save.model.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { postgres } from "../../../server.js";
import { Status } from "../../../enums/StatusCodes.js";
import { MapRoomVersion } from "../../../enums/MapRoom.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { takeoverRefusedErr } from "../../../errors/errors.js";
import { holdsTakeoverGrant, OUTPOST_PROTECTION_SECONDS } from "../../../services/maproom/v2/takeoverGrant.js";
import { endTakeoverGrant, readTakeoverGrant } from "../../../services/maproom/v2/takeoverGrantStore.js";

const DeclineTakeoverSchema = z.object({
  /** The outpost whose takeover chance the attacker is turning down. */
  baseid: z.string(),
});

/**
 * `POST /worldmapv2/declinetakeover`: the attacker turns down their one chance
 * to take over the outpost they just destroyed (issue #182, `takeoverGrant.ts`).
 *
 * The grant ends and the outpost's damage protection starts now, for the
 * normal 8 hours, instead of when the grant would have run out. Only the
 * grant's holder may decline, and only while it runs; afterwards there is
 * nothing to decline, and the protection is already in place.
 *
 * @returns `{ error: 0, protectedUntil }`.
 */
export const declineTakeover: KoaController = async (ctx) => {
  const { baseid } = DeclineTakeoverSchema.parse(ctx.request.body);

  const currentUser: User = ctx.authUser;

  await postgres.em.populate(currentUser, ["save"]);

  const cell = await postgres.em.findOne(
    WorldMapCell,
    { baseid, world: currentUser.save?.worldid, map_version: MapRoomVersion.V2 },
    { populate: ["save"] }
  );

  if (!cell?.save) throw takeoverRefusedErr("notFound");

  const protectedUntil = await postgres.em.transactional(async (em) => {
    const outpost = await em.findOne(
      Save,
      { basesaveid: cell.save!.basesaveid },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }
    );

    if (!outpost) throw takeoverRefusedErr("notFound");

    const now = getCurrentDateTime();
    const grant = await readTakeoverGrant(outpost.basesaveid);

    if (!holdsTakeoverGrant(grant, currentUser.userid, now)) throw takeoverRefusedErr("noTakeoverChance");

    outpost.protected = now + OUTPOST_PROTECTION_SECONDS;
    em.persist(outpost);
    await em.flush();

    await endTakeoverGrant(outpost.basesaveid);

    return outpost.protected;
  });

  ctx.status = Status.OK;
  ctx.body = { error: 0, protectedUntil };
};
