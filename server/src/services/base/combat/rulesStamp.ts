import type { Context } from "koa";
import type { User } from "../../../database/models/user.model.js";
import { newVersionErr } from "../../../errors/errors.js";
import { COMPATIBLE_RULES_VERSIONS } from "../../../game-rules/combat/rulesCompat.js";
import { logger } from "../../../utils/logger.js";
import { RULES_VERSION } from "../../defences/rulesVersion.js";
import { ATTACK_STATS_VERSION } from "../../../game-data/stats/attackStatsVersion.js";

/**
 * The battle-rules stamp a game page sends (owner's fix 1, Desk 8, 23 Nov
 * 2026). After 8.3 went live, pages still on 8.2 fought the old yard layout
 * while the server replayed the new one: every save was refused, the server's
 * own replay landed instead, and each refusal flagged the player as a cheat.
 *
 * Now the page sends its rules version (its copy of the combat MANIFEST's
 * `version`) as `rules` when it starts an attack and with the save:
 *
 * - At the start, a stamp these rules do not play (missing, older, or not in
 *   {@link COMPATIBLE_RULES_VERSIONS}) is refused with `newVersionErr`
 *   before anything is spent. The server decides, so a cached page cannot
 *   slip through; a page from before this fix sends none and is refused.
 * - The session an attack start mints records the server's rules
 *   (`newAttackSession`). A save whose battle disagrees with the replay is
 *   an old page's, landed as before but never flagged, when its session was
 *   minted under rules these no longer play (or before sessions carried any).
 *
 * The game version is not compared: a release that leaves the battle rules
 * alone leaves the version alone, and forces no reload. One string compare
 * per attack start, on a field the request already carries.
 *
 * This file is outside `game-rules/combat`, so it is not in the MANIFEST and
 * changing it changes no rules version.
 */

/** The request field the stamp travels in, on an attack start and on `/base/save`. */
export const RULES_FIELD = "rules";

/** Longest stamp kept for the log line: a version is 16 hex. */
const STAMP_LOG_LENGTH = 32;

/**
 * Whether battles stamped `stamp` play the same on the rules `ours`: the same
 * version, or one listed as compatible. Anything that is not a string (no
 * stamp at all) does not.
 */
export const stampPlays = (
  stamp: unknown,
  ours: string = RULES_VERSION,
  compatible: readonly string[] = COMPATIBLE_RULES_VERSIONS
): boolean => typeof stamp === "string" && (stamp === ours || compatible.includes(stamp));

/** The stamp as a log line shows it: cut short, or null when none was sent. */
export const stampForLog = (stamp: unknown): string | null =>
  typeof stamp === "string" ? stamp.slice(0, STAMP_LOG_LENGTH) : null;

/** The stamp a request body carries, if any. */
export const stampOf = (body: unknown): unknown =>
  typeof body === "object" && body !== null ? (body as Record<string, unknown>)[RULES_FIELD] : undefined;

/**
 * Refuses an attack start from a page whose battle rules are not the
 * server's. Call it first on every attack-start route, before anything is
 * read for the attack or written: the refusal costs the player nothing.
 *
 * @param route - Which start, for the log line ("base/load", "inferno:descent"...).
 * @throws {ClientSafeError} `newVersionErr` when the stamp does not play.
 */
export const requirePageRules = (
  ctx: Context,
  user: Pick<User, "userid" | "username">,
  stamp: unknown,
  route: string
): void => {
  if (stampPlays(stamp)) return;
  logger.info("Attack start refused for {username}: the page plays older battle rules ({sent})", {
    event: "attack-start-old-page",
    route,
    userid: user.userid,
    username: user.username,
    sent: stampForLog(stamp),
    ours: RULES_VERSION,
    ip: ctx.ip,
  });
  throw newVersionErr();
};

/**
 * Whether an attack whose save disagrees with the server's replay was started
 * on an old page: its session holds no rules (minted before stamps existed)
 * or rules these no longer play. Such a save is landed from the replay as
 * any refused save is, but it is no sign of tampering, so it is not flagged.
 * The save's own stamp is never trusted for this: dropping it from a save
 * must not hide a tampered one.
 *
 * @param sessionRules - The `rules` of the attack's session.
 */
export const startedOnOldPage = (
  sessionRules: string | undefined,
  ours: string = RULES_VERSION,
  compatible: readonly string[] = COMPATIBLE_RULES_VERSIONS
): boolean => !stampPlays(sessionRules, ours, compatible);

/**
 * The request field the attack-stats stamp travels in, beside `rules`, on an
 * attack start that carries `attackData` (beta 10, owner's pick B+).
 */
export const STATS_FIELD = "stats";

/** The attack-stats stamp a request body carries, if any. */
export const statsStampOf = (body: unknown): unknown =>
  typeof body === "object" && body !== null ? (body as Record<string, unknown>)[STATS_FIELD] : undefined;

/**
 * Refuses an attack start from a page whose attack-stat table is not the
 * server's (`game-data/stats/attackStatsVersion.ts`): the training, hatching
 * and feeding ladders are not in the battle rules, so a release that changes
 * only them leaves `rules` alone, and without this the page would reach the
 * stat check in `validateAttack`. Call it right after {@link requirePageRules}
 * on a start that carries `attackData`.
 *
 * A page from before this stamp sends none and is let through:
 * `validateAttack` still refuses its old stats with "New version", never a
 * ban (`pastAttackStats.ts`).
 *
 * @param route - Which start, for the log line.
 * @throws {ClientSafeError} `newVersionErr` when the stamp is another table's.
 */
export const requirePageStats = (
  ctx: Context,
  user: Pick<User, "userid" | "username">,
  stamp: unknown,
  route: string,
  ours: string = ATTACK_STATS_VERSION
): void => {
  if (stamp === undefined || stamp === null || stamp === "" || stamp === ours) return;
  logger.info("Attack start refused for {username}: the page holds older monster stats ({sent})", {
    event: "attack-start-old-page",
    reason: "stats-stamp",
    route,
    userid: user.userid,
    username: user.username,
    sent: stampForLog(stamp),
    ours,
    ip: ctx.ip,
  });
  throw newVersionErr();
};
