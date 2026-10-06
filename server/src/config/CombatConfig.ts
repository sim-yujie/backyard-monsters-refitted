import {
  isEconomyValidationMode,
  parseEconomyValidationMode,
  type EconomyValidationMode,
} from "./EconomyConfig.js";

/**
 * Attack save validation: the mode switch (`docs/design/server-combat.md` §3.6).
 *
 * `COMBAT_SAVE_VALIDATION` takes the same three modes as
 * `ECONOMY_SAVE_VALIDATION` and falls back to `reject`
 * ({@link DEFAULT_COMBAT_VALIDATION_MODE}). `COMBAT_SAVE_VALIDATION=log` is the
 * way back if honest players are ever turned away. It governs two checks: a bomb Flash would not have fired (issue
 * #90, `services/base/combat/bombSpend.ts`), and a save the server's replay of
 * the battle does not bear out (issue #23, C7, `services/base/combat/saveBattle.ts`).
 * Bombs are charged and the replay's figures written whatever the mode.
 *
 * - `off`    — nothing is checked or logged.
 * - `log`    — each is logged; a replay mismatch also writes a `Report` row.
 * - `reject` — the same, and either refuses the whole save before anything is applied.
 *   A replay mismatch on the attacker's siege stock alone is still only logged
 *   (`saveBattle.ts`): the server never writes the client's figure for it.
 */

/** off: charge only. log: charge and record. reject: refuse. */
export type CombatValidationMode = EconomyValidationMode;

/**
 * The mode an absent or unrecognised `COMBAT_SAVE_VALIDATION` means: `reject`
 * (issue #201), as the economy audit's became (issue #43). The server replays
 * with the inputs the client fought with, so an honest save never disagrees
 * (`combat/honestSaves.test.ts`).
 */
export const DEFAULT_COMBAT_VALIDATION_MODE: CombatValidationMode = "reject";

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
