import { iconAmount } from "@/ui/gameIcon";
import { neighbourBonusLine, neighbourBonusView } from "@/game/maproom/neighbourBonus";

/**
 * Map Room 2's neighbour defence bonus as a painted icon and numbers:
 * "[shield] +11% ×3" (`game/maproom/neighbourBonus.ts`). Null when the cell
 * has none, so nothing shows with the switch off. The map's cell pop-up and
 * the attack screen both use it.
 */
export const neighbourBonusChip = (count: number | undefined, className: string): HTMLElement | null => {
  const view = neighbourBonusView(count);
  if (!view) return null;
  const line = neighbourBonusLine(view);
  const chip = document.createElement("span");
  chip.className = `neighbour-bonus ${className}`;
  chip.title = line;
  chip.setAttribute("role", "note");
  chip.setAttribute("aria-label", line);
  const amount = iconAmount("neighbours", `+${view.percent}%`, { size: 24, tooltip: false, label: "Neighbour defence bonus" });
  const times = document.createElement("span");
  times.className = "neighbour-bonus__count";
  times.textContent = `×${view.count}`;
  times.setAttribute("aria-hidden", "true");
  chip.append(amount, times);
  return chip;
};

/** The cell pop-up's row: the chip in the pop-up's chip row, when the cell has the bonus. */
export const addNeighbourBonusChip = (chips: HTMLElement, payload: { nb?: number }): void => {
  const chip = neighbourBonusChip(payload.nb, "mr2-chip mr2-chip--info mr2-chip--neighbours");
  if (chip) chips.append(chip);
};
