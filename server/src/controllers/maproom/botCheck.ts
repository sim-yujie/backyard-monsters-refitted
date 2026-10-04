import z from "zod";

import type { KoaController } from "../../utils/KoaController.js";
import type { User } from "../../database/models/user.model.js";
import { Status } from "../../enums/StatusCodes.js";
import { Env } from "../../enums/Env.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { answerCheck, type CheckState, raiseCheck, readCheck } from "../../services/user/botChallenge.js";

/**
 * The in-game check's routes (#273, `services/user/botChallenge.ts`).
 *
 * Each answers `{ error: 0, now, checkPending }` and, while a check waits,
 * either `challenge` (`{ id, prompt, options: [{ id, monster }] }`) or
 * `cooldownUntil` (unix seconds) after too many wrong answers.
 */

const answerBody = (state: CheckState, now: number) => ({
  error: 0,
  now,
  checkPending: state.pending,
  ...("challenge" in state && { challenge: state.challenge }),
  ...("cooldownUntil" in state && { cooldownUntil: state.cooldownUntil }),
});

/**
 * `POST /api/:apiVersion/bm/presence/check`: the check waiting for the
 * player, made now if there is none yet. Not a real game action.
 */
export const botCheck: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const now = getCurrentDateTime();
  ctx.status = Status.OK;
  ctx.body = answerBody(await readCheck(user.userid, now), now);
};

const AnswerSchema = z.object({
  /** The check's id. */
  challenge: z.string().min(1).max(64),
  /** The option tapped. */
  option: z.string().min(1).max(64),
});

/**
 * `POST /api/:apiVersion/bm/presence/check/answer`: a tap on one portrait.
 * Right, it clears the check and answers `solved: true`, which makes it a real
 * game action (`realActions.ts`); wrong, it answers the next check, or the
 * wait.
 */
export const botCheckAnswer: KoaController = async (ctx) => {
  const { challenge, option } = AnswerSchema.parse(ctx.request.body);
  const user: User = ctx.authUser;
  const now = getCurrentDateTime();
  const { solved, state } = await answerCheck(user.userid, challenge, option, now);
  ctx.status = Status.OK;
  ctx.body = { ...answerBody(state, now), solved };
};

/** Whether the DEV-only trigger is there: a local server only (`ENV=local`), never production. */
export const devCheckEnabled = (env: string | undefined = process.env.ENV): boolean => env === Env.LOCAL;

/**
 * `POST /api/:apiVersion/bm/presence/check/dev`, DEV only: asks the caller
 * for a check now, as a pattern would, for testing. `app.routes.ts` mounts it
 * only on a local server, and it refuses anywhere else as well.
 */
export const botCheckForce: KoaController = async (ctx) => {
  if (!devCheckEnabled()) {
    ctx.status = Status.NOT_FOUND;
    return;
  }
  const user: User = ctx.authUser;
  const now = getCurrentDateTime();
  await raiseCheck(user.userid, { rule: "dev", detail: "forced from a local server's DEV trigger" }, now);
  ctx.status = Status.OK;
  ctx.body = answerBody(await readCheck(user.userid, now), now);
};
