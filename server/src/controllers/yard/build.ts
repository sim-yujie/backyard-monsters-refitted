import { YardBuildSchema, YardCancelBuildSchema } from "../../schemas/YardSchemas.js";
import { placedFinishedEvents } from "../../services/achievements/record.js";
import {
  fundGrantFor,
  fundedBuildingIds,
  isGuidedBuild,
  planGuidedBuild,
} from "../../services/onboarding/guidedStart.js";
import { guideOpen, readOnboarding } from "../../services/onboarding/state.js";
import { planBuild, planCancelBuild, planInstantBuild } from "../../services/yard/build.js";
import { withInfernoStanding } from "../../services/yard/surfaceInferno.js";
import { yardRefusedErr } from "../../services/yard/yardErrors.js";
import { defineYardAction } from "./yardAction.js";

/**
 * `POST /bm/yard/build` — place a new building from the build menu: a
 * countdown holding a worker, or for a wall or trap a finished building
 * (`docs/design/yard-buildings.md` §5.3, D13). The rules are
 * `services/yard/build.ts`; the wrapper charges `costs[0]` and writes.
 *
 * At the guided start's build step for this type (`build-sniper` and the
 * like, issue #227), the build is the guide's: it pays the shortfall
 * (`planGuidedBuild`, `docs/design/tutorial.md` §2.4), records the grant and
 * moves the guide on, in the same commit. The Build menu sends the same
 * request either way; it only waives its own shortfall gate at that step.
 *
 * A Block or Heavy Trap placed finished counts as built for the
 * achievements (issue #204); one that starts a countdown counts when it ends.
 *
 * A main-yard Inferno building (Quake or Magma Tower, Siege Factory or Lab)
 * reads the player's Inferno standing first and is paid from the Inferno
 * purse (`services/yard/surfaceInferno.ts`, Inferno WP 6.1).
 */
export const yardBuildAction = defineYardAction({
  schema: YardBuildSchema,
  run: async ({ save, user, body, now, em }) => {
    const onboarding = readOnboarding(save);
    const built = (finished: boolean) => (finished ? placedFinishedEvents(body.type) : undefined);
    if (!isGuidedBuild(save, onboarding, body.type)) {
      const plan = planBuild(await withInfernoStanding(em, user.userid, save, body.type), body, now);
      return { ...plan, achievementEvents: built(plan.report.finished) };
    }
    const { onboarding: guided, slices, ...plan } = planGuidedBuild(save, onboarding, body, now);
    return { ...plan, slices: { ...slices, onboarding: guided }, achievementEvents: built(plan.report.finished) };
  },
  outposts: "allow",
  inferno: "allow",
});

/**
 * `POST /bm/yard/build/cancel` — take down a building still under
 * construction and refund its full build price, clamped to the storage cap
 * (§5.3). A building the guided start paid for cannot be cancelled while the
 * guide runs (§8.4 rule 4; Flash locked recycling during its tutorial,
 * `tut_recycle_locked`), and once it is over (a skip between the build and
 * the free finish) Bob's share is kept back from the refund.
 */
export const yardCancelBuildAction = defineYardAction({
  schema: YardCancelBuildSchema,
  run: ({ save, body }) => {
    const onboarding = readOnboarding(save);
    if (guideOpen(onboarding) && fundedBuildingIds(onboarding).includes(body.id)) {
      throw yardRefusedErr("guideBuilding", "Bob paid for this one: it stays until the guided start is over.", {
        id: body.id,
      });
    }
    return planCancelBuild(save, body.id, fundGrantFor(onboarding, body.id));
  },
  // `msg_stopconstructionoutpostbuilding` (`client/scripts/BFOUNDATION.as:2511-2517`).
  outposts: { refuse: "You cannot stop the construction of a building in your Outposts." },
  inferno: "allow",
});

/**
 * `POST /bm/yard/build/instant` — place a new building finished, for Shiny:
 * no resources, no worker, its points now (§5.3). The wrapper refuses a
 * Shiny-locked account and a short balance. A Block or Heavy Trap counts as
 * built for the achievements (issue #204).
 */
export const yardInstantBuildAction = defineYardAction({
  schema: YardBuildSchema,
  run: async ({ save, user, body, now, em }) => ({
    ...planInstantBuild(await withInfernoStanding(em, user.userid, save, body.type), body, now),
    achievementEvents: placedFinishedEvents(body.type),
  }),
  outposts: "allow",
  inferno: "allow",
});
