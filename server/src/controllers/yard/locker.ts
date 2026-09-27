import { YardLockerMonsterSchema, YardLockerSchema } from "../../schemas/YardSchemas.js";
import {
  planLockerCancel,
  planLockerFinish,
  planLockerInstant,
  planLockerStart,
} from "../../services/yard/locker.js";
import { defineYardAction } from "./yardAction.js";

/**
 * The Monster Locker's four routes (`docs/design/yard-buildings.md` §4.3).
 * The rules and prices are `services/yard/locker.ts`; the wrapper charges the
 * putty and the Shiny, clamps the refund and writes. Completion on the clock is
 * the catch-up's (`services/yard/catchUpLocker.ts`); the Overdrive is
 * `POST /bm/yard/shop/buy` `item=CLOD`.
 */

/** `POST /bm/yard/locker/start` — start unlocking `monster`, the full putty price up front. */
export const yardLockerStartAction = defineYardAction({
  schema: YardLockerMonsterSchema,
  run: ({ save, body, now }) => planLockerStart(save, body.monster, now),
});

/** `POST /bm/yard/locker/cancel` — stop the running unlock, the full putty price back (capped). */
export const yardLockerCancelAction = defineYardAction({
  schema: YardLockerSchema,
  run: ({ save }) => planLockerCancel(save),
});

/** `POST /bm/yard/locker/finish` — finish the running unlock now for Shiny. */
export const yardLockerFinishAction = defineYardAction({
  schema: YardLockerSchema,
  run: ({ save, now }) => planLockerFinish(save, now),
});

/** `POST /bm/yard/locker/instant` — unlock `monster` at once for Shiny, no putty. */
export const yardLockerInstantAction = defineYardAction({
  schema: YardLockerMonsterSchema,
  run: ({ save, body }) => planLockerInstant(save, body.monster),
});
