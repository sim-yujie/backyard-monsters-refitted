import { formatAmount, formatCompact } from "./format";

/**
 * Whether an amount is something that happened to the player: resources won
 * or collected (`gain`), taken or sent away (`loss`). Owner, 28 Oct: "−300"
 * in red for what you lost, "+300" in green for what you got. A price or a
 * stock level ("15M/15M", an upgrade's cost) is neither and stays plain.
 *
 * The sign carries the meaning, for a player who cannot tell the red from the
 * green; a screen reader hears "300 lost" or "300 gained" instead of "minus".
 */
export type AmountChange = "gain" | "loss";

/** The word a screen reader and a tooltip say after the number. */
export const AMOUNT_CHANGE_WORDS: Readonly<Record<AmountChange, string>> = { gain: "gained", loss: "lost" };

/** "+" for a gain, a true minus sign "−" (not a hyphen) for a loss. */
export const AMOUNT_CHANGE_SIGNS: Readonly<Record<AmountChange, string>> = { gain: "+", loss: "−" };

/** How an amount is spelled, and whether it is a gain or a loss. */
export interface AmountValueOptions {
  /** Spell a number short ("15.0M") instead of in full ("15,000,000"). */
  readonly compact?: boolean;
  readonly change?: AmountChange;
  /** `false` leaves hover to an ancestor whose own `title` says more. */
  readonly tooltip?: boolean;
}

type AmountBlock = "icon-amount" | "res-amount";

/**
 * Writes `amount` into an `.icon-amount` or `.res-amount` (`block`): into its
 * `__value`, made here when it has none, so a readout that ticks (the attack
 * screen's loot) can call it again with each new amount.
 *
 * A number is spelled in full unless `compact`; a string is taken as already
 * spelled. With a `change`, the shown number gets its sign and colour
 * (`ui.css`) and hides from a screen reader, which reads "300 lost" from a
 * visually hidden twin instead. Nothing at all is no gain or loss: "0" stays
 * plain.
 */
export const writeAmount = (
  wrapper: HTMLElement,
  block: AmountBlock,
  amount: number | string,
  options: AmountValueOptions = {},
): void => {
  let value = wrapper.querySelector<HTMLElement>(`:scope > .${block}__value`);
  if (!value) {
    value = document.createElement("span");
    value.className = `${block}__value`;
    wrapper.append(value);
  }
  let said = wrapper.querySelector<HTMLElement>(`:scope > .${block}__said`);
  const format = options.compact ? formatCompact : formatAmount;
  // A loss is told by its sign, so "-300" and 300 are the same 300 lost.
  const unsigned = typeof amount === "string" ? amount.replace(/^[+\-−]\s*/, "") : format(Math.abs(amount));
  const change = options.change && !/^0(\.0+)?$/.test(unsigned) ? options.change : undefined;
  wrapper.classList.remove(`${block}--gain`, `${block}--loss`);
  if (!change) {
    delete wrapper.dataset["change"];
    value.textContent = typeof amount === "string" ? amount : format(amount);
    value.removeAttribute("aria-hidden");
    value.removeAttribute("title");
    said?.remove();
    return;
  }
  wrapper.classList.add(`${block}--${change}`);
  wrapper.dataset["change"] = change;
  const spoken = `${unsigned} ${AMOUNT_CHANGE_WORDS[change]}`;
  value.textContent = `${AMOUNT_CHANGE_SIGNS[change]}${unsigned}`;
  value.setAttribute("aria-hidden", "true");
  if (options.tooltip !== false) value.title = spoken;
  if (!said) {
    said = document.createElement("span");
    said.className = `${block}__said u-visually-hidden`;
    value.after(said);
  }
  said.textContent = spoken;
};
