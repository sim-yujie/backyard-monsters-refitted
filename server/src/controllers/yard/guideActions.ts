import z from "zod";
import { BuildingIdField } from "../../schemas/YardSchemas.js";
import {
  openPracticeCamp,
  practiceCampDestroyed,
  removePracticeCamp,
  resetPracticeCamp,
} from "../../services/maproom/v1/practiceCamp.js";
import {
  planAdvance,
  planGuideArmy,
  planGuidedFinish,
  planGuideSkip,
} from "../../services/onboarding/guidedStart.js";
import { readOnboarding } from "../../services/onboarding/state.js";
import { defineYardAction, type YardSlices } from "./yardAction.js";

/**
 * The yard actions of the new-player tutorial's guided start package (b): `guide/advance`,
 * `guide/finish`, `guide/army`, `guide/skip` (`docs/design/tutorial.md` §2,
 * §8.3). Issue #227. The guide's paid build is `/bm/yard/build` itself, which
 * hands a build at the guide's build step to `planGuidedBuild`
 * (`controllers/yard/build.ts`).
 *
 * Every route is a yard action: it runs under the save row lock, its grant,
 * its ledger entry and the guide's new step are written in one commit, and it
 * refuses on an outpost (no `outposts` policy). The rules are
 * `services/onboarding/guidedStart.ts`; the practice camp's row is
 * `services/maproom/v1/practiceCamp.ts`, written through the request's
 * transaction (`em`). Bound to their paths in `guide.ts`; kept apart so the
 * tests drive them without the server.
 */

/**
 * The end of the guide writes `tutorialstage` 205 beside `protected`. The
 * column is not one of the wrapper's `YardSlices` (it predates them, and the
 * wrapper is frozen), but the wrapper applies slices with `Object.assign`, so
 * it lands in the same commit.
 */
const endSlices = (finish: { protected: number; tutorialstage: number }): YardSlices =>
  ({ protected: finish.protected, tutorialstage: finish.tutorialstage }) as YardSlices;

const AdvanceSchema = z.object({ from: z.string().min(1).max(32) });
const FinishSchema = z.object({ id: BuildingIdField });
const EmptySchema = z.object({});

/** Steps whose advance reads the practice camp's row. */
const READS_CAMP = new Set(["attack", "attack-result"]);

/** `POST /bm/yard/guide/advance {from}` — moves the guide on from a step that grants nothing. */
export const yardGuideAdvanceAction = defineYardAction({
  schema: AdvanceSchema,
  run: async ({ save, user, body, now, em }) => {
    const onboarding = readOnboarding(save);
    const campDestroyed = READS_CAMP.has(body.from) && onboarding.camp.state === "open"
      ? await practiceCampDestroyed(em, user.userid)
      : false;
    const plan = planAdvance(save, onboarding, body.from, now, { campDestroyed });
    if (plan.removeCamp) await removePracticeCamp(em, user.userid);
    return {
      report: { step: plan.step },
      slices: { onboarding: plan.onboarding, ...(plan.finish && endSlices(plan.finish)) },
    };
  },
});

/** `POST /bm/yard/guide/finish {id}` — the free Finish now on the building the guide paid for. */
export const yardGuideFinishAction = defineYardAction({
  schema: FinishSchema,
  run: async ({ save, user, body, now, em }) => {
    const plan = planGuidedFinish(save, readOnboarding(save), body.id, now);
    if (plan.openCamp) await openPracticeCamp(em, user.userid);
    return {
      report: plan.report,
      slices: {
        onboarding: plan.onboarding,
        ...(plan.buildingdata && { buildingdata: plan.buildingdata }),
      },
      points: plan.points,
    };
  },
});

/** `POST /bm/yard/guide/army` — housed Pokeys up to 15: Bob's gift, or the free retry. */
export const yardGuideArmyAction = defineYardAction({
  schema: EmptySchema,
  run: async ({ save, user, now, em }) => {
    const onboarding = readOnboarding(save);
    const campDestroyed =
      onboarding.guide.step === "attack-result" && onboarding.camp.state === "open"
        ? await practiceCampDestroyed(em, user.userid)
        : false;
    const plan = planGuideArmy(save, onboarding, now, { campDestroyed });
    if (plan.retry) await resetPracticeCamp(em, user.userid);
    return { report: plan.report, slices: { onboarding: plan.onboarding, monsters: plan.monsters } };
  },
});

/** `POST /bm/yard/guide/skip` — ends the guide for good; protection all the same. */
export const yardGuideSkipAction = defineYardAction({
  schema: EmptySchema,
  run: async ({ save, user, now, em }) => {
    const plan = planGuideSkip(save, readOnboarding(save), now);
    if (plan.removeCamp) await removePracticeCamp(em, user.userid);
    return {
      report: { state: "skipped" as const },
      slices: { onboarding: plan.onboarding, ...endSlices(plan.finish) },
    };
  },
});
