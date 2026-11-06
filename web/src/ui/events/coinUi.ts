import { iconAmount, type IconAmountOptions } from "@/ui/gameIcon";
import { formatAmount } from "@/ui/format";

/**
 * Event coins as the screens show them (beta 7, owner decision 29): the coin
 * icon and the number, "[coin] 300". Decorations are priced in these, and the
 * weekend pop-up and the yard's "+25" use the same helper.
 */
export const coinAmount = (
  amount: number | string,
  options: IconAmountOptions = {},
): HTMLElement =>
  iconAmount("eventcoin", typeof amount === "number" ? formatAmount(amount) : amount, options);

/** "+25" with the coin, green, said as "25 gained". */
export const coinGain = (amount: number, options: IconAmountOptions = {}): HTMLElement =>
  iconAmount("eventcoin", amount, { ...options, change: "gain" });

/** Plain words for an accessible name: "300 event coins". */
export const coinWords = (amount: number): string =>
  `${formatAmount(amount)} event ${amount === 1 ? "coin" : "coins"}`;
