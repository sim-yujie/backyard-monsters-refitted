import type { ResourceCaps, Resources, UpgradeCost } from "@/api/types";

/**
 * What claiming a goal will actually pay (decision Q2 of 2026-10-01, issue
 * #227): every reward is capped at the storage cap and the excess is lost, so
 * the Claim button shows what will arrive ("+1,000 (storage full)"), worked
 * out with the server's rule
 * (`server/src/services/yard/credit.ts` `fitCredit`): each resource fills up
 * to its cap and no further, and a pool already over the cap keeps what it
 * has and takes nothing.
 */

export const REWARD_KEYS = ["r1", "r2", "r3", "r4"] as const;
export type RewardKey = (typeof REWARD_KEYS)[number];

export interface ClaimFigure {
  /** What will land, per resource. */
  readonly credited: UpgradeCost;
  /** Whether any of the reward will not fit. */
  readonly capped: boolean;
}

/**
 * @param reward - The goal's reward.
 * @param resources - The pool now.
 * @param caps - The storage caps; null before the first yard answer, which counts as no cap.
 */
export const claimFigure = (
  reward: UpgradeCost,
  resources: Readonly<Partial<Resources>>,
  caps: ResourceCaps | null,
): ClaimFigure => {
  const credited: UpgradeCost = { r1: 0, r2: 0, r3: 0, r4: 0 };
  let capped = false;
  for (const key of REWARD_KEYS) {
    const amount = Math.max(0, Math.floor(reward[key] || 0));
    const held = Math.floor(Number(resources[key]) || 0);
    const cap = caps?.[key];
    const fits = cap === undefined || cap <= 0 ? amount : Math.max(0, Math.min(amount, cap - held));
    credited[key] = fits;
    if (fits < amount) capped = true;
  }
  return { credited, capped };
};
