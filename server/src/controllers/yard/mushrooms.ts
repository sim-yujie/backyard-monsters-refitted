import z from "zod";
import { countMushroom } from "../../services/goals/counters.js";
import type { Random } from "../../services/yard/mushrooms.js";
import { planMushroomPick } from "../../services/yard/mushrooms.js";
import { defineYardAction } from "./yardAction.js";

/**
 * `POST /bm/yard/mushroom/pick` body: the mushroom's index in `mushrooms.l`,
 * and optionally where the client saw it (yard units), so a stale list is
 * refused rather than picking a different mushroom.
 */
export const YardMushroomPickSchema = z.object({
  id: z.coerce.number().int().nonnegative(),
  x: z.coerce.number().optional(),
  y: z.coerce.number().optional(),
});

/**
 * The pick action, with the reward roll's random source as a parameter so
 * tests can pin it.
 *
 * The Shiny reward is the one credit the wrapper's outcome has no field for
 * (`YardOutcome.shiny` takes Shiny), so `run` adds it to the locked save
 * itself. Nothing in the wrapper can refuse after `run` for this route (it
 * debits nothing), so the credit and the new `mushrooms` land together or,
 * on an error, roll back together. A Shiny-locked account still gets it:
 * rewards arrive whatever the lock (§2.1 "Shiny lock").
 */
export const mushroomPickAction = (random: Random) =>
  defineYardAction({
    schema: YardMushroomPickSchema,
    run: ({ save, body }) => {
      const pick = planMushroomPick(save, body.id, { x: body.x, y: body.y }, random);
      if (pick.shiny > 0) save.credits = Number(save.credits ?? 0) + pick.shiny;
      return {
        report: pick.report,
        // Goals M1-M6 count the pick, golden by the server's own roll (#227).
        slices: { mushrooms: { ...pick.mushrooms }, onboarding: countMushroom(save, pick.report.golden) },
      };
    },
  });

/**
 * `POST /bm/yard/mushroom/pick` — pick one mushroom with a free worker; the
 * server rolls the reward (`docs/design/yard-buildings.md` §5.6, D14). Refusals:
 * 400 `badRequest`, 409 `moved`, 409 `workers`.
 */
export const yardMushroomPickAction = mushroomPickAction(Math.random);
