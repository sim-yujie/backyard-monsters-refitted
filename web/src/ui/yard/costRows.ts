import type { ResourceAmounts } from "@/game/yard/planner/summary";
import { formatAmount } from "@/ui/format";

/**
 * The cost rows both batch panels show.
 *
 * One `dt`/`dd` pair per resource the action actually costs, with the shortfall
 * spelled out in words as well as in colour (§4.3: never colour alone). A
 * resource costing nothing gets no row, because a wall upgrade that wants no
 * goo should not have a goo row reading zero.
 *
 * Returns the pairs rather than a list, so each panel keeps its own `dl` and
 * can redraw the rows into it without replacing the element.
 */

/** `r1`..`r4` as the spec names them (docs/specs/base-building.md:573). */
const RESOURCE_LABELS: readonly (readonly [key: keyof ResourceAmounts, label: string])[] = [
  ["r1", "Twigs"],
  ["r2", "Pebbles"],
  ["r3", "Putty"],
  ["r4", "Goo"],
];

export const costRows = (
  cost: ResourceAmounts,
  held: ResourceAmounts,
  shortfall: ResourceAmounts,
): HTMLElement[] => {
  const rows: HTMLElement[] = [];

  for (const [key, label] of RESOURCE_LABELS) {
    const needed = cost[key];
    if (needed === 0) continue;

    const term = document.createElement("dt");
    term.textContent = label;

    const value = document.createElement("dd");
    value.className = "planner-cost__row";
    const short = shortfall[key];
    if (short > 0) value.classList.add("planner-cost__row--short");
    value.textContent =
      short > 0
        ? `${formatAmount(needed)} — you hold ${formatAmount(held[key])}, ${formatAmount(short)} short`
        : `${formatAmount(needed)} of ${formatAmount(held[key])}`;

    rows.push(term, value);
  }

  if (rows.length === 0) {
    const term = document.createElement("dt");
    term.textContent = "Cost";
    const value = document.createElement("dd");
    value.textContent = "Nothing";
    rows.push(term, value);
  }

  return rows;
};
