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

/**
 * The `baseid` a yard request names is not one of the caller's own Map Room 2
 * outposts: another player's yard, a wild camp, a yard in another world, or
 * none at all. A 403: no state of the caller's yard would make it allowed.
 */
export const notYourYardErr = () =>
  new ClientSafeError({
    message: "That yard is not one of your outposts.",
    status: Status.FORBIDDEN,
    data: { reason: "notYourYard" },
    isClientFriendly: true,
  });

/**
 * The route does not work in an outpost (outposts WP3): Flash's own message
 * where it had one (`msg_recycleoutpostbuilding`,
 * `msg_stopconstructionoutpostbuilding`), else a plain one.
 */
export const notInOutpostErr = (message = "That cannot be done in an outpost.") =>
  yardRefusedErr("notInOutpost", message);

/**
 * `409 raidInProgress`: a wild monster raid is being fought on the yard (#226,
 * `services/raids/raidLock.ts`). The web yard shows this sentence as a notice
 * (#309, `YardStore`'s `onRaidInProgress`).
 */
export const yardRaidInProgressErr = () =>
  yardRefusedErr(
    "raidInProgress",
    "Wild monsters are raiding your yard right now. Try again when the raid is over."
  );

/** The yard is being attacked right now (`services/base/isAttackActive.ts`). */
export const yardUnderAttackErr = () =>
  yardRefusedErr(
    "underAttack",
    "Your yard is under attack right now. Try again when the attack is over."
  );
