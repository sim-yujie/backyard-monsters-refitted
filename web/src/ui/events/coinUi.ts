import { iconAmount, type IconAmountOptions } from "@/ui/gameIcon";
import { formatAmount } from "@/ui/format";

/**
 * Event coins as the screens show them (beta 7, owner decision 29): the coin
 * icon and the number, "[coin] 300". Decorations are priced in these, and the
 * top bar, the Events page and the yard's "+15" use the same helper.
 */
export const coinAmount = (
  amount: number | string,
  options: IconAmountOptions = {},
): HTMLElement =>
  iconAmount("eventcoin", typeof amount === "number" ? formatAmount(amount) : amount, options);

/** Plain words for an accessible name: "300 Glimmers" (the owner's name for event coins, 8 Nov). */
export const coinWords = (amount: number): string =>
  `${formatAmount(amount)} ${amount === 1 ? "Glimmer" : "Glimmers"}`;
