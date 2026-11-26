import type { SeenStep } from "@/api/seen";
import { onlineText, seenTitle } from "@/game/friends/friendText";
import { gameIcon, type GameIconName } from "@/ui/gameIcon";
import { onlineDot } from "@/ui/onlineDot";
import "./seen.css";

/**
 * "Last seen" on a list row (beta 9): the friends window, the Friends tab and
 * the alliance Members tab share these marks, so a step looks the same on
 * all three.
 *
 * PHASE 1 SAMPLES (lead decides with the owner): three looks from neon's
 * design advice, picked with `?seenLook=a|b|c` until the owner chooses one;
 * phase 2 keeps the chosen one and drops the switch.
 * - **a**, quiet active, painted dormancy: Today / This wk as quiet words;
 *   1-4w and 1mo+ as pills with the painted hourglass; an over-a-month face
 *   dims.
 * - **b**, the face says it: the online dot or the painted hourglass on the
 *   face's corner, short words beside; an over-a-month face dims.
 * - **c**, painted seals: a painted seal before every word.
 */
export type SeenLook = "a" | "b" | "c";

/** The sample look in use: `?seenLook=b` or `c`, else `a`. */
export const seenLook = (): SeenLook => {
  try {
    const wanted = new URLSearchParams(globalThis.location?.search ?? "").get("seenLook");
    if (wanted === "b" || wanted === "c") return wanted;
  } catch {
    // No address to read (tests): the first look.
  }
  return "a";
};

/** The step's short word on the row; the hover title says it in full. */
export const SEEN_SHORT: Readonly<Record<SeenStep, string>> = {
  online: "Online",
  today: "Today",
  week: "This wk",
  weeks: "1-4w",
  month: "1mo+",
};

const classic = (): boolean => document.documentElement.dataset["skin"] === "flash";

/** Look c's seal for each step (Classic has its own painted set). */
const sealOf = (step: SeenStep): GameIconName | null => {
  switch (step) {
    case "today":
      return classic() ? "habitactiveclassic" : "habitactive";
    case "week":
      return classic() ? "habitunprovenclassic" : "habitunproven";
    case "weeks":
      return "time";
    case "month":
      return classic() ? "habitfadedclassic" : "habitfaded";
    default:
      return null;
  }
};

export interface SeenMarkOptions {
  /** Leave Online out of the words: the row already shows the dot on the face. */
  readonly onlineOnFace?: boolean;
  readonly className?: string;
}

/**
 * The words-and-picture mark for a row's text slot, or null when nothing
 * shows (hidden, or online on a row whose face carries the dot).
 */
export const seenMark = (step: SeenStep | null, look: SeenLook = seenLook(), options: SeenMarkOptions = {}): HTMLElement | null => {
  if (step === null) return null;
  const onlineOnFace = options.onlineOnFace || look === "b";
  if (step === "online" && onlineOnFace) return null;
  const mark = document.createElement("span");
  mark.className = `seen seen--${look} seen--${step} ${options.className ?? ""}`.trim();
  mark.title = seenTitle(step);
  mark.setAttribute("role", "img");
  mark.setAttribute("aria-label", seenTitle(step));
  if (step === "online") {
    mark.append(onlineDot("seen__dot", true));
  } else if (look === "a" && (step === "weeks" || step === "month")) {
    mark.append(gameIcon("time", { size: 16, decorative: true, className: "seen__icon" }));
  } else if (look === "c") {
    const seal = sealOf(step);
    if (seal) mark.append(gameIcon(seal, { size: 16, decorative: true, className: "seen__icon" }));
  }
  const words = document.createElement("span");
  words.className = "seen__words";
  words.textContent = SEEN_SHORT[step];
  words.setAttribute("aria-hidden", "true");
  mark.append(words);
  return mark;
};

/**
 * Look b's mark on the face's corner: the online dot, or the painted
 * hourglass for 1-4 weeks and over a month. Null for the other steps and looks.
 */
export const seenFaceMark = (step: SeenStep | null, look: SeenLook = seenLook()): HTMLElement | null => {
  if (look !== "b" || step === null) return null;
  if (step === "online") return onlineDot("seen-face seen-face--online");
  if (step !== "weeks" && step !== "month") return null;
  const glass = gameIcon("time", { size: 16, label: seenTitle(step), className: `seen-face seen-face--${step}` });
  glass.title = seenTitle(step);
  return glass;
};

/** Whether the row's face fades: over a month, in looks a and b. */
export const seenDims = (step: SeenStep | null, look: SeenLook = seenLook()): boolean => step === "month" && look !== "c";

/** The plain words for a step, for places that only want text. */
export const seenWords = (step: SeenStep | null): string => onlineText(step);
