import type { BadgeTier } from "@/game/achievements/achievements";

/** The sixteen shown achievements that have a painted badge (#298). */
const PAINTED = new Set([1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 15, 16, 17, 22]);

/**
 * The painted badge for an achievement: its symbol on a round medal whose rim
 * is bronze, silver or gold by reward, 176 px square, shown at 60 px.
 */
export const badgeArtUrl = (id: number): string => `${import.meta.env.BASE_URL}achievements/badge-${id}.webp`;

/** The CSS medal of `docs/design/achievements.md` §10.4: a cup on a disc in the tier's colour. */
const cup = (): HTMLElement => {
  const element = document.createElement("span");
  element.className = "ach-badge__cup";
  return element;
};

/**
 * An achievement's badge: the painted medal when there is one, else the CSS
 * medal (also its fallback should the picture fail to load). Bronze, silver
 * or gold by reward; grey while not earned.
 */
export const achievementBadge = (id: number, tier: BadgeTier, earned: boolean): HTMLElement => {
  const badge = document.createElement("span");
  badge.className = `ach-badge ach-badge--${tier}`;
  badge.classList.toggle("ach-badge--locked", !earned);
  badge.dataset["achievement"] = String(id);
  badge.setAttribute("aria-hidden", "true");
  if (!PAINTED.has(id)) {
    badge.append(cup());
    return badge;
  }
  badge.classList.add("ach-badge--art");
  const art = document.createElement("img");
  art.className = "ach-badge__art";
  art.src = badgeArtUrl(id);
  art.alt = "";
  art.decoding = "async";
  art.draggable = false;
  art.addEventListener(
    "error",
    () => {
      badge.classList.remove("ach-badge--art");
      art.replaceWith(cup());
    },
    { once: true },
  );
  badge.append(art);
  return badge;
};
