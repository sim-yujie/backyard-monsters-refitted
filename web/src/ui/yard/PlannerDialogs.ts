import type { TrapPlacement } from "@/api/types";
import { costOf, sumCosts } from "@/game/yard/buildingCosts";
import type { Checklist } from "@/game/yard/planner/checklist";
import { PlaceBlock, type PlaceCheck } from "@/game/yard/planner/plan";
import { heldResources, isShort, shortfallOf, typeName } from "@/game/yard/planner/summary";
import type { Yard } from "@/game/yard/yardModel";
import { Panel } from "@/ui/Panel";
import { costRows } from "./costRows";

/**
 * The planner's small overlays: the pre-Apply checklist, the trap re-arm
 * confirmation, the shortcut sheet and the banner that reports what a loaded
 * layout could not place.
 *
 * All of them are transient and none of them owns state, so they are plain
 * builders returning an element the scene docks and drops. The checklist is the
 * one that matters (design §3, F17): every failing row lists the buildings it
 * failed on, and clicking one selects it on the canvas.
 */

export interface ChecklistPanelOptions {
  checklist: Checklist;
  /** Selects the building and frames it. */
  onShow: (id: number) => void;
  onClose: () => void;
}

/** The pre-Apply checklist. Blocking rows disable Apply; there are no warnings yet. */
export const checklistPanel = (options: ChecklistPanelOptions): Panel => {
  const panel = new Panel({
    title: "Before applying",
    className: "map-panel planner-checklist",
    onClose: options.onClose,
  });

  const list = document.createElement("ul");
  list.className = "planner-checklist__rows";

  for (const row of options.checklist.rows) {
    const item = document.createElement("li");
    item.className = `planner-checklist__row planner-checklist__row--${row.ok ? "ok" : "bad"}`;

    const heading = document.createElement("p");
    heading.className = "planner-checklist__heading";
    // The mark is a shape as well as a colour, per §4.3.
    heading.textContent = `${row.ok ? "✓" : "✕"} ${row.label}`;
    item.append(heading);

    if (row.items.length > 0) {
      const faults = document.createElement("ul");
      faults.className = "planner-checklist__faults";
      for (const fault of row.items) {
        const entry = document.createElement("li");
        const link = document.createElement("button");
        link.type = "button";
        link.className = "btn btn--ghost planner-checklist__show";
        link.textContent = fault.label;
        link.title = "Select this building";
        link.addEventListener("click", () => options.onShow(fault.id));
        entry.append(link);
        faults.append(entry);
      }
      item.append(faults);
    }

    list.append(item);
  }

  const verdict = document.createElement("p");
  verdict.className = "u-muted";
  verdict.textContent = options.checklist.ok
    ? "Nothing is blocking Apply."
    : "Apply is blocked until these are fixed.";

  panel.setContent(list, verdict);
  return panel;
};

/* ── Trap re-arm ──────────────────────────────────────────────────────── */

export interface RearmPanelOptions {
  /** Every fired trap the planner knows a position for, de-duplicated. */
  traps: readonly TrapPlacement[];
  yard: Yard;
  /** The plan's own placement check: `Plan.canPlace`. */
  canPlace: (type: number, x: number, y: number) => PlaceCheck;
  /** Puts the camera on a spot so the player can clear it. */
  onShow: (trap: TrapPlacement) => void;
  onConfirm: (traps: TrapPlacement[]) => void;
  onClose: () => void;
}

/**
 * The re-arm confirmation (plan §3.4).
 *
 * Re-arming is a build, not a repair: a trap that fires is deleted from the
 * save, so the server allocates a fresh id and charges the full build cost.
 * The panel says so in money before anything is sent.
 *
 * The local placement check is the reason this is a panel rather than a plain
 * confirm. The route is all-or-nothing (§6, Q4), so one trap now standing under
 * a wall the player moved would refuse the whole batch with nothing to look at.
 * Checking the plan's own grid first turns that into a list with a "show me"
 * against each spot, which is something the player can act on.
 */
