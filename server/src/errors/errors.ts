import { Status } from "../enums/StatusCodes.js";
import { ClientSafeError } from "../middleware/clientSafeError.js";
import type { EconomyViolation } from "../services/base/economy/auditEconomySave.js";
import type { CombatViolation } from "../game-rules/combat/index.js";
import type { RelocateRefusal } from "../services/maproom/v2/relocateRules.js";
import type { TakeoverRefusal } from "../services/maproom/v2/takeoverRules.js";

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

/**
 * The username is taken, compared without case (issue #213). `reason` travels
 * in `data` so the sign-up form can mark the username field.
 */
export const usernameUniqueErr = () =>
  new ClientSafeError({
    message: "An account with this username already exists.",
    status: Status.CONFLICT,
    data: { reason: "usernameTaken" },
    isClientFriendly: true,
  });

export const emailUniqueErr = () =>
  new ClientSafeError({
    message: "An account with this email address already exists.",
    status: Status.CONFLICT,
    data: { reason: "emailTaken" },
    isClientFriendly: true,
  });

/**
 * A sign-up whose fields break the account rules (issue #213): a clean 400
 * naming the first broken rule and its field, where a raw zod error used to
 * answer 500. The message is one of the shared `AccountMessage`s.
 */
export const invalidAccountErr = (message: string, field: string) =>
  new ClientSafeError({
    message,
    status: Status.BAD_REQUEST,
    data: { reason: "invalidAccount", field },
    isClientFriendly: true,
  });

/**
 * The sign-up's Turnstile token was missing, expired, already used or refused
 * by Cloudflare (issue #213). The form fetches a fresh one and the player can
 * try again.
 */
export const botCheckFailedErr = () =>
  new ClientSafeError({
    message: "We couldn't confirm you're a person. Please complete the check and try again.",
    status: Status.BAD_REQUEST,
    data: { reason: "botCheckFailed" },
    isClientFriendly: true,
  });

/**
 * Cloudflare could not be asked about the sign-up's Turnstile token, or the
 * server's secret key is wrong (issue #213). No account is made.
 */
export const botCheckUnavailableErr = () =>
  new ClientSafeError({
    message: "We couldn't run the sign-up check just now. Please try again in a minute.",
    status: Status.SERVICE_UNAVAILABLE,
    data: { reason: "botCheckUnavailable" },
    isClientFriendly: true,
  });

export const usernameCooldownErr = (nextChangeAt: Date) =>
  new ClientSafeError({
    message: `You can only change your username once every 6 months. You can change it again on ${nextChangeAt.toUTCString()}.`,
    status: Status.CONFLICT,
    data: { nextChangeAt: nextChangeAt.toISOString() },
    isClientFriendly: true,
  });

/**
 * An avatar change naming a picture that is not one of the twelve critters
 * (issue #175, `game-data/avatars.ts`). `reason` travels in `data` for the web
 * client, as the yard routes' refusals do.
 */
