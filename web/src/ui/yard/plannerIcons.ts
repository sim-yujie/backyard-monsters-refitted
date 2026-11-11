import { gameIcon, type GameIconName } from "@/ui/gameIcon";

/**
 * The faces of the planner's icon buttons (owner, 2026-11-04: "Undo redo can
 * be converted to icon buttons. Same for select, box and find", and Upgrade
 * walls and Re-arm traps as symbols).
 *
 * Each button shows its painted icon from `GAME_ICONS`; the words are its
 * accessible name and tooltip, and a label beside the icon only in a phone's
 * More sheet, which is a list. A button with no entry in {@link PAINTED}
 * falls back to its words in the same square button, so none is ever blank.
 */

/** The icon buttons, by the name their painted icon will have. */
export type PlannerIcon = "undo" | "redo" | "select" | "box" | "find" | "wallupgrade" | "rearm" | "snapshot";

interface Words {
  /** The button's name: its face until it is painted, and its label always. */
  readonly words: string;
  /** A glyph a phone shows instead of the words, where it has one. */
  readonly short?: string;
}

export const PLANNER_ICON_WORDS: Readonly<Record<PlannerIcon, Words>> = {
  undo: { words: "Undo", short: "↶" },
  redo: { words: "Redo", short: "↷" },
  select: { words: "Select" },
  box: { words: "Box" },
  find: { words: "Find" },
  wallupgrade: { words: "Upgrade walls" },
  rearm: { words: "Re-arm traps" },
  // The yard picture (owner, 2026-11-11). No painted camera yet: its words
  // until one is made and added to PAINTED below.
  snapshot: { words: "Yard picture", short: "Picture" },
};

/** A painted icon at the bar's size; the button's own label says the word. */
export const painted =
  (name: GameIconName) =>
  (): HTMLElement =>
    gameIcon(name, { size: 24, decorative: true });

/**
 * Each button's painted icon (art/planner-icons, 4 Nov). The owner picked
 * the second look for select, box and re-arm (`select2`, `box2`, `rearm2`).
 * A button left out of this map shows its words instead.
 */
const PAINTED: Partial<Record<PlannerIcon, () => HTMLElement>> = {
  undo: painted("undo"),
  redo: painted("redo"),
  select: painted("select2"),
  box: painted("box2"),
  find: painted("find"),
  wallupgrade: painted("wallupgrade"),
  rearm: painted("rearm2"),
};

/** Whether a button shows its painted icon rather than its words. */
export const isPainted = (name: PlannerIcon): boolean => PAINTED[name] !== undefined;

/**
 * The inside of an icon button: the painted icon and a label the More sheet
 * shows beside it, or, until the icon is painted, the words (a phone's glyph
 * where `compact` and there is one).
 */
export const iconFace = (name: PlannerIcon, compact = false): HTMLElement => {
  const face = document.createElement("span");
  face.className = "planner-bar__face";
  const entry = PLANNER_ICON_WORDS[name];
  const icon = PAINTED[name];
  if (icon) {
    const label = document.createElement("span");
    label.className = "planner-bar__face-label";
    label.textContent = entry.words;
    face.append(icon(), label);
    return face;
  }
  face.classList.add("planner-bar__face--words");
  face.textContent = compact && entry.short ? entry.short : entry.words;
  return face;
};
