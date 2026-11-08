import type { KoaController } from "../../utils/KoaController.js";
import { Status } from "../../enums/StatusCodes.js";
import { ClientTimingSchema } from "../../schemas/ClientTimingSchema.js";
import { logger } from "../../utils/logger.js";

/**
 * `POST /api/:apiVersion/clienttiming`: how long Map Room 2 took to open in a
 * real player's browser (owner, 7 Nov 2026: yes to logging real players' MR2
 * open timings). Signed in, at most a few a minute per account
 * (`clientTimingLimiter`); the web client sends at most two a page load
 * (`game/maproom/openMarks.ts`, sender connected in `app/mr2TimingReport.ts`).
 *
 * No table: each accepted record is ONE log line with the message
 * {@link MR2_OPEN_TIMING_LOG} and properties `userid`, `gameVersion` and
 * `record` (`schemas/ClientTimingSchema.ts` for its fields). In production the
 * line goes to the JSON log files, `server/logs/bymr-YYYY-MM-DD.jsonl` on the
 * VPS (`/opt/bymr/server/logs`), which the log retention already prunes
 * (`utils/logger.ts`). To read them:
 *
 *     grep '"mr2-open-timing"' logs/bymr-*.jsonl | jq -c '.properties | {userid, open: .record.open, total: .record.total, info: .record.info}'
 *
 * A body that is not exactly a record is answered 400 and logs nothing (not
 * even the usual invalid-request warning), so junk cannot fill the logs.
 */
export const MR2_OPEN_TIMING_LOG = "mr2-open-timing";

export const clientTiming: KoaController = async (ctx) => {
  const parsed = ClientTimingSchema.safeParse(ctx.request.body ?? {});
  if (!parsed.success) {
    ctx.status = Status.BAD_REQUEST;
    ctx.body = { error: "Invalid timing record.", reason: "invalidRequest" };
    return;
  }
  const { record, gameVersion } = parsed.data;
  logger.info(MR2_OPEN_TIMING_LOG, { userid: ctx.authUser.userid, gameVersion: gameVersion ?? "", record });
  ctx.status = Status.OK;
  ctx.body = { error: 0 };
};
