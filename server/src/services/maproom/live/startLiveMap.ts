import { postgres, redis } from "../../../server.js";
import { logger } from "../../../utils/logger.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { onlinePlayers } from "../../user/online.js";
import { startLiveOnline } from "./liveOnline.js";
import { startLiveZones, type CellRow } from "./liveZones.js";

/**
 * Starts the live map's server side (beta 9, stage 1): the one-second zone
 * bundle every write marks into, and the online flag's check. Both only ever
 * read the database; their state is in Redis.
 */
export const startLiveMap = (): void => {
  startLiveZones({
    redis,
    query: (sql, params) => postgres.em.fork().execute<CellRow[]>(sql, params),
    warn: (message) => logger.warn(message),
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
