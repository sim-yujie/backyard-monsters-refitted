import type { EntityManager } from "@mikro-orm/postgresql";

import { ClientSafeError } from "../../middleware/clientSafeError.js";
import { AllianceJoinMode } from "../../enums/Alliance.js";
import { Status } from "../../enums/StatusCodes.js";
import { ALLIANCE_AD } from "../../config/AllianceConfig.js";
import type { Alliance } from "../../database/models/alliance.model.js";
import { calculateBaseLevel } from "../base/calculateBaseLevel.js";

/**
 * The marketplace ad (design v5 §7a): how players get in and who the alliance
 * is looking for. The Leader and Officers set it (`EDIT_AD`); the server, not
 * only the window, holds a player to it when they ask or join.
 *
 * - **Open:** the player joins at once.
 * - **Ask to join:** a request waits for the Leader or an Officer.
 * - **Invite only:** no asks; the Leader and Officers invite.
 *
 * The minimum level refuses an ask or a join from a lower player. An invite
 * skips it: the Leader or Officer chose that player.
 */

/** The ad as the marketplace and My Alliance send it. */
export interface AllianceAd {
  join_mode: AllianceJoinMode;
  language: string | null;
  time_zone: number | null;
  min_level: number;
}

/** The ad fields of `alliance`, with defaults for a row from before the ad existed. */
export const adOf = (alliance: Pick<Alliance, "join_mode" | "language" | "time_zone" | "min_level">): AllianceAd => ({
  join_mode: alliance.join_mode ?? AllianceJoinMode.ASK,
  language: alliance.language ?? null,
  time_zone: alliance.time_zone ?? null,
  min_level: alliance.min_level ?? ALLIANCE_AD.minLevel.min,
});

/** Why the ad refuses a player's ask or join, or null when it lets them in. */
export type AdRefusal = "inviteOnly" | "lowLevel";

/**
 * Whether a player of `level` may ask or join under this ad. The level floor
 * takes anyone (the gate has no level rule, owner 10 Nov 2026), so only a
 * minimum above it can refuse; an unknown level counts as the floor.
 */
export const adRefusal = (
  ad: Pick<AllianceAd, "join_mode" | "min_level">,
  level: number | null
): AdRefusal | null => {
  if (ad.join_mode === AllianceJoinMode.INVITE) return "inviteOnly";
  if (ad.min_level > ALLIANCE_AD.minLevel.min && (level ?? ALLIANCE_AD.minLevel.min) < ad.min_level) return "lowLevel";

  return null;
};

/** The refusal as an error: a 403 with `reason` (and `min_level`) for the window to pick its own words. */
export const adRefusalErr = (reason: AdRefusal, ad: Pick<AllianceAd, "min_level">) =>
  new ClientSafeError({
    message:
      reason === "inviteOnly"
        ? "That alliance takes members by invite only."
        : `That alliance takes players from level ${ad.min_level}.`,
    status: Status.FORBIDDEN,
    data: { reason, min_level: ad.min_level },
    isClientFriendly: true,
  });

/** Throws the ad's refusal for a player of `level`, if any. */
export const assertAdAllows = (ad: Pick<AllianceAd, "join_mode" | "min_level">, level: number | null): void => {
  const reason = adRefusal(ad, level);

  if (reason) throw adRefusalErr(reason, ad);
};

/**
 * The level of `userid`'s main yard, as the profile shows it
 * (`calculateBaseLevel`), or null for a player with no main yard.
 *
 * @param {EntityManager} em - The EntityManager to read through (a transaction's, under its locks).
 * @param {number} userid - The player asking or joining.
 */
export const joinerLevel = async (em: EntityManager, userid: number): Promise<number | null> => {
  const [row] = await em.execute<{ points: string | null; basevalue: string | null }[]>(
    `SELECT s.points, s.basevalue FROM bym."user" u JOIN bym.save s ON s.basesaveid = u.save_basesaveid WHERE u.userid = ?`,
    [userid]
  );

  return row ? calculateBaseLevel(row.points ?? "0", row.basevalue ?? "0") : null;
};
