import type { UpgradeCost } from "@/api/types";
import { formatAmount, formatCountdown } from "@/ui/format";

/**
 * The words the yard puts on an upgrade cost and an upgrade time.
 *
 * Shared so the building panel, the repair block and the planner's wall
 * upgrade spell the same cost the same way.
 *
 * Nothing here touches the DOM. It takes numbers and returns strings.
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

/** "15m 0s", or "instant" for no time at all. */
export const describeSeconds = (seconds: number): string =>
  seconds <= 0 ? "instant" : formatCountdown(seconds);
