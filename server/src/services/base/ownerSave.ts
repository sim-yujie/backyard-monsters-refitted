import type { Context } from "koa";
import type { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import type { OwnerSaveMode } from "../../config/OwnerSaveConfig.js";
import { BaseType } from "../../enums/Base.js";
import { ownerSaveRetiredErr } from "../../errors/errors.js";
import { logger } from "../../utils/logger.js";

/**
 * The retired owner save (issue #101, `docs/design/yard-buildings.md` T1).
 *
 * An owner save of a main yard is the one save nothing legitimate sends any
 * more: the web client changes its yard through the action routes and only
 * ever posts `/base/save` for an attack (`web/src/api/base.ts`, `saveAttack`).
 * Attack saves are not the owner's, so they never match; outpost owner saves
 * are left as they are until outposts are designed (§3.3).
 *
 * Kept pure, like `checkAttackBinding`, so the rule is testable without a
 * database or a request.
 *
 * @param save - The stored row being saved: who owns it and what kind of yard it is.
 * @param callerid - The authenticated caller's `userid`.
 * @param mode - `OWNER_SAVE_MODE` (`config/OwnerSaveConfig.ts`).
 * @returns True when this save must be refused.
 */
export const isRetiredOwnerSave = (
  save: Pick<Save, "saveuserid" | "type">,
  callerid: number,
  mode: OwnerSaveMode
): boolean => mode === "refuse" && save.saveuserid === callerid && save.type === BaseType.MAIN;

/**
 * Refuses a retired owner save before anything is read or written, and logs
 * it: an owner main-yard save now comes from a hand-made request or a stale
 * client, and either is worth seeing.
 *
 * @throws {ClientSafeError} `409` with `reason: "ownerSaveRetired"` when {@link isRetiredOwnerSave}.
 */
export const requireOwnerSaveAllowed = (
  ctx: Context,
  user: User,
  save: Save,
  mode: OwnerSaveMode
): void => {
  if (!isRetiredOwnerSave(save, user.userid, mode)) return;

  logger.warn("Owner save refused for {username} (userid {userid}) on main base {baseid}", {
    event: "owner-save-refused",
    userid: user.userid,
    username: user.username,
    baseid: save.baseid,
    basesaveid: save.basesaveid,
    path: ctx.path,
    ip: ctx.ip,
  });

  throw ownerSaveRetiredErr();
};
