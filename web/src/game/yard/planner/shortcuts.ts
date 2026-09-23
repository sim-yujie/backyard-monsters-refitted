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
    case "Escape":
      return { kind: "cancel" };
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
