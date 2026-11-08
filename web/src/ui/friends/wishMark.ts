import type { GiftResource } from "@/api/friends";
import { RESOURCE_NAMES } from "@/ui/resourceIcon";
import { make } from "./rows";

/**
 * The gift wish marker (#391, owner 7 Nov: "just star? thats so plain"): a
 * Codex-painted gold star rosette (`public/friends/wish-mark.webp`, kit in
 * `tools/wish-mark-codex`) with the wish's rank, 1 to 3, in white on its red
 * centre. Drawn by `friends.css` (`.wish-mark`); the picture is a background
 * so the rank is ordinary text on top of it.
 */
export const WISH_MARK_URL = "/friends/wish-mark.webp";

/** The marker; `rank` (1-3) on its centre, or a bare marker for a legend. */
export const wishMark = (rank: number | null = null, className?: string): HTMLElement => {
  const mark = make("span", className ? `wish-mark ${className}` : "wish-mark");
  mark.setAttribute("aria-hidden", "true");
  if (rank !== null) mark.append(make("span", "wish-mark__rank", String(rank)));
  return mark;
};

/**
 * Wishes are ranked (owner 7 Nov): the order picked is the order wanted, and a
 * single wish means "that one only". Old saved wishes (kept in resource order)
 * read the same way, so nothing needs moving.
 */
export const wishesSummary = (wishes: readonly GiftResource[]): string => {
  if (wishes.length === 0) return "";
  if (wishes.length === 1) return `${RESOURCE_NAMES[wishes[0]!]} only`;
  return wishes.map((key) => RESOURCE_NAMES[key]).join(" > ");
};
