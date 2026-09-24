import { Status } from "../enums/StatusCodes.js";
import { ClientSafeError } from "../middleware/clientSafeError.js";
import type { EconomyViolation } from "../services/base/economy/auditEconomySave.js";

/**
 * Creates a new instance of `ClientSafeError` with the specified properties.
 *
 * @returns A new `ClientSafeError` instance.
 */
export const authFailureErr = () =>
  new ClientSafeError({
    message: "Could not authenticate",
    status: Status.UNAUTHORIZED,
    data: {},
    isClientFriendly: true,
  });

export const tokenAuthFailureErr = () =>
  new ClientSafeError({
    message: "Could not authenticate with user token",
    status: Status.UNAUTHORIZED,
    data: {},
    isClientFriendly: true,
  });

export const emailPasswordErr = () =>
  new ClientSafeError({
    message:
      "Your login credentials are incorrect. Please check and try again. If you forgot your password, you can reset it by clicking on forgot password.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: true,
  });

export const usernameUniqueErr = () =>
  new ClientSafeError({
    message: "An account with this username already exists.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: true,
  });

export const emailUniqueErr = () =>
  new ClientSafeError({
    message: "An account with this email address already exists.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: true,
  });

export const usernameCooldownErr = (nextChangeAt: Date) =>
  new ClientSafeError({
    message: `You can only change your username once every 6 months. You can change it again on ${nextChangeAt.toUTCString()}.`,
    status: Status.CONFLICT,
    data: { nextChangeAt: nextChangeAt.toISOString() },
    isClientFriendly: true,
  });

export const debugClientErr = () =>
  new ClientSafeError({
    message: "Sorry, it appears this cannot be found.",
    status: Status.NOT_FOUND,
    data: {},
    isClientFriendly: true,
  });

export const saveFailureErr = () =>
  new ClientSafeError({
    message: "We encountered an error while saving",
    status: Status.INTERNAL_SERVER_ERROR,
    data: {},
    isClientFriendly: true,
  });

export const loadFailureErr = () =>
  new ClientSafeError({
    message: "We could not load the requested data",
    status: Status.NOT_FOUND,
    data: {},
    isClientFriendly: true,
  });

export const userPermaBannedErr = () =>
  new ClientSafeError({
    message:
      "Your account has been permanently banned. If you believe this is an error, please contact support.",
    status: Status.FORBIDDEN,
    data: {},
    isClientFriendly: true
  });

export const antiCheatBanErr = () =>
  new ClientSafeError({
    message:
      "Hey bud, it seems you got caught by a very basic anti-cheat, you're not that guy pal, enjoy the ban.",
    status: Status.FORBIDDEN,
    data: {},
    isClientFriendly: true
  });

export const discordVerifyErr = () =>
  new ClientSafeError({
    message:
      "In order to continue, you must verify your account on our Discord server, in the #claim-account channel.",
    status: Status.UNAUTHORIZED,
    data: {},
    isClientFriendly: true
  });

export const discordAgeErr = () =>
  new ClientSafeError({
    message:
      "Your discord account must be at least 1 week old in order to access this feature.",
    status: Status.UNAUTHORIZED,
    data: {},
    isClientFriendly: true
  });

export const permissionErr = () =>
  new ClientSafeError({
    message: "You do not have permission to complete this operation.",
    status: Status.FORBIDDEN,
    data: {},
    isClientFriendly: true,
  });

export const mailboxErr = () =>
  new ClientSafeError({
    message: "Mailbox failed with an error.",
    status: Status.NOT_FOUND,
    data: {},
    isClientFriendly: true,
  });

export const relocateOutpostErr = () =>
  new ClientSafeError({
    message:
      "You cannot relocate while owning outposts in this world.",
    status: Status.FORBIDDEN,
    data: {},
    isClientFriendly: true,
  });

export const baseUnderAttackErr = () =>
  new ClientSafeError({
    message: "This base is currently under attack by another player. Please try again later.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: false,
  });

export const baseProtectedErr = () =>
  new ClientSafeError({
    message: "This base is currently under damage protection and cannot be attacked.",
    status: Status.FORBIDDEN,
    data: {},
    isClientFriendly: false,
  });

export const userOnlineErr = () =>
  new ClientSafeError({
    message: "This player is currently online and cannot be attacked. Please try again later.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: false,
  });

