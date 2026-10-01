import { Env } from "../enums/Env.js";
import { MessageType } from "../enums/MessageType.js";

/**
 * Whether a server started with these environment variables offers the maxed
 * sandbox yard to new accounts that ask for it (issue #217): DEV_SANDBOX=true,
 * and never on ENV=production.
 */
/**
 * Whether new main yards start the web client's guided start (issue #227,
 * `docs/design/tutorial.md` §8.1): GUIDED_START=1 turns it on and
 * GUIDED_START=0 off; unset, it is on everywhere but production, where it
 * stays off until the Goals, guided start and tips packages have all landed
 * and the owner has played it through (§9.1).
 */
export const guidedStartOn = (env: Record<string, string | undefined>): boolean =>
  env.GUIDED_START === undefined || env.GUIDED_START === ""
    ? env.ENV !== Env.PROD
    : env.GUIDED_START !== "0";

export const sandboxStartAvailable = (env: Record<string, string | undefined>): boolean =>
  env.ENV !== Env.PROD && env.DEV_SANDBOX === "true";

/** Visit our Wiki to get more information on each flag.
 * Wiki: https://github.com/bym-refitted/backyard-monsters-refitted/wiki/Dev-Settings-%E2%80%90-Configuration
 */
export const devConfig = {
  /*
   * Enable or disable the MapRoom on the server.
   */
  maproom: true,

  /*
   * Enable or disable the Inferno MapRoom on the server.
   */
  infernoMaproom: true,

  /*
   * Enable or disable Inferno on the server.
   */
  inferno: true,

  /*
   * Set the default amount of shiny on the user's account.
   * Must be set before creating a new record.
   */
  shiny: 1500,

  /*
   * Enable or disable the debug console. Requires a client restart.
   * A list of all available commands can be found in `ConsoleCommands.as`
   */
  debugMode: process.env.ENV === Env.PROD ? false : false,

  /*
   * Inserts a sandbox test base into the database, with all buildings placed.
   * Must be set before creating a new record.
   */
  // Local development only: DEV_SANDBOX=true makes the fully built sandbox base
  // (utils/sandbox/overworldYard.ts) AVAILABLE. A new main yard gets it only when
  // its account opted in at sign-up (user.sandbox_start, issue #217); everyone
  // else gets the normal starter base. Never in production.
  devSandbox: sandboxStartAvailable(process.env),

  /*
   * Inserts an Inferno sandbox test base into the database, with all buildings placed.
   * Must be set before creating a new record.
   */
  infernoSandbox: process.env.ENV === Env.PROD ? false : false,

  /*
   * Logs all missing assets and their paths to the server console.
   */
  logMissingAssets: process.env.ENV === Env.PROD ? false : true,

  /*
   * Sets whether the user's account should receive all unlockable event rewards.
   * Must be set before creating a new record.
   */
  unlockAllEventRewards: true,

  /*
   * Sets whether the descent into Inferno should be enabled or disabled.
   */
  skipDescent: process.env.ENV === Env.PROD ? false : false,

  /*
   * An override epoch timestamp for wild monster invasion 1 start time.
   * If set, the event will start immediately from this timestamp.
   * Default value is 0 - no override.
   */
  wmi1StartNowOverride: process.env.ENV === Env.PROD ? 0 : 0,

  /*
   * An override epoch timestamp for wild monster invasion 2 start time.
   * If set, the event will start immediately from this timestamp.
   * Default value is 0 - no override.
   */
  wmi2StartNowOverride: process.env.ENV === Env.PROD ? 0 : 0,

  /*
   * Sets whether the tutorial phase of the game is enabled or disabled.
   * The Flash client's tutorial only; the web client's guided start is `guidedStart`.
   */
  skipTutorial: process.env.ENV !== Env.PROD,

  /*
   * Whether a new main yard starts the web client's guided start (issue #227).
   * Off, new yards get no onboarding record and read as legacy: no guided
   * start, Goals with the no-reward baseline. See `guidedStartOn`.
   */
  guidedStart: guidedStartOn(process.env),

  /**
   * Sets the type of messages that are allowed to be sent by the client.
   */
  allowedMessageType: {
    [MessageType.MESSAGE]: true,
    [MessageType.TRUCE_REQUEST]: true,
    [MessageType.TRUCE_ACCEPT]: true,
    [MessageType.TRUCE_REJECT]: true,
    [MessageType.MIGRATE_REQUEST]: true,
    [MessageType.MIGRATE_REVOKE]: true,
  },
};
