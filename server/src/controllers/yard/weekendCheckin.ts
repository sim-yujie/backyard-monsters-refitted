import z from "zod";

import {
  checkInWeekend,
  type WeekendCheckinOptions,
  type WeekendCheckinState,
} from "../../services/events/weekendCoins.js";
import { yardRefusedErr } from "../../services/yard/yardErrors.js";
import { defineYardAction } from "./yardAction.js";

/**
 * `events/weekend/checkin {}` (owner, 13 Nov 2026): today's weekend-event
 * check-in, 50 Glimmers once per event day (`services/events/weekendCoins.ts`).
 * A yard action on the main yard, so it runs under the save row lock and the
 * coins commit with it; the answer's `coins` carries the new balance and the
 * "+50" for the client.
 *
 * Refusals: `409 noWeekend` (no weekend event runs now), `409
 * checkedInToday {checkin, nextAt}` (today was paid: a second click, another
 * tab).
 */

export const WeekendCheckinSchema = z.object({});

export interface WeekendCheckinReport {
  /** Glimmers paid now. */
  paid: number;
  /** The check-in after this one: the card redraws from it. */
  checkin: WeekendCheckinState;
}

/** The check-in action; `options` swap the settings and coin store in tests. */
export const weekendCheckinAction = (options: WeekendCheckinOptions = {}) =>
  defineYardAction({
    schema: WeekendCheckinSchema,
    run: async ({ user, now, em }) => {
      const result = await checkInWeekend(em, user.userid, now, options);
      if (result.refused === "noWeekend") {
        throw yardRefusedErr("noWeekend", "There is no weekend event on right now.");
      }
      if (result.refused === "checkedInToday") {
        throw yardRefusedErr("checkedInToday", "You have checked in today. Come back tomorrow!", {
          checkin: result.state,
          nextAt: result.state.nextAt,
        });
      }
      const report: WeekendCheckinReport = { paid: result.paid, checkin: result.state };
      return { report };
    },
  });
