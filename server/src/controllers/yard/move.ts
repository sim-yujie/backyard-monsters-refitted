import { YardMoveSchema } from "../../schemas/YardSchemas.js";
import { planMove } from "../../services/yard/move.js";
import { defineYardAction } from "./yardAction.js";

/**
 * `POST /bm/yard/move` — pick one building up and put it down elsewhere
 * (`docs/design/inferno.md` §5, WP 1.15). The rules are
 * `services/yard/move.ts`; the wrapper writes the new position and moves any
 * mushroom the building now stands on.
 */
export const yardMoveAction = defineYardAction({
  schema: YardMoveSchema,
  run: ({ save, body }) => planMove(save, body),
  outposts: "allow",
  inferno: "allow",
});
