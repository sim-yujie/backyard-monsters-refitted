import { createHash } from "node:crypto";

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
 *
 * **Not sent twice (speed-ups item 6).** Each part comes with its `stamp`,
 * a short hash of the view exactly as sent (the quest view's `now` aside,
 * which moves every second). The client keeps the view and its stamp, and
 * the next time the yard opens (back home from a visit, an attack, the map)
 * names it in `have`; the server builds the view afresh as always (with its
 * writes: the Goals baseline and `done` marks, the quest day's rollover) and,
 * when it hashes the same, answers `{ same: true, stamp }` (and the quests'
 * `now`) instead of the view. Anything that changes what the window shows
 * (a claim, progress, a new day or week) changes the hash, so the view is
 * sent again: the server, not the client, decides.
 */

/** The parts the start-up read may carry. */
export type StatePart = "goals" | "quests";

/** `report` of a `state` call that named parts; null when it named none. */
export interface StatePartsReport {
  goals?: StampedPart<GoalsStateReport>;
  quests?: StampedPart<QuestsReport>;
}

/** A part the client already holds, unchanged. */
export interface SamePart {
  same: true;
  stamp: string;
  /** The quest view's clock, the one field the stamp leaves out. */
  now?: number;
}

/** A part as the answer carries it: the view with its stamp, or {@link SamePart}. */
export type StampedPart<Report> = (Report & { stamp: string }) | SamePart;

/** The hash of a part's view as sent, without the quest view's `now`. */
export const stampOf = (part: StatePart, report: GoalsStateReport | QuestsReport): string => {
  const view =
    part === "quests" ? { ...report, quests: { ...(report as QuestsReport).quests, now: 0 } } : report;
  return createHash("sha1").update(JSON.stringify(view)).digest("base64url").slice(0, 16);
};

/** `have`, read: part name to stamp. */
export const haveOf = (raw: string | undefined): Map<string, string> => {
  const have = new Map<string, string>();
  for (const item of (raw ?? "").split(",")) {
    const [part, stamp] = item.split(":");
    if (part && stamp) have.set(part.trim(), stamp.trim());
  }
  return have;
};

/** The part as sent: unchanged against `have`, or the view and its stamp. */
const stamped = <Report extends GoalsStateReport | QuestsReport>(
  part: StatePart,
  report: Report,
  have: Map<string, string>
): StampedPart<Report> => {
  const stamp = stampOf(part, report);
  if (have.get(part) !== stamp) return { ...report, stamp };
  return part === "quests" ? { same: true, stamp, now: (report as QuestsReport).quests.now } : { same: true, stamp };
};

/** The `have` of a report `run` built, for `reportAfterAchievements` (which sees no body). */
const haveByReport = new WeakMap<object, Map<string, string>>();

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
    const have = haveOf(input.body.have);
    const report: StatePartsReport = {};
    let slices: YardSlices = {};
    if (parts.includes("goals")) {
      const goals = planGoalsState(input.save, input.now);
      report.goals = stamped("goals", goals.report, have);
      if (goals.slices) slices = { ...slices, ...goals.slices };
    }
    if (parts.includes("quests")) {
      const quests = await questsState.run({ ...input, body: {} });
      // Stamped once the catch-up's hatches are counted (below).
      report.quests = { ...quests.report, stamp: "" };
      if (quests.slices) slices = { ...slices, ...quests.slices };
    }
    haveByReport.set(report, have);
    return { report, ...(Object.keys(slices).length > 0 && { slices }) };
  },
  // The quest window's view again once the catch-up's hatches are counted, as
  // `quests/state` does, and only then compared with what the client holds.
  reportAfterAchievements: (save, report) => {
    if (!report?.quests || !questsState.reportAfterAchievements) return report;
    const have = haveByReport.get(report) ?? new Map<string, string>();
    return { ...report, quests: stamped("quests", questsState.reportAfterAchievements(save, report.quests as QuestsReport), have) };
  },
  outposts: "allow",
  inferno: "allow",
});
