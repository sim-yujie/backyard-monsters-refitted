import type { KoaController } from "../../utils/KoaController.js";
import { Status } from "../../enums/StatusCodes.js";
import { User } from "../../database/models/user.model.js";
import { Maproom } from "../../database/models/maproom.model.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import { MR1_TRIBES } from "../../enums/Tribes.js";
import { mr1TribeRefusedErr } from "../../errors/errors.js";
import { postgres } from "../../server.js";
import { calculateBaseLevel } from "../../services/base/calculateBaseLevel.js";
import { createMR1Tribes } from "../../services/maproom/v1/createMR1Tribes.js";
import { currentMR1Tribes } from "../../services/maproom/v1/mr1TribeRules.js";
import { mapRoom1View } from "../../services/maproom/v1/mapRoom1View.js";
import {
  PRACTICE_CAMP_BASEID,
  PRACTICE_CAMP_NAME,
  practiceCampOpen,
} from "../../services/maproom/v1/practiceCamp.js";
import { readOnboarding } from "../../services/onboarding/state.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { extractTownHall } from "../../utils/extractTownHall.js";
import { overworldNeighbours } from "./getNeighbours.js";

/**
 * `GET /api/:apiVersion/bm/maproom1` — everything the web client's Map Room 1
 * screen shows, in one read (issue #132, `docs/server-api.md` "Map Room 1
 * read"): the player's four wild monster tribes with tier, level, damage and
 * respawn time, their neighbours as `bm/neighbours/get` lists them, and their
 * own protection.
 *
 * It does what Flash's Map Room 1 did on open, the build-mode base load with
 * `mapversion: 1` plus `bm/neighbours/get`: tribes whose ten minutes are up are
 * stood back up, the four current tribes are written into `wmstatus`, and the
 * neighbour list is re-searched when its cache has run out. Refused with
 * `notMapRoom1` once the player has moved to Map Room 2.
 *
 * While the guided start's practice camp is open for this player (issue #227),
 * the answer carries it as `practice`, with the guide's step.
 */
export const getMapRoom1: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  await postgres.em.populate(user, ["save"]);

  const save = user.save;

  if (!save || save.mapversion !== MapRoomVersion.V1) throw mr1TribeRefusedErr("notMapRoom1");

  save.level = calculateBaseLevel(save.points, save.basevalue);

  const statuses = await createMR1Tribes(save, MR1_TRIBES);
  const wmstatus = new Map(save.wmstatus.map((status) => [status[0], status]));
  statuses.forEach((status) => wmstatus.set(status[0], status));
  save.wmstatus = [...wmstatus.values()];

  postgres.em.persist(save);
  await postgres.em.flush();

  const maproom = await postgres.em.findOne(Maproom, { userid: user.userid });
  const neighbours = await overworldNeighbours(user, save);
  const townHall = extractTownHall(save.buildingdata ?? {});

  ctx.status = Status.OK;
  ctx.body = {
    error: 0,
    ...mapRoom1View({
      now: getCurrentDateTime(),
      level: save.level,
      protectedUntil: save.protected,
      slots: currentMR1Tribes(townHall?.l ?? 1, MR1_TRIBES),
      statuses,
      tribedata: maproom?.tribedata ?? [],
      neighbours,
      practice: practiceCampOpen(save)
        ? {
            baseid: PRACTICE_CAMP_BASEID,
            name: PRACTICE_CAMP_NAME,
            step: readOnboarding(save).guide.step ?? null,
          }
        : null,
    }),
  };
};
