import type { ResourceAmounts } from "@/api/friends";
import { formatCompact } from "@/ui/format";
import { resourceIcon } from "../resourceIcon";
import { make } from "./rows";

/*
 * The top of the screen on a friend's yard (beta 8; owner, Review Desk 7,
 * 15 Nov 2026: "resource bar at the top left isnt necessary in other
 * player's yard ... I also dont need to see whose yard it is at the top
 * centre. Just put it at the top left?"; option 1, "reward in the bar").
 *
 * A friend's yard has no readouts (the four resources, coins, Shiny,
 * Workers): the visit bar sits top left where they were, and a help's
 * reward shows in the bar's own line after the helps, "tools, tick, 3,
 * +172.9K" and the four resource pictures.
 */

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
  if (amounts.length === KEYS.length && amounts.every(([, amount]) => amount === first)) {
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
