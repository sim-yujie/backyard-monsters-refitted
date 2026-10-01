import type { Save } from "../../database/models/save.model.js";
import { goalsReady } from "../goals/summary.js";
import {
  readOnboarding,
  type CampState,
  type GrantRecord,
  type GuideState,
  type Onboarding,
} from "./state.js";

/**
 * What the client is told about `save.onboarding` (`docs/design/tutorial.md`
 * §8.1): the `onboarding` field of every `/bm/yard/*` answer (`YardState`)
 * and of the owner's build-mode `/base/load`. Enough to resume the guide at
 * its step, badge the Goals button and skip screens whose tips were seen;
 * never the grant ledger or the counters, which only the server reads.
 */
export interface OnboardingSummary {
  guide: {
    state: GuideState;
    /** The macro step while `pending` or `active`. */
    step?: string;
    /**
     * The building the guide paid for and has not finished yet (the newest
     * `fund:<type>` grant without its `finish:<type>`), so the client can point
     * at it after a reload.
     */
    building?: number;
  };
  /** The private practice camp: `none`, `open` or `removed`. */
  camp: CampState;
  /** Goals ready to claim (the dock badge). */
  goalsReady: number;
  /** Screen id to the unix second its tips were seen. */
  tips: Record<string, number>;
}

/** The building of the newest top-up still waiting for its free finish, if any. */
const unfinishedBuilding = (onboarding: Onboarding): number | undefined => {
  let newest: GrantRecord | undefined;
  for (const [key, grant] of Object.entries(onboarding.grants)) {
    if (!key.startsWith("fund:") || Array.isArray(grant) || !grant) continue;
    if (onboarding.grants[`finish:${key.slice("fund:".length)}`]) continue;
    if (typeof grant.id === "number" && (!newest || grant.at >= newest.at)) newest = grant;
  }
  return newest?.id;
};

/**
 * Builds the summary from a main save.
 *
 * @param save - The player's main save (on an outpost's answer, the main row).
 */
export const onboardingSummary = (save: Save): OnboardingSummary => {
  const onboarding = readOnboarding(save);
  const { state, step } = onboarding.guide;
  const open = state === "pending" || state === "active";
  const building = open ? unfinishedBuilding(onboarding) : undefined;
  return {
    guide: {
      state,
      ...(open && step !== undefined && { step }),
      ...(building !== undefined && { building }),
    },
    camp: onboarding.camp.state,
    goalsReady: goalsReady(save, onboarding),
    tips: onboarding.tips,
  };
};
