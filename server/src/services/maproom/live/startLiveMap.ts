import { postgres, redis } from "../../../server.js";
import { logger } from "../../../utils/logger.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { onlinePlayers } from "../../user/online.js";
import { startLiveOnline } from "./liveOnline.js";
import { startLiveZones, type CellRow } from "./liveZones.js";
import { buildOwnerCells, buildPublicCells, defendersOf } from "./liveCells.js";

/**
 * Starts the live map's server side (beta 9, stages 1-2): the half-second zone
 * bundle every write marks into, and the online flag's check. Both only ever
 * read the database; their state is in Redis.
 */
export const startLiveMap = (): void => {
  startLiveZones({
    redis,
    query: (sql, params) => postgres.em.fork().execute<CellRow[]>(sql, params),
    warn: (message) => logger.warn(message),
    // Stage 2: each push carries its changed cells, built once here for every watcher.
    cells: { publicCells: buildPublicCells, ownerCells: buildOwnerCells, defendersOf },
  });
  if (process.env.LIVE_MAP_ONLINE !== "off") {
    startLiveOnline({
      redis,
      online: (userids, now) => onlinePlayers(userids, now),
      now: getCurrentDateTime,
      warn: (message) => logger.warn(message),
    });
  }
};
