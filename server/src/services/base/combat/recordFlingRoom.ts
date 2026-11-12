import type { Context } from "koa";
import type { CombatValidationMode } from "../../../config/CombatConfig.js";
import type { User } from "../../../database/models/user.model.js";
import { attackFlingOverRoomErr } from "../../../errors/errors.js";
import type { MonsterLevels } from "../../../game-rules/combat/index.js";
import { redis } from "../../../server.js";
import { logger } from "../../../utils/logger.js";
import { parseFlingLog } from "../attackCheckpoint.js";
import { logReport } from "../reportManager.js";
import { NORMAL_FLINGER_ROOM, championTakesRoom, flingsOverRoom, type FlingOverRoom } from "./flingRoom.js";
import { yardTag, type SavedBase } from "./saveBattle.js";

/**
 * The Flinger check of a normal attack (`flingRoom.ts`), under
 * `COMBAT_SAVE_VALIDATION` as the other attack checks are
 * (`config/CombatConfig.ts`):
 *
 * - `off`    — nothing.
 * - `log`    — one `attack-fling-over-room` warning and one `Report` row.
 * - `reject` — the same, then `attackFlingOverRoomErr`.
 *
 * Run on the save that ends an attack, before anything is applied, and on
 * every checkpoint before it is stored, so a refused fling is never in the
 * record the finaliser lands an abandoned attack from (`finaliseAttack.ts`):
 * the attack lands as it stood before the over-full fling, or not at all.
 *
 * The checkpoint is resent every few seconds and the save follows it, so the
 * `Report` row is written once per attack (`FLING_REPORT_SECONDS`), not once
 * per refusal; the warning goes in every time.
 */

/** What the check is run on, for the log line. */
export type FlingRoomStep = "save" | "checkpoint";

/** How long one attack's report row stands for the refusals after it: longer than any attack window. */
export const FLING_REPORT_SECONDS = 60 * 60;

/** The key that says an attack's over-full fling is already reported. */
export const flingReportKey = (userid: number, attackid: number): string => `fling-over-room:${userid}:${attackid}`;

/**
 * The report line, which the dashboard's Flagged list reads
 * (`admin/flaggedPlayers.ts`, `FLING`): "Attack save on base 201 rejected
 * (reject): fling over Flinger room, 2830 of 2250 in fling 1 [save 1200]".
 */
export const flingReportMessage = (
  base: SavedBase,
  over: readonly FlingOverRoom[],
  mode: CombatValidationMode,
  rejected: boolean
): string => {
  const worst = over.reduce((most, one) => (one.used > most.used ? one : most), over[0]!);
  const others = over.length > 1 ? ` (and ${over.length - 1} more)` : "";
  return (
    `Attack save on base ${base.baseid} ${rejected ? "rejected" : "flagged"} (${mode}): ` +
    `fling over Flinger room, ${worst.used} of ${worst.room} in fling ${worst.fling}${others}${yardTag(base)}`
  );
};

/** True the first time it is asked for this attack; true too when Redis cannot say, so a report is never lost. */
const firstReport = async (userid: number, attackid: number | undefined): Promise<boolean> => {
  if (attackid === undefined) return true;
  try {
    return (await redis.set(flingReportKey(userid, attackid), "1", "EX", String(FLING_REPORT_SECONDS), "NX")) === "OK";
  } catch {
    return true;
  }
};

/**
 * Checks every fling of an attack against the Flinger's room.
 *
 * @param ctx - The Koa context, for the caller's IP.
 * @param user - The attacker.
 * @param base - The yard attacked, for the log line and the report's yard tag.
 * @param flinglog - The log as sent; an unreadable one is the replay's business, not this check's.
 * @param levels - The academy levels the attack is fought at (the session's).
 * @param mode - The active `COMBAT_SAVE_VALIDATION` mode.
 * @param attackid - The attack, so its report row is written once.
 * @param step - Whether this is the final save or a checkpoint.
 * @throws {ClientSafeError} `attackFlingOverRoomErr` in `reject` mode, when a fling is over the room.
 */
export const requireFlingsInRoom = async (
  ctx: Context,
  user: User,
  base: SavedBase,
  flinglog: unknown,
  levels: MonsterLevels | undefined,
  mode: CombatValidationMode,
  attackid: number | undefined,
  step: FlingRoomStep
): Promise<void> => {
  if (mode === "off") return;
  const log = parseFlingLog(flinglog);
  if (!log) return;

  const over = flingsOverRoom(log, NORMAL_FLINGER_ROOM, levels);
  if (over.length === 0) {
    // An older page's log, let through on the older rule although its
    // champion rode on top of a full Flinger: logged, so it is plain when the
    // last of those pages is gone and the older rule can go.
    if (!championTakesRoom(log)) {
      const underNewRule = flingsOverRoom({ ...log, championRoom: 1 }, NORMAL_FLINGER_ROOM, levels);
      if (underNewRule.length > 0) {
        logger.info("Attack {step} for {username} on base {baseid} let through on the old Flinger rule", {
          event: "attack-fling-old-rule",
          step,
          userid: user.userid,
          username: user.username,
          baseid: base.baseid,
          basesaveid: base.basesaveid,
          rowless: base.rowless,
          flings: underNewRule,
        });
      }
    }
    return;
  }

  const rejected = mode === "reject";
  logger.warn("Attack {step} {outcome} for {username} on base {baseid}: a fling is over the Flinger's room", {
    event: "attack-fling-over-room",
    step,
    outcome: rejected ? "rejected" : "flagged",
    mode,
    userid: user.userid,
    username: user.username,
    baseid: base.baseid,
    basesaveid: base.basesaveid,
    rowless: base.rowless,
    championRoom: championTakesRoom(log),
    flings: over,
    ip: ctx.ip,
  });

  // The row can never be why a save fails: a database problem here is logged
  // and swallowed (as `saveBattle.ts` does).
  if (await firstReport(user.userid, attackid)) {
    try {
      await logReport(user, flingReportMessage(base, over, mode, rejected));
    } catch (err) {
      logger.error("Could not write the fling room report row for userid {userid}: {error}", {
        userid: user.userid,
        error: err,
      });
    }
  }

  if (rejected) throw attackFlingOverRoomErr(over);
};
