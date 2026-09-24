import type { TrapPlacement, UpgradeCost } from "@/api/types";
import { costOf, sumCosts } from "@/game/yard/buildingCosts";
import type { Checklist } from "@/game/yard/planner/checklist";
import { MissReason, type LoadMiss } from "@/game/yard/planner/layout";
import { PlaceBlock, type PlaceCheck } from "@/game/yard/planner/plan";
import { heldResources, isShort, shortfallOf, typeName } from "@/game/yard/planner/summary";
import type { ApplyPreview } from "@/game/yard/planner/upgrades";
import type { Yard } from "@/game/yard/yardModel";
import { formatAmount, formatCountdown } from "@/ui/format";
import { Panel } from "@/ui/Panel";
import { costRows } from "./costRows";
import { describeCost, describeSkip, describeStep } from "./upgradeText";

/**
 * The planner's small overlays: the pre-Apply checklist, the Apply dialog, the
 * list of what a loaded layout could not place, the trap re-arm confirmation,
 * the shortcut sheet and the banner.
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

/**
 * The pre-Apply checklist.
 *
 * Blocking rows disable Apply. Warning rows do not: the upgrade half of Apply
 * is partial by design (`docs/design/planner-upgrades.md` §5.5), so "not
 * enough workers" is a thing to know before the click and never a reason to
 * refuse the moves. They are drawn with their own mark and their own colour,
 * because a red cross against a job that will simply start later reads as a
 * broken plan.
 */