export const takeoverCellErr = () =>
  new ClientSafeError({
    message: "The server attempted to take over this cell but failed unexpectedly. Please try again.",
    status: Status.INTERNAL_SERVER_ERROR,
    data: {},
    isClientFriendly: false,
  });

export const mapRoomDisabledErr = () =>
  new ClientSafeError({
    message: "Map Room is not enabled on this server",
    status: Status.NOT_FOUND,
    data: {},
    isClientFriendly: false,
  });

export const townHallLevelErr = () =>
  new ClientSafeError({
    message: "Town Hall level 6 required to upgrade Map Room.",
    status: Status.FORBIDDEN,
    data: {},
    isClientFriendly: true,
  });

export const truceActiveErr = () =>
  new ClientSafeError({
    message: "You have an active truce with this player and cannot attack them.",
    status: Status.FORBIDDEN,
    data: {},
    isClientFriendly: false,
  });

export const shinyLockedErr = () =>
  new ClientSafeError({
    message: "Shiny is turned off on your account, so it cannot be spent. You can turn it back on from your account page in the launcher.",
    status: Status.FORBIDDEN,
    data: {},
    isClientFriendly: true,
  });

export const alreadyInAllianceErr = () =>
  new ClientSafeError({
    message: "You are already a member of an alliance.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: true,
  });

export const allianceNameTakenErr = () =>
  new ClientSafeError({
    message: "The alliance name is already taken.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: true,
  });

export const allianceNameTooShortErr = () =>
  new ClientSafeError({
    message: "The alliance name is too short.",
    status: Status.BAD_REQUEST,
    data: {},
    isClientFriendly: true,
  });

export const allianceNameTooLongErr = () =>
  new ClientSafeError({
    message: "The alliance name is too long.",
    status: Status.BAD_REQUEST,
    data: {},
    isClientFriendly: true,
  });

export const allianceNameBannedErr = () =>
  new ClientSafeError({
    message: "The alliance name is not allowed.",
    status: Status.BAD_REQUEST,
    data: {},
    isClientFriendly: true,
  });

export const allianceDescriptionBannedErr = () =>
  new ClientSafeError({
    message: "The alliance description is not allowed.",
    status: Status.BAD_REQUEST,
    data: {},
    isClientFriendly: true,
  });

export const allianceNoWorldErr = () =>
  new ClientSafeError({
    message: "You must join a world before creating an alliance.",
    status: Status.FORBIDDEN,
    data: {},
    isClientFriendly: true,
  });

/**
 * The player's world id resolves to no known world - a deleted world, or a cached
 * world list that has gone stale. Distinct from allianceNoWorldErr, which is the
 * ordinary case of a player who has not joined a world at all.
 */
export const unknownWorldErr = () =>
  new ClientSafeError({
    message: "Your world could not be found. Please try again later.",
    status: Status.INTERNAL_SERVER_ERROR,
    data: {},
    isClientFriendly: true,
  });

export const leaderMustTransferErr = (allianceName: string) =>
  new ClientSafeError({
    message: `Since you're the fearless leader of the ${allianceName} Alliance, you need to elect someone to succeed you before you go.  Go to the Members Tab and promote a current member to leader before you depart.`,
    status: Status.FORBIDDEN,
    data: {},
    isClientFriendly: true,
  });


export const requestPendingErr = () =>
  new ClientSafeError({
    message: "You already have a request pending.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: true,
  });

export const invitePendingErr = () =>
  new ClientSafeError({
    message: "They already have an invite pending.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: true,
  });

export const userAlreadyInAllianceErr = () =>
  new ClientSafeError({
    message: "User is already in an alliance.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: true,
  });

export const inviteLeaderOnlyErr = () =>
  new ClientSafeError({
    message: "Only the leader of the alliance can invite new members. Ask them to send the invitation for you.",
    status: Status.FORBIDDEN,
    data: {},
    isClientFriendly: true,
  });

export const mustLeaveAllianceErr = () =>
  new ClientSafeError({
    message: "You must leave your alliance to join another.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: true,
  });

export const mustLeaveAllianceToChangeWorldErr = () =>
  new ClientSafeError({
    message: "You must leave your alliance before you can change worlds.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: true,
  });

export const mustLeaveAllianceToAcceptErr = () =>
  new ClientSafeError({
    message: "You must leave your current alliance before accepting the invite.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: true,
  });

