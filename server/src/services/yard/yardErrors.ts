import { Status } from "../../enums/StatusCodes.js";
import { ClientSafeError } from "../../middleware/clientSafeError.js";

/**
 * Errors the yard action routes answer with (`docs/design/yard-buildings.md`
 * §2.1 "Errors").
 *
 * `runYardAction` (`controllers/yard/yardAction.ts`) flattens a
 * `ClientSafeError` into `{ error: message, ...data }` with the error's real
 * HTTP status, the shape the planner routes already use
 * (`controllers/yardplanner/layoutRoute.ts`). Every yard error puts a `reason`
 * key in `data` so the client can branch on it without parsing the message.
 *
 * Kept beside the yard services rather than in `errors/errors.ts` so the
 * work packages adding routes in parallel each add their reasons here without
 * all appending to the same shared file.
 */

/**
 * The yard refuses the action right now: `busy`, `damaged`, `shortfall`,
 * `workers`, `shinyLocked`, … (`reason`), with the figures behind it in
 * `detail`. A 409: the request was well formed, the yard's state says no.
 */
export const yardRefusedErr = (reason: string, message: string, detail: object = {}) =>
  new ClientSafeError({
    message,
    status: Status.CONFLICT,
    data: { reason, ...detail },
    isClientFriendly: true,
  });

/**
 * The client sent something malformed: a bad id, a bad type, a count of 0.
 * A 400 with `reason` `badRequest` unless a route names a sharper one.
 */
export const yardBadRequestErr = (message: string, detail: object = {}, reason = "badRequest") =>
  new ClientSafeError({
    message,
    status: Status.BAD_REQUEST,
    data: { reason, ...detail },
    isClientFriendly: true,
  });

/** The caller has no main yard to act on (no save yet, or the save is not their main yard). */
export const notMainYardErr = () =>
  yardRefusedErr("notMainYard", "Yard actions work on your own main yard only. Reload your yard.");

/** The yard is being attacked right now (`services/base/isAttackActive.ts`). */
export const yardUnderAttackErr = () =>
  yardRefusedErr(
    "underAttack",
    "Your yard is under attack right now. Try again when the attack is over."
  );