export const checklistPanel = (options: ChecklistPanelOptions): Panel => {
  const panel = new Panel({
    title: "Before applying",
    className: "map-panel planner-checklist",
    onClose: options.onClose,
  });

  const list = document.createElement("ul");
  list.className = "planner-checklist__rows";

  for (const row of options.checklist.rows) {
    const state = row.ok ? "ok" : row.warning ? "warn" : "bad";
    const item = document.createElement("li");
    item.className = `planner-checklist__row planner-checklist__row--${state}`;

    const heading = document.createElement("p");
    heading.className = "planner-checklist__heading";
    // The mark is a shape as well as a colour, per §4.3, and the third shape
    // is what keeps a warning from reading as a refusal.
    heading.textContent = `${state === "ok" ? "✓" : state === "warn" ? "!" : "✕"} ${row.label}`;
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

  const warnings = options.checklist.rows.filter((row) => row.warning && !row.ok).length;
  const verdict = document.createElement("p");
  verdict.className = "u-muted";
  verdict.textContent = !options.checklist.ok
    ? "Apply is blocked until the crossed rows are fixed."
    : warnings > 0
      ? `Nothing is blocking Apply. ${warnings} ${warnings === 1 ? "warning" : "warnings"}: Apply will still run and report what it could not start.`
      : "Nothing is blocking Apply.";

  panel.setContent(list, verdict);
  return panel;
};

/* ── Apply ────────────────────────────────────────────────────────────── */

export interface ApplyPanelOptions {
  /** How many buildings the layout would move. */
  moved: number;
  /** What Apply would do with the plan, from `PlannerSession.applyPreview`. */
  preview: ApplyPreview;
  /** The slot the plan was loaded from, or null when none is. */
  slotName: string | null;
  /** True when the plan has edits the slot does not carry. */
  dirty: boolean;
  /** Opens the layouts panel, for a plan that belongs to no slot yet. */
  onSaveAs: () => void;
  onConfirm: (choice: { startUpgrades: boolean; saveFirst: boolean }) => void;
  onClose: () => void;
}

/**
 * The Apply dialog (design §4.5, `docs/design/planner-upgrades.md` §5.5).
 *
 * Apply is one request that both moves the buildings and starts the jobs (§8,
 * Q1), and the upgrade half of it is **partial by design** (§3.2): the server
 * starts as many as there are free workers and resources and reports the rest.
 * That is only fair if it is said before the click, so this panel runs the
 * client's copy of the server's walk and itemises the answer — what starts,
 * what finishes on the spot, what waits for a worker, what cannot start at all
 * and why, what it costs and what is left afterwards.
 *
 * A plan with nothing upgraded gets the one-line moves summary and no
 * itemisation, which is what §4.5 asks for: moves alone need no dialog beyond
 * a sentence.
 *
 * ## Save first
 *
 * Apply closes the planner (§8, Q4) and the jobs it could not start stay in
 * the *layout*, not in the yard. So a plan that came from a slot offers to
 * write itself back first, ticked, and a plan with no slot is told plainly
 * that its waiting upgrades live only in a saved layout.
 */
export const applyPanel = (options: ApplyPanelOptions): Panel => {
  const panel = new Panel({
    title: "Apply this plan",
    className: "map-panel planner-apply",
    onClose: options.onClose,
  });

  const preview = options.preview;
  const planned =
    preview.started.length +
    preview.finished.length +
    preview.waiting.length +
    preview.skipped.length;

  const heading = document.createElement("p");
  heading.className = "planner-apply__heading";
  heading.textContent =
    options.moved === 0
      ? "Nothing will move."
      : `${options.moved} ${options.moved === 1 ? "building" : "buildings"} will move.`;

  const startBox = checkbox(
    "Start the planned upgrades now",
    "Leave this off to move the buildings and start nothing. The plans stay where they are.",
  );
  startBox.input.checked = true;
  startBox.label.hidden = planned === 0;

  const lists = document.createElement("div");
  lists.className = "planner-apply__lists";

  const totals = document.createElement("dl");
  totals.className = "cell-facts planner-apply__totals";

  const saveBox = checkbox(
    options.slotName ? `Save to “${options.slotName}” first` : "Save this layout first",
    "Upgrades that have to wait for a worker are kept in the saved layout, not in the yard.",
  );
  const canSave = options.slotName !== null && options.dirty;
  saveBox.input.checked = canSave;
  saveBox.label.hidden = !canSave;

  const saveNote = document.createElement("p");
  saveNote.className = "planner-apply__save-note u-muted";
  saveNote.hidden = canSave || planned === 0;
  saveNote.textContent =
    options.slotName === null
      ? "Waiting upgrades are kept only in a saved layout."
      : `“${options.slotName}” already matches this plan.`;

  const saveAs = document.createElement("button");
  saveAs.type = "button";
  saveAs.className = "btn btn--ghost planner-apply__save-as";
  saveAs.textContent = "Save as…";
  saveAs.title = "Open the layout slots and keep this plan in one.";
  saveAs.hidden = options.slotName !== null || planned === 0;
  saveAs.addEventListener("click", options.onSaveAs);

  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "btn btn--primary";
  confirm.textContent = "Apply";
  confirm.addEventListener("click", () => {
    options.onConfirm({
      startUpgrades: planned > 0 && startBox.input.checked,
      saveFirst: canSave && saveBox.input.checked,
    });
  });

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn btn--ghost";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => panel.close());

  const actions = document.createElement("div");
  actions.className = "planner-apply__actions";
  actions.append(confirm, cancel);

  const render = (): void => {
    const on = planned > 0 && startBox.input.checked;
    lists.hidden = !on;
    totals.hidden = !on;
    if (!on) {
      lists.replaceChildren();
      totals.replaceChildren();
      return;
    }

    lists.replaceChildren(
      ...upgradeList(
        `${preview.started.length} ${preview.started.length === 1 ? "upgrade starts" : "upgrades start"} now`,
        preview.started.map(
          (row) =>
            `${describeStep(row)} — ${describeCost(row.cost)}, ${formatCountdown(row.seconds)}`,
        ),
        "start",
      ),
      ...upgradeList(
        `${preview.finished.length} ${preview.finished.length === 1 ? "finishes" : "finish"} at once`,
        preview.finished.map((row) => `${describeStep(row)} — ${describeCost(row.cost)}`),
        "finish",
      ),
      ...upgradeList(
        `${preview.waiting.length} ${preview.waiting.length === 1 ? "waits" : "wait"} for a free worker`,
        preview.waiting.map((row) => describeStep(row)),
        "wait",
      ),
      ...upgradeList(
        `${preview.skipped.length} cannot start`,
        preview.skipped.map((row) => `${describeStep(row)} — ${describeSkip(row)}`),
        "skip",
      ),
    );

    totals.replaceChildren(
      ...amountRows("Total deducted now", preview.cost),
      ...amountRows("You will have left", preview.remaining),
    );
  };

  startBox.input.addEventListener("change", render);
  render();

  panel.setContent(heading, startBox.label, lists, totals, saveBox.label, saveNote, saveAs, actions);
  return panel;
};

/** One titled list of report rows, or nothing at all when it is empty. */
const upgradeList = (
  title: string,
  rows: readonly string[],
  kind: string,
): HTMLElement[] => {
  if (rows.length === 0) return [];

  const heading = document.createElement("p");
  heading.className = `planner-apply__list-title planner-apply__list-title--${kind}`;
  heading.textContent = title;

  const list = document.createElement("ul");
  list.className = "planner-apply__list";
  for (const row of rows) {
    const item = document.createElement("li");
    item.textContent = row;
    list.append(item);
  }
  return [heading, list];
};

/** "Total deducted now: 21.0M twigs, 15.8M pebbles", one `dt`/`dd` pair. */
const amountRows = (label: string, cost: UpgradeCost): HTMLElement[] => {
  const term = document.createElement("dt");
  term.textContent = label;
  const value = document.createElement("dd");
  value.textContent = [
    cost.r1 > 0 ? `${formatAmount(cost.r1)} twigs` : "",
    cost.r2 > 0 ? `${formatAmount(cost.r2)} pebbles` : "",
    cost.r3 > 0 ? `${formatAmount(cost.r3)} putty` : "",
    cost.r4 > 0 ? `${formatAmount(cost.r4)} goo` : "",
  ]
    .filter(Boolean)
    .join(", ") || "nothing";
  return [term, value];
};

/** A labelled checkbox, returned as the label that wraps it and the input. */
const checkbox = (
  text: string,
  title: string,
): { label: HTMLLabelElement; input: HTMLInputElement } => {
  const label = document.createElement("label");
  label.className = "planner-apply__check";
  label.title = title;

  const input = document.createElement("input");
  input.type = "checkbox";

  const span = document.createElement("span");
  span.textContent = text;

  label.append(input, span);
  return { label, input };
};

/* ── What a load could not place (issue #17) ──────────────────────────── */

/** Why one saved node stayed where it was, in the player's terms. */
export const describeMiss = (reason: MissReason): string =>
  reason === MissReason.BOUNDS
    ? "outside your yard at its current size"
    : "blocked by a building the layout does not move";

/** What a load left behind, in the counts the banner spells out. */
export interface LoadProblems {
  /** The layout's name, as it is shown in quotes. */
  readonly name: string;
  /** The expansion the layout was designed for. */
  readonly layoutExpansion: number;
  /** The expansion this account has now. */
  readonly yardExpansion: number;
  /** Saved nodes that stayed where they were. */
  readonly didNotFit: number;
  /** Saved nodes this yard has no building for. */
  readonly missing: number;
  /** Planned upgrades the layout carried that this yard cannot do. */
  readonly plansDropped: number;
}

/**
 * The banner sentence for a load that could not do everything the layout
 * asked (issue #17, design §8, Q8).
 *
 * Both expansions, not just the layout's: "designed for expansion 4, you are
 * at 2" names a cause the player can act on, where "designed for expansion 4"
 * alone is a number with nothing to compare it to. The clause is left out when
 * the plot is not the reason, because a layout for the same expansion can
 * still be blocked by a building it does not move.
 *
 * Returns null when there is nothing to report, which is what the caller uses
 * to decide whether to raise a banner at all.
 */
export const describeLoadProblems = (problems: LoadProblems): string | null => {
  const parts: string[] = [];
  const { didNotFit, missing, plansDropped } = problems;

  if (didNotFit > 0) {
    parts.push(
      `${didNotFit} ${plural(didNotFit, "building")} did not fit and ${didNotFit === 1 ? "was" : "were"} left where ${didNotFit === 1 ? "it" : "they"} stood`,
    );
  }
  if (missing > 0) {
    parts.push(`${missing} saved ${plural(missing, "building")} no longer in this yard`);
  }
  if (plansDropped > 0) {
    parts.push(
      `${plansDropped} planned ${plural(plansDropped, "upgrade")} ${plansDropped === 1 ? "was" : "were"} dropped because those buildings have caught up or are on a job`,
    );
  }
  if (parts.length === 0) return null;

  const where =
    problems.layoutExpansion > problems.yardExpansion
      ? `“${problems.name}” was designed for expansion ${problems.layoutExpansion} and you are at ${problems.yardExpansion}`
      : `“${problems.name}” was designed for expansion ${problems.layoutExpansion}`;

  // The tail is about buildings standing in the wrong place, so a load whose
  // only complaint is a dropped upgrade plan does not get it — there is
  // nothing to move.
  const tail =
    didNotFit > 0 || missing > 0
      ? " Nothing was placed for you — move or remove them yourself."
      : "";
  return `${where}: ${parts.join("; ")}.${tail}`;
};

const plural = (count: number, word: string): string => (count === 1 ? word : `${word}s`);

export interface DidNotFitPanelOptions {
  misses: readonly LoadMiss[];
  /** The expansion the layout was designed for. */
  layoutExpansion: number;
  /** The expansion this account has now. */
  yardExpansion: number;
  /** Selects the building and frames it. */
  onShow: (id: number) => void;
  onClose: () => void;
}

/**
 * What a loaded layout could not place, one building at a time (issue #17).
 *
 * The banner can only carry a count, and a count is not something a player can
 * act on: "seven did not fit" leaves them hunting. Each row here names the
 * building, says which of the two things went wrong — the plot is smaller than
 * the layout expected, or something the layout does not move is standing there
 * — and offers to select and frame it, which is the same "show me" the
 * checklist uses.
 *
 * Nothing is placed for the player, per §8, Q4: a building left where it stands
 * can be sitting on the very cells the layout wants, so guessing would hide a
 * collision rather than resolve one.
 */
export const didNotFitPanel = (options: DidNotFitPanelOptions): Panel => {
  const panel = new Panel({
    title: "Did not fit",
    className: "map-panel planner-misfits",
    onClose: options.onClose,
  });

  const heading = document.createElement("p");
  heading.className = "planner-misfits__heading";
  heading.textContent =
    options.layoutExpansion > options.yardExpansion
      ? `This layout was designed for expansion ${options.layoutExpansion} and you are at ${options.yardExpansion}, so ${options.misses.length} ${options.misses.length === 1 ? "building" : "buildings"} stayed where ${options.misses.length === 1 ? "it" : "they"} stood.`
      : `${options.misses.length} ${options.misses.length === 1 ? "building" : "buildings"} stayed where ${options.misses.length === 1 ? "it" : "they"} stood.`;

  const list = document.createElement("ul");
  list.className = "planner-misfits__rows";

  for (const miss of options.misses) {
    const item = document.createElement("li");
    item.className = "planner-misfits__row";

    const text = document.createElement("span");
    text.textContent = `${typeName(miss.type)} — ${describeMiss(miss.reason)}`;

    const show = document.createElement("button");
    show.type = "button";
    show.className = "btn btn--ghost planner-misfits__show";
    show.textContent = "Show me";
    show.title = "Select this building and put the camera on it";
    show.addEventListener("click", () => options.onShow(miss.id));

    item.append(text, show);
    list.append(item);
  }

  const note = document.createElement("p");
  note.className = "u-muted";
  note.textContent =
    "Nothing was placed for you: a building left where it is can be standing on the cells the layout wants. Move or store them yourself, then load again.";

  panel.setContent(heading, list, note);
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
    ["M", "Mirror the selection left to right — positions, not artwork"],
    ["Shift + M", "Mirror it top to bottom"],
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

/** One button on the banner, beside the dismiss cross. */
export interface BannerAction {
  label: string;
  run: () => void;
}

export interface BannerOptions {
  message: string;
  level?: "info" | "warning" | "error";
  /**
   * Buttons, in the order they are drawn.
   *
   * More than one because a preview that also left something behind has two
   * things to offer at once — "show me what did not fit" and "close the
   * preview" — and dropping either of them strands the player (issue #17).
   */
  actions?: readonly BannerAction[];
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

  for (const entry of options.actions ?? []) {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "btn btn--ghost";
    action.textContent = entry.label;
    action.addEventListener("click", entry.run);
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
