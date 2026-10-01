import { devConfig } from "../../config/GameConfig.js";
import { Status } from "../../enums/StatusCodes.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * What the sign-up form may offer (issue #217). `sandboxStart` is true when
 * the server has DEV_SANDBOX on (never in production), and the form then shows
 * the dev-only "Start with the test yard (dev)" box; `register` keeps the
 * choice only under the same condition.
 *
 * @param {Context} ctx - The Koa context object.
 */
export const signUpOptions: KoaController = async (ctx) => {
  ctx.status = Status.OK;
  ctx.body = { sandboxStart: devConfig.devSandbox };
};
