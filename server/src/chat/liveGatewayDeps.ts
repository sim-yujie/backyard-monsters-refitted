import { RequestContext } from "@mikro-orm/core";

import { Save } from "../database/models/save.model.js";
import { User } from "../database/models/user.model.js";
import { BaseType } from "../enums/Base.js";
import { sessionUser } from "../middleware/auth.js";
import { postgres, redis } from "../server.js";
import { readZoneVersions } from "../services/maproom/live/liveZones.js";
import { logger } from "../utils/logger.js";
import type { LiveGatewayDeps, LiveIdentity } from "./liveGateway.js";

/** The longest token read (a real one is ~0.2 KB; the frame before sign-in is capped at 512 bytes). */
const MAX_TOKEN_LENGTH = 500;

/**
 * The live map gateway's real reads (`liveGateway.ts`): the game session's
 * token checked as `verifyUserAuth` checks it, and the world taken from the
 * player's own main yard on the server, never from the client.
 */
export const liveGatewayDeps = (): LiveGatewayDeps => ({
  authenticate: (token) =>
    token.length > MAX_TOKEN_LENGTH
      ? Promise.resolve(null)
      : RequestContext.create(postgres.orm.em, async (): Promise<LiveIdentity | null> => {
          const signedIn = await sessionUser(token).catch(() => null);
          if (!signedIn) return null;
          const { user } = signedIn;
          const main = await postgres.em.findOne(Save, { userid: user.userid, type: BaseType.MAIN }, { fields: ["worldid"] });
          if (!main?.worldid) return null;
          return { userId: user.userid, allianceId: user.alliance_id ?? null, world: main.worldid };
        }),
  versions: (world, ids) => readZoneVersions(redis, world, ids),
  alliancesOf: async (userIds) => {
    const rows = await postgres.em.fork().find(User, { userid: { $in: [...userIds] } }, { fields: ["userid", "alliance_id"] });
    return new Map(rows.map((row) => [row.userid, row.alliance_id ?? null]));
  },
  warn: (message) => logger.warn(message),
});