export const inviteNotPendingErr = () =>
  new ClientSafeError({
    message: "Invite has already been resolved.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: true,
  });

export const allianceFullErr = () =>
  new ClientSafeError({
    message: "The alliance is already full.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: true,
  });

export const cannotKickErr = () =>
  new ClientSafeError({
    message: "You cannot kick members.",
    status: Status.FORBIDDEN,
    data: {},
    isClientFriendly: true,
  });

export const cannotChangeRelationshipErr = () =>
  new ClientSafeError({
    message: "You cannot change relationship statuses.",
    status: Status.FORBIDDEN,
    data: {},
    isClientFriendly: true,
  });

export const cannotPromoteErr = () =>
  new ClientSafeError({
    message: "You cannot promote members.",
    status: Status.FORBIDDEN,
    data: {},
    isClientFriendly: true,
  });

export const joinMapVersionErr = () =>
  new ClientSafeError({
    message: "That Alliance is on a different Map Room version.",
    status: Status.FORBIDDEN,
    data: {},
    isClientFriendly: true,
  });

export const inviteMapVersionErr = (username: string) =>
  new ClientSafeError({
    message: `${username} is too far away to join your Alliance. They are on a different Map Room version.`,
    status: Status.FORBIDDEN,
    data: {},
    isClientFriendly: true,
  });

export const powerupUnknownErr = () =>
  new ClientSafeError({
    message: "This Power-Up cannot be activated at this time.",
    status: Status.BAD_REQUEST,
    data: {},
    isClientFriendly: true,
  });

export const powerupRunningErr = () =>
  new ClientSafeError({
    message: "This Power-Up is already active.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: true,
  });

export const powerupNotReadyErr = () =>
  new ClientSafeError({
    message: "This Power-Up is not ready to activate.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: true,
  });

export const powerupReadyErr = () =>
  new ClientSafeError({
    message: "This Power-Up is currently ready.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: true,
  });

export const notEnoughShinyErr = () =>
  new ClientSafeError({
    message: "You do not have enough Shiny for that.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: true,
  });

export const notEnoughResourcesErr = () =>
  new ClientSafeError({
    message: "You do not have enough resources for that.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: true,
  });

export const powerupLeaderOnlyErr = () =>
  new ClientSafeError({
    message: `Only the leader of the alliance can activate a Power-Up.`,
    status: Status.FORBIDDEN,
    data: {},
    isClientFriendly: true,
  });

/**
 * A Yard Planner layout the server will not accept: a bad slot, a node it
 * cannot match to a building, a position outside the plot, or two footprints on
 * the same cells. The message is written to be shown to the player as-is, and
 * `data` carries whatever detail the client needs to point at the problem.
 */
export const layoutInvalidErr = (message: string, data: object = {}) =>
  new ClientSafeError({
    message,
    status: Status.BAD_REQUEST,
    data,
    isClientFriendly: true,
  });

/**
 * Apply was blocked because buildings are missing from the layout. Apply stays
 * hard-blocked while any non-decoration building is unplaced, and there is no
 * auto-place (`docs/design/yard-planner-redesign.md` §8, decision Q4), so the
 * ids come back for the client to list.
 */
export const layoutUnplacedErr = (ids: number[]) =>
  new ClientSafeError({
    message: `Every building has to be placed before you can apply this layout. ${ids.length} ${
      ids.length === 1 ? "building is" : "buildings are"
    } still unplaced.`,
    status: Status.CONFLICT,
    data: { unplaced: ids },
    isClientFriendly: true,
  });

/**
 * A Yard Planner batch action the yard's own state will not allow: not enough
 * resources, a prerequisite the yard does not meet, or a trap cap already
 * reached.
 *
 * Separate from {@link layoutInvalidErr} because the request is well formed and
 * nothing about it is the client's fault — the player simply cannot afford or
 * unlock the action yet, which is a `409`, the same reading `layoutUnplacedErr`
 * takes. `data` carries `shortfall`, `townHall`, `requirements` or `capReached`
 * so the panel can say which (`docs/server-api.md`, the Yard Planner table).
 */
export const batchBlockedErr = (message: string, data: object = {}) =>
  new ClientSafeError({
    message,
    status: Status.CONFLICT,
    data,
    isClientFriendly: true,
  });

