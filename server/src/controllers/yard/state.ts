import { BaseType } from "../../enums/Base.js";
import { YardStateSchema } from "../../schemas/YardSchemas.js";
import { planGoalsState, type GoalsStateReport } from "../../services/goals/claim.js";
import { questsActions, type QuestsReport } from "./questsActions.js";
import { defineYardAction, type YardSlices } from "./yardAction.js";

/**
 * `POST /bm/yard/state` — catch the caller's main yard up and return it
 * (`docs/design/yard-buildings.md` §3.2).
 *
 * The action does nothing itself: the wrapper's catch-up is the whole point.
 * The client calls it a second after one of its own countdowns reaches zero,
 * and when the tab becomes visible again (§2.4), and replaces its state with
 * the answer. The catch-up is written, like every other yard action's.
 *
 * **Start-up reads (beta 9, speed-ups item 5).** The yard's first `state`
 * call may name `parts`, the reads the yard's Goals and Quests doors make as
 * they open: `goals` (`goals/state`, on the main yard and the Inferno yard)
 * and `quests` (`quests/state`, main yard only). They run here, in the same
 * lock, catch-up and write, and come back in `report` under their names,
 * each exactly as its own route answers it. A part the yard has not got (an
 * outpost's goals, the Inferno's daily quests) is left out, as is a name this
 * server does not know; the client then asks that route itself. Without
 * `parts` the answer is as before: `report: null`. An older client never
 * sends `parts`, so it sees no change.
 */

/** The parts the start-up read may carry. */
export type StatePart = "goals" | "quests";

/** `report` of a `state` call that named parts; null when it named none. */
export interface StatePartsReport {
  goals?: GoalsStateReport;
  quests?: QuestsReport;
}

/** The quest window's read, its friend check against the database. */
const questsState = questsActions().state;

/** The parts asked for that this yard has, in a fixed order. */
export const partsFor = (raw: string | undefined, type: string | undefined): StatePart[] => {
  const asked = new Set((raw ?? "").split(",").map((part) => part.trim()));
  const parts: StatePart[] = [];
  const main = type === BaseType.MAIN || type === undefined || type === "";
  if (asked.has("goals") && (main || type === BaseType.INFERNO)) parts.push("goals");
  if (asked.has("quests") && main) parts.push("quests");
  return parts;
};

export const yardStateAction = defineYardAction({
  schema: YardStateSchema,
  run: async (input) => {
    const parts = partsFor(input.body.parts, input.save.type);
    if (parts.length === 0) return { report: null as StatePartsReport | null };
    const report: StatePartsReport = {};
    let slices: YardSlices = {};
    if (parts.includes("goals")) {
      const goals = planGoalsState(input.save, input.now);
      report.goals = goals.report;
      if (goals.slices) slices = { ...slices, ...goals.slices };
    }
    if (parts.includes("quests")) {
      const quests = await questsState.run({ ...input, body: {} });
      report.quests = quests.report;
      if (quests.slices) slices = { ...slices, ...quests.slices };
    }
    return { report, ...(Object.keys(slices).length > 0 && { slices }) };
  },
  // The quest window's view again once the catch-up's hatches are counted, as `quests/state` does.
  reportAfterAchievements: (save, report) =>
    report?.quests && questsState.reportAfterAchievements
      ? { ...report, quests: questsState.reportAfterAchievements(save, report.quests) }
      : report,
  outposts: "allow",
  inferno: "allow",
});
