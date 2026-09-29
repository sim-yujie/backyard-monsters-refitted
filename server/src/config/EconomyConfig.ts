/**
 * Economy save validation: the mode switch and the two tolerances every rule in
 * `services/base/economy/` reads
 * (`docs/design/economy-save-validation.md` §3.2).
 *
 * The variable lives in `server/.env` and is read once at import time, the same
 * bargain `DEV_SANDBOX` and `USE_VERSION_MANAGEMENT` make
 * (`config/GameConfig.ts:39-41`, `config/VersionManifestConfig.ts:17`). An
 * absent or unknown value means `reject` (issue #43): see
 * {@link DEFAULT_ECONOMY_VALIDATION_MODE}. {@link economyModeWasUnrecognised}
 * is exported so the startup banner can say the environment asked for
 * something this server does not know.
 *
 * Nothing in this file touches the database or the logger; it is imported by
 * the pure audit services, which have to stay testable without a server.
 */

/** off: today's behaviour. log: audit, record, never refuse. reject: refuse. */
export type EconomyValidationMode = "off" | "log" | "reject";

/** Every mode `ECONOMY_SAVE_VALIDATION` may name. */
export const ECONOMY_VALIDATION_MODES = ["off", "log", "reject"] as const;

/**
 * The mode an absent or unrecognised environment variable means: `reject`
 * (issue #43).
 *
 * The rollout in §3.2 began in `log` to read honest Flash play first. That
 * reading turned out to have nothing left to read: there is no Flash client
 * any more, the web client never sends an owner save (its yard changes go
 * through the action routes), and owner saves of a main yard or an outpost
 * are refused before the audit runs (`OWNER_SAVE_MODE`, `config/
 * OwnerSaveConfig.ts`). The audit now sees only the owner saves a debugging
 * `OWNER_SAVE_MODE=allow` lets through, and those are exactly the hand-made
 * requests it exists to refuse. The only rules that ever fired on an
 * unedited yard, `capMismatch` and `basevalueMismatch` on a `DEV_SANDBOX`
 * yard's inflated caps, are recorded and never refuse.
 */
export const DEFAULT_ECONOMY_VALIDATION_MODE: EconomyValidationMode = "reject";

/** Whether a string names a mode this server implements. */
export const isEconomyValidationMode = (raw: unknown): raw is EconomyValidationMode =>
  typeof raw === "string" && (ECONOMY_VALIDATION_MODES as readonly string[]).includes(raw);

/**
 * The mode a raw environment value asks for, or `fallback` when it names none:
 * {@link DEFAULT_ECONOMY_VALIDATION_MODE} unless the caller has its own.
 */
export const parseEconomyValidationMode = (
  raw: string | undefined,
  fallback: EconomyValidationMode = DEFAULT_ECONOMY_VALIDATION_MODE
): EconomyValidationMode => (isEconomyValidationMode(raw) ? raw : fallback);

/** What the audit services read out of the environment. */
export interface EconomyConfig {
  /** off: today's behaviour. log: audit, record, never refuse. reject: refuse. */
  readonly mode: EconomyValidationMode;
  /**
   * Seconds of countdown slack: the client's 3 s save delay, its 1 s tick and
   * clock skew (`docs/design/economy-save-validation.md` §6, item 5).
   */
  readonly timerTolerance: number;
  /**
   * Upper bound on the outpost income multiplier a Production Overdrive buff
   * can reach (§6, item 2). The per-outpost income figure itself is
   * client-written, so the bound is taken over the *stored* copy and multiplied
   * by this rather than trusted outright.
   */
  readonly overdriveMax: number;
}

/** The config the controller and the audit share. */
export const economyConfig: EconomyConfig = {
  mode: parseEconomyValidationMode(process.env.ECONOMY_SAVE_VALIDATION),
  timerTolerance: 10,
  overdriveMax: 2,
};

/**
 * True when `ECONOMY_SAVE_VALIDATION` was set to something that is not a mode.
 * The value was treated as the default; the startup banner says so out loud
 * rather than letting a typo silently turn the audit into something it is not.
 */
export const economyModeWasUnrecognised =
  process.env.ECONOMY_SAVE_VALIDATION !== undefined &&
  !isEconomyValidationMode(process.env.ECONOMY_SAVE_VALIDATION);
