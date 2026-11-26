import type { SeenStep } from "@/api/seen";
import { seenTitle } from "@/game/friends/friendText";
import { gameIcon } from "@/ui/gameIcon";
import { onlineDot } from "@/ui/onlineDot";
import "./seen.css";

/**
 * "Last seen" on a list row (beta 9; owner picked neon's Direction 1, 26 Nov
 * 2026): the friends window, the Friends tab and the alliance Members tab
 * share this one mark, in one place on each row, so a step looks the same on
 * all three.
 * - Online: the green dot and "Online".
 * - Today / This wk: quiet words.
 * - 1-4w and 1mo+: pills with the painted hourglass; an over-a-month face
 *   fades (`seenDims`).
 * A player who hides their online status and is still active shows nothing.
 */

/** The step's short word on the row; the hover title says it in full. Never "1m" (reads as a minute). */
export const SEEN_SHORT: Readonly<Record<SeenStep, string>> = {
  online: "Online",
  today: "Today",
  week: "This wk",
  weeks: "1-4w",
  month: "1mo+",
};

/** The mark for a row's status slot, or null when nothing shows (hidden and active). */
export const seenMark = (step: SeenStep | null, className = ""): HTMLElement | null => {
  if (step === null) return null;
  const mark = document.createElement("span");
  mark.className = `seen seen--${step} ${className}`.trim();
  mark.title = seenTitle(step);
  mark.setAttribute("role", "img");
  mark.setAttribute("aria-label", seenTitle(step));
  if (step === "online") {
    mark.append(onlineDot("seen__dot", true));
  } else if (step === "weeks" || step === "month") {
    mark.append(gameIcon("time", { size: 16, decorative: true, className: "seen__icon" }));
  }
  const words = document.createElement("span");
  words.className = "seen__words";
  words.textContent = SEEN_SHORT[step];
  words.setAttribute("aria-hidden", "true");
  mark.append(words);
  return mark;
};

/** Whether the row's face fades: over a month. */
export const seenDims = (step: SeenStep | null): boolean => step === "month";
