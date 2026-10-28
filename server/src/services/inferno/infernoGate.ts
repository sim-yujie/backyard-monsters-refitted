import type { Context } from "koa";
import type { User } from "../../database/models/user.model.js";
import { infernoConfig } from "../../config/InfernoConfig.js";
import { BaseMode, BaseType } from "../../enums/Base.js";
import { infernoClosedErr, infernoOffErr } from "../../errors/errors.js";
import { logger } from "../../utils/logger.js";

/** Every load mode of the Flash Inferno family (`enums/Base.ts`). */
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
 * Refuses what is left of the Flash Inferno on the shared routes, before
 * anything is read or written, and logs it: an Inferno mode on `/base/load` or
 * `/base/updatesaved`, an old-style `/base/save` of an Inferno row, and the
 * Inferno neighbour list. The Flash-only Inferno routes are gone (Inferno WP
 * 7.1); the new Inferno is `/bm/inferno/*`, so the web client never sends one
 * of these: the request is hand-made or from a stale Flash client.
 *
 * @param what - Which route or mode was asked for, for the log.
 * @throws {ClientSafeError} Always: `403` with `reason: "infernoClosed"`.
 */
export const refuseOldInferno = (ctx: Context, user: User, what: string): never => {
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

/**
 * Refuses a new Inferno route (`/bm/inferno/*`) while the new Inferno is
 * switched off (`infernoConfig.enabled`), before anything is read.
 *
 * @param enabled - The switch; the config's own unless a test passes one.
 * @throws {ClientSafeError} `403` with `reason: "infernoOff"` while off.
 */
export const requireInfernoEnabled = (enabled: boolean = infernoConfig.enabled): void => {
  if (!enabled) throw infernoOffErr();
};
