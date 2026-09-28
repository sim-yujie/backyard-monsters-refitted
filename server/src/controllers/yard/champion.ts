import {
  YardChampionFeedSchema,
  YardChampionRaiseSchema,
  YardChampionRenameSchema,
  YardChampionSchema,
} from "../../schemas/YardSchemas.js";
import {
  planChampionEvolve,
  planChampionFeed,
  planChampionHeal,
  planChampionJuice,
  planChampionRaise,
  planChampionRename,
} from "../../services/yard/champion.js";
import { defineYardAction } from "./yardAction.js";

/**
 * The Champion Cage's routes (`docs/design/yard-buildings.md` §7.2, issue
 * #123). The rules and prices are `services/yard/champion.ts`; starving and
 * passive healing happen in the catch-up (`services/yard/catchUpChampions.ts`)
 * before any of these runs. The wrapper charges the Shiny and writes once.
 */

/** `POST /bm/yard/champion/raise` — hatch Gorgo, Drull or Fomor at the cage, free. */
export const yardChampionRaiseAction = defineYardAction({
  schema: YardChampionRaiseSchema,
  run: ({ save, body, now }) => planChampionRaise(save, body.type, now),
});

/** `POST /bm/yard/champion/feed` — feed the champion from housing (`monsters`) or with Shiny. */
export const yardChampionFeedAction = defineYardAction({
  schema: YardChampionFeedSchema,
  run: ({ save, body, now }) => planChampionFeed(save, body.mode, now),
});

/** `POST /bm/yard/champion/evolve` — evolve to the next level now, for Shiny. */
export const yardChampionEvolveAction = defineYardAction({
  schema: YardChampionSchema,
  run: ({ save, now }) => planChampionEvolve(save, now),
});

/** `POST /bm/yard/champion/heal` — heal to full now, for Shiny. */
export const yardChampionHealAction = defineYardAction({
  schema: YardChampionSchema,
  run: ({ save }) => planChampionHeal(save),
});

/** `POST /bm/yard/champion/rename` — name the champion. */
export const yardChampionRenameAction = defineYardAction({
  schema: YardChampionRenameSchema,
  run: ({ save, body }) => planChampionRename(save, body.name),
});

/** `POST /bm/yard/champion/juice` — put the champion into the Juicer for good (no goo). */
export const yardChampionJuiceAction = defineYardAction({
  schema: YardChampionSchema,
  run: ({ save }) => planChampionJuice(save),
});