export const unknownAvatarErr = () =>
  new ClientSafeError({
    message: "That avatar is not one you can pick.",
    status: Status.BAD_REQUEST,
    data: { reason: "unknownAvatar" },
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

/**
 * `/base/load` named a base id that has no save (#191): a clean 404 the client
 * can show, where an unhandled `Error` used to answer 500.
 */
export const baseNotFoundErr = () =>
  new ClientSafeError({
    message: "That yard could not be found.",
    status: Status.NOT_FOUND,
    data: { reason: "baseNotFound" },
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

/** A truce request between two players who already have a request waiting or a truce running (#203). */
export const truceExistsErr = () =>
  new ClientSafeError({
    message: "You already have a truce, or a truce request waiting, with this player.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: true,
  });

/** An answer to a truce request that was already answered, or has lapsed (#203). */
export const truceClosedErr = () =>
  new ClientSafeError({
    message: "This truce request can no longer be answered.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: true,
  });

/** A second invitation to move onto an outpost while one waits (#205; Flash's `mailbox_invitepending`). */
export const inviteExistsErr = () =>
  new ClientSafeError({
    message: "Invitation already pending. An outpost can have one invitation waiting at a time.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: true,
  });

/** An answer to an invitation to move that was answered, withdrawn, has lapsed, or is void (#205). */
export const inviteClosedErr = () =>
  new ClientSafeError({
    message: "This invitation can no longer be answered.",
    status: Status.CONFLICT,
    data: {},
    isClientFriendly: true,
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

/**
 * A Map Room 2 player asked to go back to Map Room 1 (`setmapversion` with
 * version 0 or 1). The owner's rule (2026-09-30): the move to Map Room 2 is
 * one way. A soft refusal; nothing is written.
 */
export const cannotLeaveMapRoom2Err = () =>
  new ClientSafeError({
    message: "Your yard is on Map Room 2 and cannot go back to Map Room 1.",
    status: Status.CONFLICT,
    data: { reason: "mapRoom2Final" },
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
 * An attack save whose battle replay did not finish in time (issue #23, C5,
 * `services/base/combat/replayRunner.ts`). Nothing of the save was written:
 * the attack is left to the server's finaliser, which lands it from its last
 * checkpoint on the attacker's next load, or once the attack's window closes
 * (`finaliseAttack.ts`). `503` in `errorDetails.status`, where the web client
 * reads it; `isClientFriendly: false` as `attackNotBoundErr` explains.
 */
export const attackResultPendingErr = () =>
  new ClientSafeError({
    message: "The attack's result is still being worked out. It will be in your yard shortly.",
    status: Status.SERVICE_UNAVAILABLE,
    data: { reason: "replayTimeout" },
    isClientFriendly: false,
  });

/**
 * An attack checkpoint the server will not keep (issue #138,
 * `services/base/attackCheckpoint.ts`): one that does not parse, or one that
 * would take something back out of the record already held — a shorter log, a
 * changed event, another seed or an earlier tick. `isClientFriendly: false`
 * for the reason `attackNotBoundErr` gives; the web client does not show it.
 *
 * @param {string} reason - Why the checkpoint was refused.
 */
export const attackCheckpointRefusedErr = (reason: string) =>
  new ClientSafeError({
    message: "This attack checkpoint was not accepted.",
    status: Status.CONFLICT,
    data: { reason },
    isClientFriendly: false,
  });

/**
 * An attack save whose battle the server's replay does not bear out — its
 * damage, health, destroyed flag, fired traps, loot or the attacker's own
 * champion health differ from the replay's — refused in
 * `COMBAT_SAVE_VALIDATION=reject` mode (issue #23, C7,
 * `services/base/combat/saveBattle.ts`). Nothing was written, and on Map Room
 * 2 the attack's checkpoint lets the finaliser land the server's result.
 *
 * `reason` is `replayMismatch` so the web client can tell a retry will not
 * help; `fields` says which figures differed. A siege-only difference is
 * logged, never refused (`LOG_ONLY_FIELDS` in `saveBattle.ts`).
 *
 * @param fields The fields that differed.
 */
export const attackReplayRejectedErr = (fields: readonly string[]) =>
  new ClientSafeError({
    message: "The server replayed this battle and got a different result, so it did not take this save.",
    status: Status.CONFLICT,
    data: { reason: "replayMismatch", fields: [...fields] },
    isClientFriendly: false,
  });

/**
 * An attack save whose fling log fired a resource bomb Flash would not have
 * let go — one the attacker could not afford, a second of one resource, a tier
 * above their catapult, or an id the bomb table does not know — refused in
 * `COMBAT_SAVE_VALIDATION=reject` mode (issue #90,
 * `services/base/combat/bombSpend.ts`).
 *
 * `isClientFriendly: false` for the same reason `attackNotBoundErr` uses it.
 * `reason` is `bombSpend` so the web client can tell a retry will not help;
 * the violations say which bomb and why.
 *
 * @param violations The enforced violations that refused the save.
 */
export const attackBombRefusedErr = (violations: CombatViolation[]) =>
  new ClientSafeError({
    message: "This attack's bombs do not add up. Reload your yard.",
    status: Status.CONFLICT,
    data: { reason: "bombSpend", violations },
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

/**
 * An owner `/base/save` of a main yard, refused because owner saves are retired
 * (issue #101, `docs/design/yard-buildings.md` T1, `OWNER_SAVE_MODE=refuse`).
 *
 * A real `409`: there is no Flash client left to need the HTTP 200 rewrite the
 * older save refusals use (D1), and the web client never sends this save. The
 * `reason` says a retry will not help.
 */
export const ownerSaveRetiredErr = () =>
  new ClientSafeError({
    message: "Your yard is saved by the server now; this save was not applied. Reload your yard.",
    status: Status.CONFLICT,
    data: { reason: "ownerSaveRetired" },
    isClientFriendly: true,
  });

/** Why a Map Room 1 tribe cannot be attacked or read (issue #161, #132). */
export type MR1TribeRefusal = "notMapRoom1" | "notYourTribe" | "tribeDestroyed";

const MR1_TRIBE_REFUSAL_MESSAGES: Record<MR1TribeRefusal, string> = {
  notMapRoom1: "Your yard has moved on to Map Room 2; Map Room 1 is closed to you.",
  notYourTribe: "That tribe is not on your map. Reopen the map to see your tribes.",
  tribeDestroyed: "That tribe has been wrecked and has not come back yet.",
};

/**
 * A Map Room 1 tribe attack (or the Map Room 1 read) refused before anything
 * is written: the player is not on Map Room 1, the tribe base is not one of
 * the four they face now, or it is wrecked and has not respawned.
 *
 * @param {MR1TribeRefusal} reason - Which rule refused it.
 * @param {object} detail - Figures for the client, e.g. `respawnAt`.
 */
export const mr1TribeRefusedErr = (reason: MR1TribeRefusal, detail: object = {}) =>
  new ClientSafeError({
    message: MR1_TRIBE_REFUSAL_MESSAGES[reason],
    status: Status.CONFLICT,
    data: { reason, ...detail },
    isClientFriendly: true,
  });

const RELOCATE_REFUSAL_MESSAGES: Record<RelocateRefusal, string> = {
  notMapRoom2: "you can only move to a new world from Map Room 2.",
  inAlliance: "you cannot move to a new world while you are in an alliance.",
  hasOutposts: "you cannot move to a new world while you own outposts.",
  yardStanding: "you can only move to a new world once your main yard has been destroyed.",
  noHomeCell: "your main yard is not on this map.",
  notFound: "that outpost could not be found.",
  wrongWorld: "that outpost is not in your world.",
  notAnOutpost: "you can only move your main yard onto one of your outposts.",
  notYours: "that outpost is not yours.",
  underAttack: "that yard is under attack. Try again when the attack is over.",
  notEnoughShiny: "you do not have enough Shiny.",
  notEnoughResources: "you do not have enough resources.",
};

/**
 * A Map Room 2 main-yard relocation refused (issue #181,
 * `services/maproom/v2/relocateRules.ts`).
 *
 * `isClientFriendly: false` for the reason `monsterTransferRejectedErr` gives:
 * Flash's `RelocateSuccess` prints `msg_err_relocate` — "There was a problem
 * relocating your yard: " — with `error` appended (`PopupRelocateMe.as:168-170`),
 * so the message is a fragment that continues that prefix. `reason` travels in
 * `data` for the web client and the logs.
 *
 * @param {RelocateRefusal} reason - Which rule refused it.
 */
export const relocateRefusedErr = (reason: RelocateRefusal) =>
  new ClientSafeError({
    message: RELOCATE_REFUSAL_MESSAGES[reason],
    status: Status.CONFLICT,
    data: { reason },
    isClientFriendly: false,
  });

const TAKEOVER_REFUSAL_MESSAGES: Record<TakeoverRefusal, string> = {
  notFound: "that yard could not be found.",
  mainYard: "a main yard cannot be taken over.",
  ownYard: "that yard is already yours.",
  noTakeoverChance: "only the player who destroyed an outpost may take it over, and only just after the attack.",
  notDestroyed: "that yard has not been destroyed.",
  regenerated: "the wild monsters have rebuilt that yard.",
  protected: "that yard is under damage protection.",
  locked: "that yard is being worked on by its owner or is under attack by another player.",
  underAttack: "that yard is under attack by another player.",
  maxOutposts: "you have too many outposts.",
  notEnoughShiny: "you do not have enough Shiny.",
  notEnoughResources: "you do not have enough resources.",
};

/**
 * A Map Room 2 takeover refused (issue #182,
 * `services/maproom/v2/takeoverRules.ts`).
 *
 * `isClientFriendly: false` for the same reason as `relocateRefusedErr`: Flash
 * prints `err_takeoverproblem` — "There was a problem taking over this yard: "
 * — with `error` appended (`PopupTakeover.as:160-162`).
 *
 * @param {TakeoverRefusal} reason - Which rule refused it.
 */
export const takeoverRefusedErr = (reason: TakeoverRefusal) =>
  new ClientSafeError({
    message: TAKEOVER_REFUSAL_MESSAGES[reason],
    status: Status.CONFLICT,
    data: { reason },
    isClientFriendly: false,
  });

/** Why an auto-attack was refused (issue #221, `services/base/autoAttack/autoAttack.ts`). */
export type AutoAttackRefusal =
  | "notMapRoom2"
  | "notACamp"
  | "noPlan"
  | "missing"
  | "inFlight"
  | "busy"
  | "failed";

const AUTO_ATTACK_REFUSAL_MESSAGES: Record<AutoAttackRefusal, string> = {
  notMapRoom2: "Auto-attack is for Map Room 2 only.",
  notACamp: "Only a wild monster camp on Map Room 2 can be auto-attacked.",
  noPlan: "Attack a camp of this tribe and level by hand first, then repeat that attack.",
  missing: "You do not have everything that attack used.",
  inFlight: "Your last auto-attack is still being worked out.",
  busy: "The server is busy working out other attacks. Try again in a moment.",
  failed: "The auto-attack could not be worked out. Nothing was spent.",
};

/**
 * An auto-attack refused (issue #221). `missing` carries what the attack the
 * player would repeat used and they lack now (`PlanShortfall`), so the client
 * can list it. `busy` is a 503: the server's replay workers are full.
 *
 * @param {AutoAttackRefusal} reason - Which rule refused it.
 * @param {object} [details] - Anything the refusal carries, such as `missing`.
 */
export const autoAttackRefusedErr = (reason: AutoAttackRefusal, details: object = {}) =>
  new ClientSafeError({
    message: AUTO_ATTACK_REFUSAL_MESSAGES[reason],
    status: reason === "busy" ? Status.SERVICE_UNAVAILABLE : Status.CONFLICT,
    data: { reason, ...details },
    isClientFriendly: false,
  });

/**
 * Why a wild monster raid route said no (#226 WP3, `controllers/raid/raid.ts`),
 * with the Trojan Horse's springing added (`docs/design/trojan-horse.md` §7,
 * issue #326): `raidOpen` (a raid, or another spring, is already open or
 * fighting) and `noHorse` (no horse to spring: never placed, already sprung,
 * or not in `buildingdata`) and `offline` (the raid presence check).
 */
export type RaidRefusal =
  | "badRequest"
  | "notMainYard"
  | "noRaid"
  | "notWarning"
  | "notYet"
  | "notFighting"
  | "tooEarly"
  | "cancelled"
  | "underAttack"
  | "raidOpen"
  | "noHorse"
  | "offline"
  | "busy";

const RAID_REFUSAL_MESSAGES: Record<RaidRefusal, string> = {
  badRequest: "That raid request was not understood.",
  notMainYard: "Wild monsters only raid your main yard.",
  noRaid: "That raid is over or was called off.",
  notWarning: "That raid has already started.",
  notYet: "The wild monsters have not arrived yet.",
  notFighting: "That raid has not started yet.",
  tooEarly: "The raid is still going on.",
  cancelled: "The raid was called off because the game was closed during it.",
  underAttack: "Your yard is under attack right now. The wild monsters will wait.",
  raidOpen: "A raid is already happening on your yard.",
  noHorse: "There is no Trojan Horse waiting to be sprung.",
  offline: "You need to be at your yard for this.",
  busy: "The server is busy. Try again in a moment.",
};

/**
 * A wild monster raid route refused (`409`, or `503 busy` when the fight could
 * not be run in time); `data.reason` says why. `tooEarly` carries `readyAt`,
 * `notYet` `attackAt`.
 */
export const raidRefusedErr = (reason: RaidRefusal, details: object = {}) =>
  new ClientSafeError({
    message: RAID_REFUSAL_MESSAGES[reason],
    status:
      reason === "busy"
        ? Status.SERVICE_UNAVAILABLE
        : reason === "badRequest"
          ? Status.BAD_REQUEST
          : Status.CONFLICT,
    data: { reason, ...details },
    isClientFriendly: true,
  });
