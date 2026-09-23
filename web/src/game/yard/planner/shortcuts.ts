import { GRID_STEP } from "./placement";

/**
 * The planner's keyboard map (design §3, F13), as a pure lookup.
 *
 * A `KeyboardEvent` goes in and an action goes out, or null when the planner
 * does not want the key. Keeping the map apart from the session means the
 * bindings can be tested without a canvas, and the shortcut sheet in
 * `PlannerDialogs.ts` and the handler can never drift apart by more than a
 * review — there is one switch, not one per surface.
 *
 * Ctrl+S is deliberately absent: saving belongs to the layouts panel, which
 * owns the slot and the name, and it listens for that combination itself.
 */

export type PlannerAction =
  | { readonly kind: "tool"; readonly tool: "select" | "box" }
  | { readonly kind: "nudge"; readonly dx: number; readonly dy: number }
  | { readonly kind: "undo" }
  | { readonly kind: "redo" }
  | { readonly kind: "cancel" }
  /** Tab: switch between the isometric yard and the blueprint. */
  | { readonly kind: "view" }
  /** F: open the search box. Takes the key off the browser's own find bar. */
  | { readonly kind: "find" }
  /**
   * M mirrors the selection left to right, which is the binding F13's table
   * names. Shift+M is the same operation on the other axis: the toolbar offers
   * both and a player who has learned one will try the other.
   */
  | { readonly kind: "mirror"; readonly axis: "x" | "y" }
  /** Bound so it cannot reach the browser; storing arrives in phase 2. */
  | { readonly kind: "ignore" };

/** A key event's meaning inside the planner, or null to let it through. */
export const plannerAction = (event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): PlannerAction | null => {
  if (event.ctrlKey || event.metaKey) {
    const key = event.key.toLowerCase();
    if (key === "z") return event.shiftKey ? { kind: "redo" } : { kind: "undo" };
    if (key === "y") return { kind: "redo" };
    return null;
  }

  // Shift multiplies the nudge by ten, which is what turns arrow keys from a
  // fiddle into a way to cross the yard.
  const step = event.shiftKey ? GRID_STEP * 10 : GRID_STEP;

  switch (event.key) {
    case "v":
    case "V":
      return { kind: "tool", tool: "select" };
    case "b":
    case "B":
      return { kind: "tool", tool: "box" };
    // Plain F only: Ctrl+F is caught above and left to the browser, and a key
    // typed into the search box never reaches here (`PlannerInput`).
    case "f":
    case "F":
      return { kind: "find" };
    // The two cases are deliberately not folded together: Shift is the axis
    // here rather than a modifier on one action, so `M` is not `m`.
    case "m":
      return { kind: "mirror", axis: "x" };
    case "M":
      return { kind: "mirror", axis: "y" };
    case "Escape":
      return { kind: "cancel" };
    case "Tab":
      return { kind: "view" };
    case "ArrowUp":
      return { kind: "nudge", dx: 0, dy: -step };
    case "ArrowDown":
      return { kind: "nudge", dx: 0, dy: step };
    case "ArrowLeft":
      return { kind: "nudge", dx: -step, dy: 0 };
    case "ArrowRight":
      return { kind: "nudge", dx: step, dy: 0 };
    case "Delete":
    case "Backspace":
      return { kind: "ignore" };
    default:
      return null;
  }
};
