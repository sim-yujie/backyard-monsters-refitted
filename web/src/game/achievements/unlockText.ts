import { formatAmount } from "@/ui/format";

/**
 * How an unlock is worded (`docs/design/achievements.md` §10.2, issue #204,
 * WP6): on the pop-up card and on the bell's `achievement` line. A bell line
 * is one live unlock or the backfill's together, as the server writes it
 * (`server/src/services/achievements/record.ts` `achievementBatches`).
 */

/** What both read of an unlock. */
export interface UnlockWords {
  readonly name: string;
  readonly shiny: number;
}

/** "+10 Shiny"; empty for none. */
export const shinyText = (shiny: number): string => (shiny > 0 ? `+${formatAmount(shiny)} Shiny` : "");

/** "A, B and C". */
export const nameList = (names: readonly string[]): string =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** The summary card's heading: "3 achievements for what you had already done". */
export const summaryHeading = (count: number): string => `${count} achievements for what you had already done`;

/**
 * A bell line: "Achievement earned: Town Planner, +10 Shiny", or for the
 * backfill's several "3 achievements earned for what you had already done:
 * A, B and C, +25 Shiny".
 */
export const unlockLineText = (unlocks: readonly UnlockWords[], backfill: boolean): string => {
  const shiny = shinyText(unlocks.reduce((sum, unlock) => sum + unlock.shiny, 0));
  const names = nameList(unlocks.map((unlock) => unlock.name));
  const lead =
    backfill && unlocks.length > 1
      ? `${unlocks.length} achievements earned for what you had already done`
      : "Achievement earned";
  return `${lead}: ${names}${shiny === "" ? "" : `, ${shiny}`}`;
};

/**
 * A bell row's `jobs` as `unlockLineText` reads them: each `{ kind:
 * "achievement", id, detail: { name, shiny, backfill? } }`.
 */
export const achievementLineText = (jobs: readonly unknown[]): string => {
  const unlocks: UnlockWords[] = [];
  let backfill = false;
  for (const job of jobs) {
    const { id, detail } = (job ?? {}) as { id?: unknown; detail?: unknown };
    const { name, shiny, backfill: found } = (detail ?? {}) as Record<string, unknown>;
    unlocks.push({
      name: typeof name === "string" && name !== "" ? name : `Achievement ${String(id ?? "")}`.trim(),
      shiny: typeof shiny === "number" && shiny > 0 ? shiny : 0,
    });
    if (found === true) backfill = true;
  }
  return unlocks.length === 0 ? "Achievement earned" : unlockLineText(unlocks, backfill);
};
