import {
  isEconomyValidationMode,
  parseEconomyValidationMode,
  type EconomyValidationMode,
} from "./EconomyConfig.js";

/**
 * Attack save validation: the mode switch (`docs/design/server-combat.md` §3.6).
 *
 * `COMBAT_SAVE_VALIDATION` takes the same three modes as
 * `ECONOMY_SAVE_VALIDATION` and falls back to `log`
 * ({@link DEFAULT_COMBAT_VALIDATION_MODE}), because its rollout starts the way
 * the economy audit's did: read what honest play produces before refusing
 * anything. Only the bomb charge reads it today (issue #90,
 * `services/base/combat/bombSpend.ts`); the rest of #23's combat audit will
 * read the same switch when it lands.
 *
 * - `off`    — bombs are charged; nothing is checked or logged.
 * - `log`    — bombs are charged; a bomb Flash would not have fired is logged.
 * - `reject` — such a bomb refuses the whole save before anything is applied.
 */

/** off: charge only. log: charge and record. reject: refuse. */
export type CombatValidationMode = EconomyValidationMode;

/**
 * The mode an absent or unrecognised `COMBAT_SAVE_VALIDATION` means: still
 * `log`. The economy audit moved to `reject` (issue #43); this one has not
 * had its own review.
 */
export const DEFAULT_COMBAT_VALIDATION_MODE: CombatValidationMode = "log";

export interface CombatConfig {
  readonly mode: CombatValidationMode;
}

export const combatConfig: CombatConfig = {
  mode: parseEconomyValidationMode(process.env.COMBAT_SAVE_VALIDATION, DEFAULT_COMBAT_VALIDATION_MODE),
};

/** True when `COMBAT_SAVE_VALIDATION` was set to something that is not a mode. */
export const combatModeWasUnrecognised =
  process.env.COMBAT_SAVE_VALIDATION !== undefined &&
  !isEconomyValidationMode(process.env.COMBAT_SAVE_VALIDATION);
