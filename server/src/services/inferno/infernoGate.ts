import type { Context } from "koa";
import type { User } from "../../database/models/user.model.js";
import { infernoConfig } from "../../config/InfernoConfig.js";
import { BaseMode, BaseType } from "../../enums/Base.js";
import { infernoClosedErr } from "../../errors/errors.js";
import { logger } from "../../utils/logger.js";

/** Every load mode of the Inferno family (`enums/Base.ts`). */
export const INFERNO_MODES: ReadonlySet<string> = new Set([
  BaseMode.IBUILD,
  BaseMode.IATTACK,
  BaseMode.IWMATTACK,
  BaseMode.IDESCENT,
  BaseMode.IVIEW,
  BaseMode.IHELP,
  BaseMode.IWMVIEW,
]);

/** The save rows only the Inferno writes: a player's Inferno yard and a Moloch tribe. */
export const INFERNO_SAVE_TYPES: ReadonlySet<string> = new Set([BaseType.INFERNO, BaseType.INFERNO_TRIBE]);

/**
 * Refuses an old Inferno route while they are closed (`config/InfernoConfig.ts`),
 * before anything is read or written, and logs it: the web client never calls
 * one, so the request is hand-made or from a stale Flash client.
 *
 * @param what - Which route or mode was asked for, for the log.
 * @param open - The switch; the config's own unless a test passes one.
 * @throws {ClientSafeError} `403` with `reason: "infernoClosed"` while closed.
 */
export const requireInfernoOpen = (
  ctx: Context,
  user: User,
  what: string,
  open: boolean = infernoConfig.legacyRoutesOpen
): void => {
  if (open) return;

  logger.warn("Old Inferno route refused for {username} (userid {userid}): {what}", {
    event: "inferno-closed",
    userid: user.userid,
    username: user.username,
    what,
    path: ctx.path,
    ip: ctx.ip,
  });

  throw infernoClosedErr();
};
