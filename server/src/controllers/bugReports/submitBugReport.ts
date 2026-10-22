import type { Context } from "koa";
import type z from "zod";

import type { KoaController } from "../../utils/KoaController.js";
import type { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { Status } from "../../enums/StatusCodes.js";
import { BUG_REPORT_LIMITS } from "../../config/BugReportConfig.js";
import { botCheckFailedErr, bugReportCheckUnavailableErr, invalidBugReportErr } from "../../errors/errors.js";
import { BugReportSchema, GuestBugReportSchema, type BugReportBody } from "../../schemas/BugReportSchemas.js";
import { verifyTurnstileToken } from "../../services/auth/turnstile.js";
import { decodeBugReportImage } from "../../services/bugReports/bugReportImage.js";
import { hashIp, submitBugReport, type BugReportRow } from "../../services/bugReports/bugReports.js";
import { logger } from "../../utils/logger.js";

/**
 * The game's "Report a bug" form (`services/bugReports/bugReports.ts`).
 *
 * `submitBugReport` is the Account menu's, signed in: the report carries the
 * account's id and name, and a reply goes to the account's email.
 * `submitGuestBugReport` is the login screen's: the player types an email for
 * the reply, and when the server has a Turnstile secret key the token must
 * pass Cloudflare's check before anything is counted or saved.
 *
 * Both answer `{ id }` once the report is saved; the email follows without
 * the player waiting. Neither route goes through `logRequest`: the body
 * carries pictures.
 */

const THANKS = "Thanks! Your report has been sent.";

/** The checked body as a row, its pictures decoded. */
const reportRow = (
  body: BugReportBody,
  who: Pick<BugReportRow, "userid" | "username" | "contactEmail" | "ipHash">
): BugReportRow => ({
  ...who,
  message: body.message,
  gameVersion: body.gameVersion,
  screen: body.screen,
  device: body.device,
  userAgent: body.userAgent,
  screenSize: body.screenSize,
  errors: body.errors,
  screenshot: decodeBugReportImage(body.screenshot, BUG_REPORT_LIMITS.screenshotBytesMax, "screenshot"),
  picture: decodeBugReportImage(body.picture, BUG_REPORT_LIMITS.pictureBytesMax, "picture"),
});

/** The body, or a 400 naming the first field at fault. */
const parsed = <T>(result: z.ZodSafeParseResult<T>): T => {
  if (result.success) return result.data;
  const [issue] = result.error.issues;
  throw invalidBugReportErr(issue.message, String(issue.path[0] ?? ""));
};

const answer = (ctx: Context, id: number): void => {
  ctx.status = Status.OK;
  ctx.body = { error: 0, id, message: THANKS };
};

export const submitBugReportController: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const body = parsed(BugReportSchema.safeParse(ctx.request.body ?? {}));
  const row = reportRow(body, { userid: user.userid, username: user.username, contactEmail: null, ipHash: null });

  const { id } = await submitBugReport(postgres.em.fork(), row, user.email || null);
  logger.info(`BugReport: report ${id} saved from user ${user.userid}`);
  answer(ctx, id);
};

export const submitGuestBugReportController: KoaController = async (ctx) => {
  const body = parsed(GuestBugReportSchema.safeParse(ctx.request.body ?? {}));

  const botCheck = await verifyTurnstileToken(body.turnstileToken, ctx.ip);
  if (botCheck === "failed") throw botCheckFailedErr();
  if (botCheck === "unavailable") throw bugReportCheckUnavailableErr();

  const row = reportRow(body, { userid: null, username: null, contactEmail: body.email, ipHash: hashIp(ctx.ip) });

  const { id } = await submitBugReport(postgres.em.fork(), row, body.email);
  logger.info(`BugReport: report ${id} saved from a signed-out player`);
  answer(ctx, id);
};
