/**
 * The Discord gate on accounts (issue #213): `REQUIRE_DISCORD_VERIFICATION`.
 *
 * The server used to demand Discord on every production server: a login was
 * refused until the account had been verified on the Discord server (in
 * #claim-account), and attacks and Map Room moves were refused unless the
 * account's Discord ID was at least 7 days old. An account made on the web
 * client's sign-up form has no Discord at all, so on production it could
 * never play. The switch lets the owner choose.
 *
 * - `true`  — both gates as before, on a production server (`ENV=production`)
 *             only; a local server never asks for Discord.
 * - anything else, or unset — no Discord needed anywhere. A verified account's
 *             Discord ID is still used for its avatar.
 *
 * Read on each call rather than once at import, so tests can flip it.
 */

/** Whether production demands a verified, week-old Discord account. */
export const requiresDiscordVerification = (): boolean =>
  process.env.REQUIRE_DISCORD_VERIFICATION?.trim().toLowerCase() === "true";
