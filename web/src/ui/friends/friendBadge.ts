import type { FriendMark } from "@/game/friends/friendMarks";
import { gameIcon, type GameIconSize } from "@/ui/gameIcon";
import "./friend-badge.css";

/**
 * The friend marker beside a player's name or on their portrait (beta 7):
 * the painted two monster heads (`friends`) in a round frame, and for a
 * friend pinned to the top of the list a gold frame. Used wherever players
 * are listed: the Map Room 1 list, pins and card, the Map Room 2 hover card
 * and yard popup, and the profile. The Map Room 2 map draws its own copy in
 * the canvas (`game/maproom/MapChunk.ts`).
 */

export const FRIEND_MARK_TEXT: Readonly<Record<NonNullable<FriendMark>, string>> = {
  friend: "Friend",
  pinned: "Pinned friend",
};

/** The marker for `mark`, or null for none, `size` px (16 by default). */
export const friendBadge = (mark: FriendMark, size: GameIconSize = 16, className = ""): HTMLElement | null => {
  if (mark === null) return null;
  const badge = document.createElement("span");
  badge.className = `friend-badge friend-badge--${mark}${className ? ` ${className}` : ""}`;
  badge.dataset["friend"] = mark;
  badge.title = FRIEND_MARK_TEXT[mark];
  badge.setAttribute("role", "img");
  badge.setAttribute("aria-label", FRIEND_MARK_TEXT[mark]);
  badge.append(gameIcon("friends", { size, decorative: true }));
  return badge;
};
