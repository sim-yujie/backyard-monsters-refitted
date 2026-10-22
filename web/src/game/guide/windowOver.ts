import { isPopupOver } from "@/ui/Popup";
import type { BlockQuestion } from "./TipRunner";

/**
 * Whether a window covers the tips' screen without holding what the tip points
 * at: a popup (the Leaderboard, Report a bug), or a panel opened on the
 * screen itself (the Shop once its own tips are done, Friends and
 * Achievements over the yard on a phone). A tip pointing into the window (the
 * Starter Kits picker) still shows. Bob's tips wait while one does
 * (`game/yard/plugins/tips.ts`).
 */
export const windowOver = ({ root, target }: BlockQuestion): boolean => {
  const at = target ?? root;
  if (isPopupOver(at)) return true;
  return [...root.children].some(
    (child) => child instanceof HTMLElement && child.classList.contains("panel") && !child.hidden && !child.contains(at),
  );
};
