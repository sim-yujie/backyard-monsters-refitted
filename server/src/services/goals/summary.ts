import type { Save } from "../../database/models/save.model.js";
import type { Onboarding } from "../onboarding/state.js";

/**
 * How many goals are ready to claim, for the Goals button's badge
 * (`docs/design/tutorial.md` §6.3). Every yard action's answer and the
 * own-yard `/base/load` carry it, through `onboardingSummary`.
 *
 * A stub until the Goals package (issue #227, package a) fills it from its
 * goal rules: always 0. Pure: it must not write `done` (that is
 * `goals/state`'s and `goals/claim`'s job), because the yard state is built
 * after the transaction's last write.
 *
 * @param _save - The player's main save, caught up.
 * @param _onboarding - Its onboarding record, read with defaults.
 */
export const goalsReady = (_save: Save, _onboarding: Onboarding): number => 0;
