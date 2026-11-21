import type { GiftResource } from "@/api/friends";
import { resourceName } from "@/ui/resourceIcon";
import { make } from "./rows";

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
  if (wishes.length === 1) return `${resourceName(wishes[0]!, "surface")} only`;
  return wishes.map((key) => resourceName(key, "surface")).join(" > ");
};
