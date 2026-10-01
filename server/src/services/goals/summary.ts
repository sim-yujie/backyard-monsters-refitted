import type { Save } from "../../database/models/save.model.js";
import type { Onboarding } from "../onboarding/state.js";
import { goalsReadyCount } from "./goalRules.js";

/**
 * How many goals are ready to claim, for the Goals button's badge
 * (`docs/design/tutorial.md` §6.3). Every yard action's answer and the
 * own-yard `/base/load` carry it, through `onboardingSummary`.
 *
 * Pure: it must not write `done` (that is `goals/state`'s and `goals/claim`'s
 * job), because the yard state is built after the transaction's last write.
 * A save whose Goals baseline is still pending counts 0 (`goalsReadyCount`).
 *
 * @param save - The player's main save, caught up.
 * @param onboarding - Its onboarding record, read with defaults.
 */
export const goalsReady = (save: Save, onboarding: Onboarding): number =>
  goalsReadyCount(save, onboarding);
