import type { ResourceAmounts } from "@/api/friends";
import { formatCompact } from "@/ui/format";
import { resourceIcon } from "../resourceIcon";
import { make } from "./rows";

/**
 * The top of the screen on a friend's yard (beta 8; owner, Review Desk 7,
 * 15 Nov 2026: "resource bar at the top left isnt necessary in other
 * player's yard ... I also dont need to see whose yard it is at the top
 * centre. Just put it at the top left?").
 *
 * PREVIEW: the owner picks on the desk. `?visitTop=1|2` in a dev build shows
 * an option; without it (and in every production build) the top is as it
 * was: the readouts top left, the visit bar centred under them.
 *
 * Both options take the readouts (the four resources, coins, Shiny, Workers)
 * off a friend's yard and put the visit bar top left. They differ in where a
 * help's reward shows, now that there are no counters to count up:
 *
 * - 1, "in the bar": the bar's own line after the helps, "tools, tick, 3,
 *   +172.9K" and the four resource pictures;
 * - 2, "chip": the bar says "tools, tick, 3" as before, and a slim chip with
 *   the four totals shows beside it (under it on a phone) while they count up.
 */
export type VisitTop = 0 | 1 | 2;

export const visitTopChoice = (): VisitTop => {
  if (!import.meta.env.DEV || typeof location === "undefined") return 0;
  const value = new URLSearchParams(location.search).get("visitTop");
  return value === "1" ? 1 : value === "2" ? 2 : 0;
};

const KEYS = ["r1", "r2", "r3", "r4"] as const;

/** How long a reward stays on the screen once it has counted up. */
export const VISIT_REWARD_MS = 2600;

const amountsOf = (reward: ResourceAmounts): (readonly [(typeof KEYS)[number], number])[] =>
  KEYS.map((key) => [key, Math.max(0, Math.floor(reward[key] ?? 0))] as const).filter(([, amount]) => amount > 0);

/** Counts `node`'s text up to "+amount" over `ms`; at once when `ms` is 0. */
const countUp = (node: HTMLElement, amount: number, ms: number): void => {
  const write = (value: number): void => {
    node.textContent = `+${formatCompact(value)}`;
  };
  if (ms <= 0 || typeof requestAnimationFrame === "undefined") {
    write(amount);
    return;
  }
  const from = performance.now();
  const step = (now: number): void => {
    const t = Math.min(1, (now - from) / ms);
    write(Math.round(amount * (1 - (1 - t) * (1 - t))));
    if (t < 1 && node.isConnected) requestAnimationFrame(step);
    else write(amount);
  };
  write(0);
  requestAnimationFrame(step);
};

export interface RewardNodeOptions {
  /** How long the amounts take to count up; 0 shows them at once. */
  readonly countMs?: number;
  /** One amount for each resource even when the four are the same. */
  readonly each?: boolean;
}

/**
 * A reward as pictures and numbers: "+172.9K" and the four resource
 * pictures when all four got the same, else each picture with its own
 * amount. Null when there is nothing.
 */
export const rewardNode = (reward: ResourceAmounts, options: RewardNodeOptions = {}): HTMLElement | null => {
  const amounts = amountsOf(reward);
  if (amounts.length === 0) return null;
  const node = make("span", "visit-reward");
  const ms = options.countMs ?? 0;
  const first = amounts[0]![1];
  if (!options.each && amounts.length === KEYS.length && amounts.every(([, amount]) => amount === first)) {
    const amount = make("span", "visit-reward__amount");
    countUp(amount, first, ms);
    const icons = make("span", "visit-reward__icons");
    for (const key of KEYS) icons.append(resourceIcon(key, { decorative: true, tooltip: false }));
    node.append(amount, icons);
    return node;
  }
  node.classList.add("visit-reward--each");
  for (const [key, value] of amounts) {
    const pair = make("span", "visit-reward__pair");
    const amount = make("span", "visit-reward__amount");
    countUp(amount, value, ms);
    pair.append(resourceIcon(key, { decorative: true, tooltip: false }), amount);
    node.append(pair);
  }
  return node;
};

/** Option 2's chip: the four totals beside the visit bar, only while a reward shows. */
export class RewardChip {
  readonly element: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.element = make("div", "visit-reward-chip");
    this.element.setAttribute("aria-hidden", "true");
    this.element.hidden = true;
  }

  show(reward: ResourceAmounts, countMs = 0): void {
    const node = rewardNode(reward, { countMs, each: true });
    if (!node) return;
    if (this.timer) clearTimeout(this.timer);
    this.element.replaceChildren(node);
    this.element.hidden = false;
    this.timer = setTimeout(() => this.hide(), countMs + VISIT_REWARD_MS);
  }

  hide(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.element.hidden = true;
  }

  destroy(): void {
    this.hide();
    this.element.remove();
  }
}
