import { RequestContext } from "@mikro-orm/core";

import { Save } from "../database/models/save.model.js";
import { User } from "../database/models/user.model.js";
import { BaseType } from "../enums/Base.js";
import { sessionUser } from "../middleware/auth.js";
import { postgres, redis } from "../server.js";
import { LIVE_LOG_KEY, LIVE_PRESENT_KEY, PRESENT_MS, readZoneVersions, type CellsMessage } from "../services/maproom/live/liveZones.js";
import { getPlayerSight } from "../services/maproom/sight/sightService.js";
import { devConfig } from "../config/GameConfig.js";
import { mr2HexShape } from "../config/MapRoom2Config.js";
import { logger } from "../utils/logger.js";
import type { LiveGatewayDeps, LiveIdentity, LogRead } from "./liveGateway.js";

/** The most log entries one replay reads; more means the map was away too long (the version check catches up). */
export const REPLAY_MAX_ENTRIES = 2_000;

/** `a` before `b` as Redis stream ids (`<ms>-<seq>`)? */
export const logIdBefore = (a: string, b: string): boolean => {
  const [am = 0, as = 0] = a.split("-").map(Number);
  const [bm = 0, bs = 0] = b.split("-").map(Number);
  return am < bm || (am === bm && as < bs);
};

type StreamEntry = [string, string[]];

/** The pushes logged after `since`, and whether the log still reaches back that far. */
export const readLiveLog = async (send: (command: string, args: string[]) => Promise<unknown>, since: string): Promise<LogRead> => {
  const [oldest] = ((await send("XRANGE", [LIVE_LOG_KEY, "-", "+", "COUNT", "1"])) ?? []) as StreamEntry[];
  // Something after `since` may have been trimmed away: no replay, the versions catch up.
  if (oldest && logIdBefore(since, oldest[0])) return { entries: [], complete: false };
  const raw = ((await send("XRANGE", [LIVE_LOG_KEY, `(${since}`, "+", "COUNT", String(REPLAY_MAX_ENTRIES)])) ?? []) as StreamEntry[];
  const entries: CellsMessage[] = [];
  for (const [id, fields] of raw) {
    const text = fields[fields.indexOf("d") + 1];
    if (!text) continue;
    try {
      entries.push({ ...(JSON.parse(text) as CellsMessage), id });
    } catch {
      return { entries: [], complete: false };
    }
  }
  return { entries, complete: raw.length < REPLAY_MAX_ENTRIES };
};

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
  // The fog exactly as `getarea` reads it (stage 2): the gateway cuts every push to it.
  sight: (userId) =>
    RequestContext.create(postgres.orm.em, async () => {
      if (devConfig.disableFogOfWar) return null;
      const user = await postgres.em.findOne(User, { userid: userId });
      if (!user) return { sv: "", sources: [], revealed: [] };
      const { sv, sources, revealed } = await getPlayerSight(user, { waitForRebuild: true });
      return { sv, sources, revealed };
    }),
  shape: () => mr2HexShape(),
  readLog: (since) => readLiveLog((command, args) => redis.send(command, args), since),
  // Who has a map open, for the owner's own channel (`liveZones.ts`); stale names drop off by age.
  present: async (userIds, at) => {
    await redis.send("ZADD", [LIVE_PRESENT_KEY, ...userIds.flatMap((id) => [String(at), String(id)])]);
    await redis.send("ZREMRANGEBYSCORE", [LIVE_PRESENT_KEY, "-inf", String(at - PRESENT_MS)]);
  },
  warn: (message) => logger.warn(message),
});
