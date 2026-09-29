import { YardBuildSchema, YardCancelBuildSchema } from "../../schemas/YardSchemas.js";
import { planBuild, planCancelBuild, planInstantBuild } from "../../services/yard/build.js";
import { defineYardAction } from "./yardAction.js";

/**
 * `POST /bm/yard/build` — place a new building from the build menu: a
 * countdown holding a worker, or for a wall or trap a finished building
 * (`docs/design/yard-buildings.md` §5.3, D13). The rules are
 * `services/yard/build.ts`; the wrapper charges `costs[0]` and writes.
 */
export const yardBuildAction = defineYardAction({
  schema: YardBuildSchema,
  run: ({ save, body, now }) => planBuild(save, body, now),
  outposts: "allow",
});

/**
 * `POST /bm/yard/build/cancel` — take down a building still under
 * construction and refund its full build price, clamped to the storage cap
 * (§5.3).
 */
export const yardCancelBuildAction = defineYardAction({
  schema: YardCancelBuildSchema,
  run: ({ save, body }) => planCancelBuild(save, body.id),
  // `msg_stopconstructionoutpostbuilding` (`client/scripts/BFOUNDATION.as:2511-2517`).
  outposts: { refuse: "You cannot stop the construction of a building in your Outposts." },
});

/**
 * `POST /bm/yard/build/instant` — place a new building finished, for Shiny:
 * no resources, no worker, its points now (§5.3). The wrapper refuses a
 * Shiny-locked account and a short balance.
 */
export const yardInstantBuildAction = defineYardAction({
  schema: YardBuildSchema,
  run: ({ save, body, now }) => planInstantBuild(save, body, now),
  outposts: "allow",
});
