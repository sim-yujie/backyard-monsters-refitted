import type { BadgeTier } from "@/game/achievements/achievements";

/**
 * An achievement's badge. Until the sixteen badges are drawn (#298) it is the
 * placeholder of `docs/design/achievements.md` §10.4: a trophy on a round
 * medal in CSS, bronze, silver or gold by reward, grey while not earned. The
 * art swaps in here, keyed by `id`, without the screen changing.
 */
export const achievementBadge = (id: number, tier: BadgeTier, earned: boolean): HTMLElement => {
  const badge = document.createElement("span");
  badge.className = `ach-badge ach-badge--${tier}`;
  badge.classList.toggle("ach-badge--locked", !earned);
  badge.dataset["achievement"] = String(id);
  badge.setAttribute("aria-hidden", "true");
  const cup = document.createElement("span");
  cup.className = "ach-badge__cup";
  badge.append(cup);
  return badge;
};