export const rearmPanel = (options: RearmPanelOptions): Panel => {
  const panel = new Panel({
    title: "Re-arm traps",
    className: "map-panel planner-rearm",
    onClose: options.onClose,
  });

  const blocked = options.traps
    .map((trap) => ({ trap, check: options.canPlace(trap.t, trap.x, trap.y) }))
    .filter((entry) => entry.check.reason !== null);

  const steps = options.traps
    .map((trap) => costOf(trap.t, 0))
    .filter((step): step is NonNullable<typeof step> => step !== null);
  const cost = sumCosts(steps);
  const held = heldResources(options.yard.resources);
  const shortfall = shortfallOf(cost, held);

  const counts = new Map<number, number>();
  for (const trap of options.traps) counts.set(trap.t, (counts.get(trap.t) ?? 0) + 1);

  const heading = document.createElement("p");
  heading.className = "planner-rearm__heading";
  heading.textContent =
    options.traps.length === 0
      ? "No fired traps are waiting."
      : `${options.traps.length} fired ${options.traps.length === 1 ? "trap" : "traps"} to put back: ${[
          ...counts.entries(),
        ]
          .sort((a, b) => a[0] - b[0])
          .map(([type, count]) => `${count} × ${typeName(type)}`)
          .join(", ")}.`;

  const costList = document.createElement("dl");
  costList.className = "cell-facts planner-rearm__costs";
  costList.replaceChildren(...costRows(cost, held, shortfall));

  const note = document.createElement("p");
  note.className = "u-muted";
  note.textContent =
    "Each one is built fresh at its old spot, with a new id and the full build cost. The five-second countdown finishes on the spot.";

  const problems = document.createElement("ul");
  problems.className = "planner-rearm__blocked";
  problems.hidden = blocked.length === 0;

  for (const { trap, check } of blocked) {
    const item = document.createElement("li");

    const text = document.createElement("span");
    text.textContent = `${typeName(trap.t)} at ${trap.x}, ${trap.y} — ${
      check.reason === PlaceBlock.BOUNDS
        ? "outside your yard at its current size"
        : "something is standing there"
    }`;

    const show = document.createElement("button");
    show.type = "button";
    show.className = "btn btn--ghost planner-rearm__show";
    show.textContent = "Show me";
    show.title = "Put the camera on this spot";
    show.addEventListener("click", () => options.onShow(trap));

    item.append(text, show);
    problems.append(item);
  }

  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "btn btn--primary";
  confirm.textContent = "Confirm";
  confirm.disabled = options.traps.length === 0 || blocked.length > 0 || isShort(shortfall);
  confirm.title = confirm.disabled
    ? options.traps.length === 0
      ? "Nothing to put back."
      : blocked.length > 0
        ? "Clear the blocked spots first."
        : "You cannot afford this yet."
    : `Build ${options.traps.length} ${options.traps.length === 1 ? "trap" : "traps"}.`;
  if (!confirm.disabled) {
    confirm.addEventListener("click", () => options.onConfirm([...options.traps]));
  }

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn btn--ghost";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => panel.close());

  const actions = document.createElement("div");
  actions.className = "planner-rearm__actions";
  actions.append(confirm, cancel);

  panel.setContent(heading, costList, note, problems, actions);
  return panel;
};

/** F13's shortcut sheet, listing only what phase 1 actually binds. */
export const shortcutsPanel = (onClose: () => void): Panel => {
  const panel = new Panel({
    title: "Keyboard shortcuts",
    className: "map-panel planner-shortcuts",
    onClose,
  });

  const rows: [string, string][] = [
    ["P", "Enter or leave the planner"],
    ["Tab", "Switch between the 3D yard and the blueprint"],
    ["Click a building", "Pick it up; it follows the pointer until you click again to drop it"],
    ["Right-click", "Put a carried selection back where it was"],
    ["V", "Select tool"],
    ["B", "Box select"],
    ["F", "Find buildings by name or type"],
    ["Shift + drag", "Box select with the select tool"],
    ["Shift + click", "Add or remove one building"],
    ["Arrow keys", "Nudge the selection by one grid step"],
    ["Shift + arrows", "Nudge by ten steps"],
    ["Ctrl + Z", "Undo"],
    ["Ctrl + Shift + Z, Ctrl + Y", "Redo"],
    ["Ctrl + S", "Save to the current slot"],
    ["Escape", "Cancel a drag or carry, or clear the selection"],
    ["Delete", "Nothing yet — storing arrives with the store tool"],
  ];

  const list = document.createElement("dl");
  list.className = "cell-facts";
  for (const [key, meaning] of rows) {
    const term = document.createElement("dt");
    term.textContent = key;
    const value = document.createElement("dd");
    value.textContent = meaning;
    list.append(term, value);
  }

  panel.setContent(list);
  return panel;
};

export interface BannerOptions {
  message: string;
  level?: "info" | "warning" | "error";
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
}

/**
 * The strip that reports what a load could not place (design §8, Q8).
 *
 * It names the count and the expansion level the layout was designed for, and
 * it never offers to place anything automatically — Q4 forbids it, because a
 * building left where it is can be sitting on the cells the layout wants.
 */
export const banner = (options: BannerOptions): HTMLElement => {
  const element = document.createElement("div");
  element.className = `planner-banner planner-banner--${options.level ?? "warning"}`;
  element.setAttribute("role", "status");

  const text = document.createElement("span");
  text.textContent = options.message;
  element.append(text);

  if (options.actionLabel && options.onAction) {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "btn btn--ghost";
    action.textContent = options.actionLabel;
    action.addEventListener("click", options.onAction);
    element.append(action);
  }

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "btn btn--ghost btn--icon";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.textContent = "×";
  dismiss.addEventListener("click", options.onDismiss);
  element.append(dismiss);

  return element;
};
