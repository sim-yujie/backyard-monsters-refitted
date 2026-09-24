import type { SkippedUpgrade, UpgradeCost, UpgradeReport } from "@/api/types";
import { typeName } from "@/game/yard/planner/summary";
import { formatAmount, formatCountdown } from "@/ui/format";

/**
 * The words the planner puts on an upgrade cost, an upgrade report and the
 * reasons a planned job did not start.
 *
 * Shared because the same facts are spelled in three places that cannot see
 * each other: the Apply dialog, which reads the *preview* before the click
 * (`PlannerDialogs.applyPanel`); the notice after it, which reads the
 * *server's* report and is raised by `YardScene` because the planner has
 * closed by then and takes its own notices with it; and the checklist's
 * warning rows. Three spellings of "needs Town Hall 8" on one screen read as
 * three different rules.
 *
 * Nothing here touches the DOM. It takes report rows and returns strings.
 */

/** "280.0M twigs and 284.0M pebbles", leaving out whatever cost nothing. */
export const describeCost = (cost: UpgradeCost): string => {
  const parts = [
    cost.r1 > 0 ? `${formatAmount(cost.r1)} twigs` : "",
    cost.r2 > 0 ? `${formatAmount(cost.r2)} pebbles` : "",
    cost.r3 > 0 ? `${formatAmount(cost.r3)} putty` : "",
    cost.r4 > 0 ? `${formatAmount(cost.r4)} goo` : "",
  ].filter(Boolean);

  if (parts.length === 0) return "nothing";
  if (parts.length === 1) return parts[0] as string;
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
};

/**
 * Why one planned upgrade did not start, in the player's terms.
 *
 * Each reason names the thing to do about it rather than the rule that
 * refused it: a shortfall says what is missing, a gate says which building
 * would clear it, and `caughtUp` says the job is already done — which is the
 * one "skip" that is good news.
 */
export const describeSkip = (row: SkippedUpgrade): string => {
  switch (row.reason) {
    case "shortfall":
      return row.shortfall
        ? `short ${describeCost(row.shortfall)}`
        : "not enough resources";
    case "busy":
      return "already on a job";
    case "damaged":
      return "damaged — repair it first";
    case "townHall":
      return row.townHall
        ? `needs Town Hall ${row.townHall.need}${row.townHall.have > 0 ? `, yours is ${row.townHall.have}` : ""}`
        : "needs a Town Hall";
    case "requirements":
      return row.requirements && row.requirements.length > 0
        ? `needs ${row.requirements
            .map(([type, count, level]) => `${count} × ${typeName(type)} at level ${level}`)
            .join(", ")}`
        : "needs buildings it does not have";
    case "caughtUp":
      return "already at that level";
    case "noLadder":
      return "cannot be upgraded";
  }
};

/** "Cannon Tower L1 → L2". */
export const describeStep = (row: { t: number; from?: number; to?: number }): string =>
  row.from === undefined || row.to === undefined
    ? typeName(row.t)
    : `${typeName(row.t)} L${row.from} → L${row.to}`;

/**
 * What Apply's upgrade walk did, as one sentence for a notice.
 *
 * Every clause is left out when its list is empty, so a plan that did exactly
 * what was asked reads "Started 3 upgrades for …" and nothing else. `skipped`
 * is summarised by its first reason and a count rather than itemised: the
 * dialog before the click already listed them one by one, and a notice that
 * runs to eight clauses is not read at all.
 */
export const describeUpgradeReport = (report: UpgradeReport): string => {
  const parts: string[] = [];

  if (report.started.length > 0) {
    parts.push(
      `Started ${report.started.length} ${report.started.length === 1 ? "upgrade" : "upgrades"} for ${describeCost(report.cost)}`,
    );
  } else if (report.finished.length === 0) {
    parts.push("No upgrade started");
  }

  if (report.finished.length > 0) {
    parts.push(
      `${report.finished.length} finished at once${report.started.length === 0 ? ` for ${describeCost(report.cost)}` : ""}`,
    );
  }
  if (report.waiting.length > 0) {
    parts.push(
      `${report.waiting.length} ${report.waiting.length === 1 ? "is" : "are"} waiting for a worker`,
    );
  }
  if (report.skipped.length > 0) {
    const first = report.skipped[0] as SkippedUpgrade;
    parts.push(
      report.skipped.length === 1
        ? `1 skipped: ${describeSkip(first)}`
        : `${report.skipped.length} skipped, the first because it ${describeSkip(first)}`,
    );
  }

  return `${parts.join("; ")}.`;
};

/** "15m 0s", or "instant" for a step the free-finish rule completes. */
export const describeSeconds = (seconds: number): string =>
  seconds <= 0 ? "instant" : formatCountdown(seconds);