/**
 * An owner save the economy audit refused in `reject` mode
 * (`docs/design/economy-save-validation.md` §3.5).
 *
 * `isClientFriendly: false` is deliberate, and the one thing about this error
 * that is not obvious. The interceptor answers a non-friendly error with HTTP
 * **200** and `error` set (`middleware/clientSafeError.ts:90-93`), which is the
 * only failure shape the archived Flash client turns into a message the player
 * can read (`handleLoadSuccessful`, `client/scripts/BASE.as:3413-3416`). A real
 * `409` would instead reach its `handleLoadError` path: five silent retries and
 * a generic "BASE.Save HTTP" popup. The intended status still travels in
 * `errorDetails.status`, which is where the web client reads it from
 * (`web/src/api/http.ts:19-22`).
 *
 * `violations` are the *enforced* ones — the rules that actually refused this
 * save. Anything recorded but not enforced (the `r3`/`r4` budgets, fortify, the
 * two derived-field mismatches) stays in the log and the `Report` row, where it
 * belongs, rather than in a message telling the player to reload over something
 * the server did not mind.
 */
export const economySaveRejectedErr = (violations: EconomyViolation[], elapsed: number) =>
  new ClientSafeError({
    message:
      `This save does not add up (${violations.map((violation) => violation.rule).join(", ")}). ` +
      "Reload your yard.",
    status: Status.CONFLICT,
    data: { violations, elapsed },
    isClientFriendly: false,
  });

/**
 * An attack save whose sender is not the player the server recorded as this
 * attack's attacker, or whose attack has run out (issue #25,
 * `services/base/attackSession.ts`).
 *
 * `isClientFriendly: false` for the same reason `economySaveRejectedErr` uses
 * it: the interceptor answers a non-friendly error with HTTP **200** and
 * `error` set (`middleware/clientSafeError.ts:90-93`), the only failure shape
 * the archived Flash client turns into a readable message
 * (`client/scripts/BASE.as:3413-3416`). A real `403` reaches its
 * `handleLoadError` path instead — five silent retries and a generic popup. The
 * intended status travels in `errorDetails.status`, where the web client reads
 * it (`web/src/api/http.ts:19-22`).
 *
 * The `reason` is carried in `data` rather than in the message, because the
 * player who sees the message is usually the honest attacker whose attack timed
 * out, and "who are you" is not a useful thing to tell them.
 *
 * @param {string} reason - Which binding rule refused the save.
 */
export const attackNotBoundErr = (reason: string) =>
  new ClientSafeError({
    message: "This attack is no longer yours to save. Reload your yard.",
    status: Status.FORBIDDEN,
    data: { reason },
    isClientFriendly: false,
  });

/**
 * A monster transfer the rules in `services/monsters/transferRules.ts` refused
 * (issue #27, `docs/specs/monsters-and-hatchery.md` §9).
 *
 * `isClientFriendly: false` for the same reason `economySaveRejectedErr` and
 * `attackNotBoundErr` use it, and here the archived Flash client makes the
 * choice unusually plain. `transferSuccessful` is the only handler that shows
 * the player anything the server said: it branches on `param1.error == 0` and
 * otherwise prints `msg_err_transfer` — "There was a problem with the transfer:"
 * — with `param1.error` appended (`MapRoom.as:735-792`). A non-friendly error is
 * the one shape that fills that slot, because the interceptor answers it with
 * HTTP **200** and `error` set to the message
 * (`middleware/clientSafeError.ts:90-93`). A friendly error would leave `error`
 * undefined and the player would read "There was a problem with the transfer:
 * undefined".
 *
 * The message is therefore written as a sentence fragment that continues that
 * prefix, and carries no ids or numbers. Which rule refused, and the figures
 * behind it, travel in `data` for the web client and the logs. The intended
 * status still travels in `errorDetails.status`, where the web client reads it
 * (`web/src/api/http.ts:19-22`).
 *
 * @param {string} rule - Which transfer rule refused the request.
 * @param {string} message - The fragment shown to the player after the prefix.
 * @param {object} detail - The figures behind the refusal.
 */
export const monsterTransferRejectedErr = (
  rule: string,
  message: string,
  detail: object = {}
) =>
  new ClientSafeError({
    message,
    status: Status.CONFLICT,
    data: { rule, ...detail },
    isClientFriendly: false,
  });
