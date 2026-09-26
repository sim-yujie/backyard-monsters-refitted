import type { SelectionSummary, SelectionTypeCost } from "@/game/yard/planner/summary";
import { GroupOp, GROUP_OPS } from "@/game/yard/planner/groupTools";
import { PlannerTool, type PlannerState } from "@/game/yard/planner/PlannerSession";
import {
  wallClockSeconds,
  type ApplyPreview,
  type PlanTotals,
} from "@/game/yard/planner/upgrades";
import type { YardWorkers } from "@/game/yard/yardModel";
import { YardView } from "@/game/yard/YardRenderer";
import { formatAmount, formatCountdown } from "@/ui/format";
import { attachPopover } from "@/ui/Popover";
import { demo, GROUP_OP_DEMOS, type DemoName } from "./demos";

/**
 * The planner's two bars: tools across the top, the plan summary and the
 * actions along the bottom (design §4.1).
 *
 * HTML rather than canvas, as §4 asks, so the buttons get real focus, real
 * tooltips and real keyboard behaviour for nothing. Every control carries its
 * shortcut in the tooltip, because that is the only place a player will look
 * for it.
 *
 * The bar is stateless: `update` is handed the session's state and rewrites the
 * bits that changed. Nothing here calls back into the plan.
 *
 * ## The cost cells
 *
 * The left of the bottom bar is F3: four resource cells reading "needed /
 * held", a worker time, a shiny price, a free-worker count and an unplaced
 * count, then the selection sentence. A cell whose need is past what the yard
 * holds carries `--short`, which is a colour *and* a word in the tooltip, per
 * §4.3.
 *
 * "Needed" means **the plan** once anything is planned
 * (`docs/design/planner-upgrades.md` §5.3): every step from each planned
 * building's current level to its target, which is what Apply is about to
 * charge for. With nothing planned there is no plan to add up, so the cells
 * fall back to the selection's next level — the phase 1 reading, and still the
 * useful answer to "what would one more level of these cost".
 *
 * The workers cell is a readout in both modes, because "how many jobs can I
 * even start" is a question about the yard rather than about the plan. The
 * unplaced cell is hidden at zero, which is always, until a store tool can
 * take a building out of the yard.
 *
 * Shiny is shown and never purchasable (§6, Q6), so it is a readout like the
 * rest and not a button.
 *
 * ## Touch
 *
 * Two things here are F14's. The "Put back" chip appears beside the summary
 * while something is in hand, because a finger cannot right-click the carried
 * selection to put it down again. And every button in both bars is given a
 * 44 px target under `@media (pointer: coarse)` in `planner.css` — the size the
 * spec asks for, applied by how the device is being touched rather than by how
 * wide the window is, so a small window on a laptop keeps its compact bar.
 *
 * ## Read-only
 *
 * A read-only session (design §8, Q5) gets the same bars minus everything that
 * would change the yard: no undo or redo, no group operations, no Layouts, no
 * Checklist, no batch actions and no Apply, and a "Read-only" chip where the
 * slot name goes. The
 * controls are left out rather than disabled, because a row of six dead
 * buttons reads as a broken planner and a player cannot tell which of them
 * they are meant to wait for. What stays is what answers questions: the two
 * selection tools, Find, the view switch and the cost cells.
 */

/** The switches in the View menu: what each one draws over the yard. */
export type OverlayName = "ranges" | "land" | "air" | "centre";

export interface PlannerBarActions {
  onTool: (tool: PlannerTool) => void;
  onView: (view: YardView) => void;
  /**
   * One of the View menu's switches was flipped.
   *
   * The bar does not hold the answer — the toggles are remembered across
   * sessions and the layers are drawn by the scene — so it reports the press
   * and waits to be told what to tick.
   */
  onOverlay: (name: OverlayName) => void;
  /** Mirror, align or distribute the selection (F7). */
  onGroupTool: (op: GroupOp) => void;
  onUndo: () => void;
  onRedo: () => void;
  onFind: () => void;
  onLayouts: () => void;
  onChecklist: () => void;
  onUpgradeWalls: () => void;
  onRearmTraps: () => void;
  onApply: () => void;
  /**
   * Puts a carried selection back where it came from (F14).
   *
   * The chip this fires is touch's answer to right-clicking a carried
   * selection, which a finger cannot do.
   */
  onPutBack: () => void;
  /** Lift the selection off the yard into the drawer (Delete). */
  onStore: () => void;
  /** Store everything that is not fixed. The caller asks first. */
  onClearYard: () => void;
  /** Open or close the inventory drawer. */
  onInventory: () => void;
  onHelp: () => void;
  onExit: () => void;
}

/** `r1`..`r4` as the spec names them (docs/specs/base-building.md:573). */
const RESOURCE_LABELS: readonly (readonly [keyof SelectionSummary["needed"], string])[] = [
  ["r1", "Twigs"],
  ["r2", "Pebbles"],
  ["r3", "Putty"],
  ["r4", "Goo"],
];

const ZERO = { r1: 0, r2: 0, r3: 0, r4: 0 } as const;

const EMPTY_SUMMARY: SelectionSummary = {
  needed: ZERO,
  held: ZERO,
  shortfall: ZERO,
  seconds: 0,
  shiny: 0,
  byType: [],
  maxed: 0,
};

const button = (label: string, title: string, className = "btn btn--ghost"): HTMLButtonElement => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  element.title = title;
  return element;
};

/**
 * A control's title, kept on the control *and* on its demo wrapper.
 *
 * `.planner-tip` gives a disabled button `pointer-events: none` so the wrapper
 * can still be hovered (see `Popover.ts`), and a button that takes no pointer
 * events shows no native tooltip either. Putting the same text on the wrapper
 * puts that back: the browser shows the innermost title it can reach, which is
 * the button's while it is live and the wrapper's while it is not.
 */
const setTitle = (control: HTMLElement, text: string): void => {
  control.title = text;
  const wrapper = control.parentElement;
  if (wrapper?.classList.contains("planner-tip")) wrapper.title = text;
};

/** The body of a tool's popover: the demo, then the line it already said. */
const tipContent = (name: DemoName, text: string): Node => {
  const body = document.createElement("div");
  body.className = "popover__body";
  const figure = document.createElement("span");
  figure.className = "popover__demo";
  figure.append(demo(name));
  const line = document.createElement("p");
  line.className = "popover__text";
  line.textContent = text;
  body.append(figure, line);
  return body;
};

/**
 * Wraps a control so a demo of it can pop up on hover, focus or a long press.
 *
 * The wrapper is what listens, not the control, because Chrome dispatches no
 * pointer events at all over a disabled button — and a disabled Mirror is
 * exactly when a player wants to know what Mirror does.
 */
const withDemo = (
  control: HTMLElement,
  name: DemoName,
  text: () => string,
): { element: HTMLElement; dispose: () => void } => {
  const element = document.createElement("span");
  element.className = "planner-tip";
  element.append(control);
  element.title = control.title;
  const dispose = attachPopover(element, {
    build: () => tipContent(name, text()),
    className: "popover--demo",
  });
  return { element, dispose };
};

/** One row in a toolbar menu. */
interface MenuRow {
  readonly label: string;
  readonly title: string;
  /**
   * The demo shown when the row is hovered.
   *
   * Optional: Q13 asks for a picture of every *move*, and a picture is worse
   * than nothing when it shows the wrong one. A row that only turns a drawing
   * on has no move to illustrate, so it gets its sentence and no figure.
   */
  readonly demo?: DemoName;
  /**
   * The row is a switch rather than an action: it carries a tick, reports its
   * state to a screen reader, and leaves the menu open when it is pressed so
   * two of them can be flipped in one visit.
   */
  readonly checkable?: boolean;
  /** A child of the row above it, which is off while its parent is. */
  readonly nested?: boolean;
  /** Names the row for {@link Menu.setChecked}. */
  readonly key?: string;
  readonly run: () => void;
}

/**
 * A toolbar button that drops a short list of actions under it.
 *
 * Align has six members and Distribute two, and putting eight more buttons in
 * a row that already holds nine would push the undo pair off the end of a
 * laptop screen. Written by hand rather than with `<select>` or `<details>`
 * because both of those carry a meaning this does not have: a select holds a
 * value, and a details discloses content rather than firing an action.
 *
 * It closes on a choice, on Escape and on a press anywhere else, which are the
 * three ways anyone tries to dismiss a menu. Disabling the trigger closes it
 * too: a selection can shrink below two while the list is open, and a menu of
 * dead rows is worse than no menu.
 */
class Menu {
  readonly element: HTMLElement;

  private readonly trigger: HTMLButtonElement;
  private readonly list: HTMLElement;
  private readonly dismiss: (event: Event) => void;
  /** Detaches every popover this menu attached, trigger and rows alike. */
  private readonly popovers: (() => void)[] = [];
  /** The rows that carry a tick, by their key. */
  private readonly checks = new Map<string, HTMLButtonElement>();

  constructor(
    label: string,
    title: string,
    /** The trigger's own demo, or null where no picture would be honest. */
    demoName: DemoName | null,
    rows: readonly MenuRow[],
  ) {
    this.element = document.createElement("div");
    this.element.className = "planner-menu";

    this.trigger = button(`${label} ▾`, title);
    this.trigger.classList.add("planner-menu__trigger");
    this.trigger.setAttribute("aria-haspopup", "true");
    this.trigger.setAttribute("aria-expanded", "false");
    this.trigger.addEventListener("click", () => {
      this.toggle(this.list.hidden);
    });

    this.list = document.createElement("div");
    this.list.className = "planner-menu__list";
    this.list.setAttribute("role", "menu");
    this.list.setAttribute("aria-label", title);
    this.list.hidden = true;

    for (const row of rows) {
      const item = button(row.label, row.title, "btn btn--ghost planner-menu__item");
      item.setAttribute("role", row.checkable ? "menuitemcheckbox" : "menuitem");
      if (row.checkable) {
        item.classList.add("planner-menu__item--check");
        item.setAttribute("aria-checked", "false");
        if (row.key) this.checks.set(row.key, item);
      }
      if (row.nested) item.classList.add("planner-menu__item--nested");
      item.addEventListener("click", () => {
        // A switch leaves the list up: turning Land off and Air on is one
        // errand, and a menu that shut after each would make it two.
        if (!row.checkable) this.toggle(false);
        row.run();
      });
      // A row is never disabled — the trigger is — so the popover can hang off
      // the button itself and the row needs no wrapper.
      if (row.demo) {
        const demoName = row.demo;
        this.popovers.push(
          attachPopover(item, {
            build: () => tipContent(demoName, row.title),
            className: "popover--demo",
          }),
        );
      }
      this.list.append(item);
    }

    if (demoName) {
      const trigger = withDemo(this.trigger, demoName, () => this.trigger.title);
      this.popovers.push(trigger.dispose);
      this.element.append(trigger.element, this.list);
    } else {
      this.element.append(this.trigger, this.list);
    }

    this.dismiss = (event: Event): void => {
      if (this.list.hidden) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        this.toggle(false);
        this.trigger.focus();
        return;
      }
      if (event.target instanceof Node && this.element.contains(event.target)) return;
      this.toggle(false);
    };
    document.addEventListener("pointerdown", this.dismiss, true);
    document.addEventListener("keydown", this.dismiss, true);
  }

  /** Whether the list can be opened at all, and why not when it cannot. */
  setEnabled(enabled: boolean, title: string): void {
    this.trigger.disabled = !enabled;
    setTitle(this.trigger, title);
    if (!enabled) this.toggle(false);
  }

  get open(): boolean {
    return !this.list.hidden;
  }

  /**
   * Ticks or unticks one switch, and says whether it can be pressed.
   *
   * A nested row whose parent is off is left enabled and marked rather than
   * disabled, because pressing it is a reasonable thing to want and the scene
   * answers it by turning the parent on too. The class is what the stylesheet
   * dims.
   */
  setChecked(key: string, checked: boolean, dimmed = false): void {
    const item = this.checks.get(key);
    if (!item) return;
    item.setAttribute("aria-checked", String(checked));
    item.classList.toggle("planner-menu__item--on", checked);
    item.classList.toggle("planner-menu__item--dim", dimmed);
  }

  destroy(): void {
    document.removeEventListener("pointerdown", this.dismiss, true);
    document.removeEventListener("keydown", this.dismiss, true);
    for (const dispose of this.popovers) dispose();
    this.popovers.length = 0;
    this.element.remove();
  }

  private toggle(open: boolean): void {
    this.list.hidden = !open;
    this.trigger.setAttribute("aria-expanded", String(open));
  }
}

/** One "needed / held" readout, with its own label and its own tooltip. */
class CostCell {
  readonly element: HTMLElement;

  private readonly value: HTMLElement;

  constructor(label: string, className = "planner-cost__cell") {
    this.element = document.createElement("span");
    this.element.className = className;

    const name = document.createElement("span");
    name.className = "planner-cost__label";
    name.textContent = label;

    this.value = document.createElement("span");
    this.value.className = "planner-cost__value";
    this.value.textContent = "—";

    this.element.append(name, this.value);
  }

  set(text: string, title: string, short = false): void {
    this.value.textContent = text;
    this.element.title = title;
    this.element.classList.toggle("planner-cost__cell--short", short);
  }
}

export class PlannerBar {
  readonly toolbar: HTMLElement;
  readonly actionBar: HTMLElement;

  private readonly tools = new Map<PlannerTool, HTMLButtonElement>();
  private readonly views = new Map<YardView, HTMLButtonElement>();
  private readonly mirrors: HTMLButtonElement[] = [];
  /** The `.planner-tip` wrappers the mirror buttons are mounted inside. */
  private readonly mirrorTips: HTMLElement[] = [];
  /** Detaches every popover the bar attached. */
  private readonly popovers: (() => void)[] = [];
  private readonly align: Menu;
  private readonly distribute: Menu;
  private readonly viewMenu: Menu;
  private readonly undo: HTMLButtonElement;
  private readonly redo: HTMLButtonElement;
  private readonly apply: HTMLButtonElement;
  private readonly checklist: HTMLButtonElement;
  private readonly upgradeWalls: HTMLButtonElement;
  private readonly rearm: HTMLButtonElement;
  private readonly rearmBadge: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly putBack: HTMLButtonElement;
  private readonly store: HTMLButtonElement;
  private readonly storeChip: HTMLButtonElement;
  private readonly inventory: HTMLButtonElement;
  private readonly inventoryBadge: HTMLElement;
  private readonly yardMenu: Menu;
  private readonly slotLabel: HTMLElement;
  private readonly resourceCells = new Map<string, CostCell>();
  private readonly timeCell: CostCell;
  private readonly shinyCell: CostCell;
  private readonly workersCell: CostCell;
  private readonly unplacedCell: CostCell;
  private readonly readOnly: boolean;

  constructor(actions: PlannerBarActions, options: { readOnly?: boolean } = {}) {
    this.readOnly = options.readOnly ?? false;

    this.toolbar = document.createElement("div");
    this.toolbar.className = "planner-bar planner-bar--top";
    this.toolbar.setAttribute("aria-label", "Planner tools");

    const title = document.createElement("span");
    title.className = "planner-bar__title";
    title.textContent = "Yard Planner";

    this.slotLabel = document.createElement("span");
    this.slotLabel.className = "planner-bar__slot u-muted";

    const select = button("Select", "Select tool (V)");
    select.addEventListener("click", () => actions.onTool(PlannerTool.SELECT));
    const box = button("Box", "Box select (B)");
    box.addEventListener("click", () => actions.onTool(PlannerTool.BOX));
    this.tools.set(PlannerTool.SELECT, select);
    this.tools.set(PlannerTool.BOX, box);

    const find = button("Find", "Find buildings by name or type (F)");
    find.addEventListener("click", actions.onFind);

    const iso = button("3D", "The yard as it looks (Tab switches)");
    iso.addEventListener("click", () => actions.onView(YardView.ISO));
    const blueprint = button("Blueprint", "Flat top-down view for planning (Tab switches)");
    blueprint.addEventListener("click", () => actions.onView(YardView.BLUEPRINT));
    this.views.set(YardView.ISO, iso);
    this.views.set(YardView.BLUEPRINT, blueprint);

    /* ── What is drawn over the yard (issues #4 and #54) ─────────────── */

    this.viewMenu = new Menu("View", "What is drawn over the yard", null, [
      {
        label: "Tower ranges",
        title: "Show how far every defence tower reaches (R)",
        checkable: true,
        key: "ranges",
        run: () => actions.onOverlay("ranges"),
      },
      {
        label: "Land",
        title: "The reach of towers that shoot at creeps on the ground",
        checkable: true,
        nested: true,
        key: "land",
        run: () => actions.onOverlay("land"),
      },
      {
        label: "Air",
        title: "The reach of towers that shoot at flyers",
        checkable: true,
        nested: true,
        key: "air",
        run: () => actions.onOverlay("air"),
      },
      {
        label: "Centre of yard",
        title: "Mark the middle of the plot and its two axes",
        checkable: true,
        key: "centre",
        run: () => actions.onOverlay("centre"),
      },
    ]);

    /* ── F7: mirror, align and distribute ───────────────────────────── */

    const groupButton = (op: GroupOp): HTMLButtonElement => {
      const info = GROUP_OPS[op];
      const element = button(info.menu, info.hint);
      element.disabled = true;
      element.addEventListener("click", () => actions.onGroupTool(op));
      // Wrapped so the demo can pop up even while the button is off, and the
      // wrapper is what goes in the bar (`this.mirrors` keeps the buttons,
      // because that is what `setGroupEnabled` has to reach).
      const { element: wrapper, dispose } = withDemo(
        element,
        GROUP_OP_DEMOS[op],
        () => element.title,
      );
      this.popovers.push(dispose);
      this.mirrorTips.push(wrapper);
      return element;
    };

    const groupRow = (op: GroupOp): MenuRow => ({
      label: GROUP_OPS[op].menu,
      title: GROUP_OPS[op].hint,
      demo: GROUP_OP_DEMOS[op],
      run: () => actions.onGroupTool(op),
    });

    this.mirrors.push(groupButton(GroupOp.MIRROR_X), groupButton(GroupOp.MIRROR_Y));

    this.align = new Menu("Align", "Align the selection's edges or centres", "alignLeft", [
      groupRow(GroupOp.ALIGN_LEFT),
      groupRow(GroupOp.ALIGN_RIGHT),
      groupRow(GroupOp.ALIGN_TOP),
      groupRow(GroupOp.ALIGN_BOTTOM),
      groupRow(GroupOp.ALIGN_CENTRE_X),
      groupRow(GroupOp.ALIGN_CENTRE_Y),
    ]);
    this.distribute = new Menu("Distribute", "Space the selection evenly", "distributeH", [
      groupRow(GroupOp.DISTRIBUTE_X),
      groupRow(GroupOp.DISTRIBUTE_Y),
    ]);
    this.setGroupEnabled(0);

    /* ── Store, clear and the drawer (issue #50) ─────────────────────── */

    this.store = button("Store", "Select something to store");
    this.store.disabled = true;
    this.store.addEventListener("click", actions.onStore);
    const storeTip = withDemo(this.store, "store", () => this.store.title);
    this.popovers.push(storeTip.dispose);

    this.yardMenu = new Menu("Yard", "Actions on the whole yard", "store", [
      {
        label: "Clear yard",
        title: "Put every building in the drawer, ready to lay the yard out again",
        demo: "store",
        run: actions.onClearYard,
      },
    ]);

    // The label and the badge are separate children so the count can be
    // rewritten without the label being rebuilt around it, as the re-arm
    // button does.
    this.inventory = button("", "Nothing is stored", "btn btn--ghost planner-bar__inventory");
    const inventoryLabel = document.createElement("span");
    inventoryLabel.textContent = "Stored";
    this.inventoryBadge = document.createElement("span");
    this.inventoryBadge.className = "planner-bar__badge";
    this.inventoryBadge.hidden = true;
    this.inventory.append(inventoryLabel, this.inventoryBadge);
    this.inventory.disabled = true;
    this.inventory.addEventListener("click", actions.onInventory);

    this.undo = button("Undo", "Undo (Ctrl+Z)");
    this.undo.addEventListener("click", actions.onUndo);
    this.redo = button("Redo", "Redo (Ctrl+Shift+Z or Ctrl+Y)");
    this.redo.addEventListener("click", actions.onRedo);

    const help = button("?", "How the planner works, and every shortcut", "btn btn--ghost btn--icon");
    // "?" is not a name, so the button gets a real one for anything that reads
    // the accessible name rather than the glyph.
    help.setAttribute("aria-label", "How the planner works, and every shortcut");
    help.addEventListener("click", actions.onHelp);

    const exit = button("Leave planner", "Leave planner (P)");
    exit.addEventListener("click", actions.onExit);

    this.toolbar.append(
      title,
      this.slotLabel,
      group(select, box, find),
      // The overlays live with the view switch and not with the edit tools:
      // they change what the yard looks like, never what it is, so they stay
      // mounted in a read-only session too.
      group(iso, blueprint, this.viewMenu.element),
      // Every one of these moves buildings, so a read-only session gets none
      // of them, the same way it gets no undo and no Apply.
      ...(this.readOnly
        ? []
        : [
            group(storeTip.element, this.yardMenu.element, this.inventory),
            group(...this.mirrorTips, this.align.element, this.distribute.element),
            group(this.undo, this.redo),
          ]),
      spacer(),
      help,
      exit,
    );

    /* ── Bottom bar ─────────────────────────────────────────────────── */

    this.actionBar = document.createElement("div");
    this.actionBar.className = "planner-bar planner-bar--bottom";
    this.actionBar.setAttribute("aria-label", "Plan summary and actions");

    const costs = document.createElement("div");
    costs.className = "planner-cost";
    costs.setAttribute("role", "group");
    costs.setAttribute("aria-label", "What the selection would cost");

    for (const [key, label] of RESOURCE_LABELS) {
      const cell = new CostCell(label);
      this.resourceCells.set(key, cell);
      costs.append(cell.element);
    }

    this.timeCell = new CostCell("Time", "planner-cost__cell planner-cost__cell--time");
    this.shinyCell = new CostCell("Shiny", "planner-cost__cell planner-cost__cell--shiny");
    this.workersCell = new CostCell("Workers", "planner-cost__cell planner-cost__cell--workers");
    // Nothing can be unplaced yet (phase 1 §1.3), so the cell starts hidden and
    // the store tool turns it on rather than adding it.
    this.unplacedCell = new CostCell(
      "Unplaced",
      "planner-cost__cell planner-cost__cell--unplaced",
    );
    this.unplacedCell.element.hidden = true;
    costs.append(
      this.timeCell.element,
      this.shinyCell.element,
      this.workersCell.element,
      this.unplacedCell.element,
    );

    this.summary = document.createElement("span");
    this.summary.className = "planner-bar__summary";
    this.summary.setAttribute("role", "status");

    /*
     * F14's "put back", for a hand that has no second button.
     *
     * Only on screen while something is in hand, because that is the only
     * moment it means anything, and beside the summary line that says so
     * rather than out among the actions: it undoes a gesture, not an edit.
     */
    this.putBack = button(
      "Put back",
      "Put the buildings in hand back where they were (Esc)",
      "btn btn--ghost planner-bar__put-back",
    );
    this.putBack.hidden = true;
    this.putBack.addEventListener("click", actions.onPutBack);

    /*
     * The same Store the toolbar has, beside the count of what is selected.
     *
     * Not a duplicate for its own sake: the selection sentence is where a
     * player looks after a marquee, and asking them to travel back up to the
     * toolbar to act on what it says is the whole reason the chip exists.
     */
    this.storeChip = button(
      "Store",
      "Put the selection in the drawer (Delete)",
      "btn btn--ghost planner-bar__store-chip",
    );
    this.storeChip.hidden = true;
    this.storeChip.addEventListener("click", actions.onStore);

    const layouts = button("Layouts", "Saved layouts (Ctrl+S saves to the current slot)");
    layouts.addEventListener("click", actions.onLayouts);

    this.checklist = button("Checklist", "What is blocking Apply");
    this.checklist.addEventListener("click", actions.onChecklist);

    this.upgradeWalls = button("Upgrade walls", "Select some walls first");
    this.upgradeWalls.className = "btn btn--ghost planner-bar__walls";
    this.upgradeWalls.disabled = true;
    this.upgradeWalls.addEventListener("click", actions.onUpgradeWalls);

    // The label and the badge are separate children so the count can be
    // rewritten without the label being rebuilt around it.
    this.rearm = button("", "No fired traps to put back", "btn btn--ghost planner-bar__rearm");
    const rearmLabel = document.createElement("span");
    rearmLabel.textContent = "Re-arm traps";
    this.rearmBadge = document.createElement("span");
    this.rearmBadge.className = "planner-bar__badge";
    this.rearmBadge.hidden = true;
    this.rearm.append(rearmLabel, this.rearmBadge);
    this.rearm.disabled = true;
    this.rearm.addEventListener("click", actions.onRearmTraps);

    this.apply = button("Apply", "Write this layout to your yard", "btn btn--primary");
    this.apply.addEventListener("click", actions.onApply);

    if (this.readOnly) {
      // Every action below writes to the yard, so none of them is mounted.
      // `disabled` is set as well as the button being left out, so a caller
      // that reaches one through the actions object still finds it inert.
      // Nothing can be picked up either, so the put-back chip goes with them.
      for (const control of [
        this.upgradeWalls,
        this.rearm,
        this.checklist,
        layouts,
        this.apply,
        this.putBack,
        this.store,
        this.storeChip,
        this.inventory,
      ]) {
        control.disabled = true;
      }
      this.actionBar.append(costs, this.summary, spacer());
    } else {
      this.actionBar.append(
        costs,
        this.summary,
        this.storeChip,
        this.putBack,
        spacer(),
        this.upgradeWalls,
        this.rearm,
        this.checklist,
        layouts,
        this.apply,
      );
    }

    this.setSummary(EMPTY_SUMMARY);
  }

  mount(container: HTMLElement): this {
    container.append(this.toolbar, this.actionBar);
    return this;
  }

  /**
   * Ticks the View menu to match what is being drawn.
   *
   * Land and Air are dimmed while their parent is off, rather than removed or
   * disabled: they are still what the overlay will show when it comes back on,
   * and a player who turned Air off three sessions ago has to be able to find
   * out why the flyer discs are missing. Pressing a dimmed one turns Tower
   * ranges back on with it, so the row never does nothing.
   */
  setOverlays(toggles: {
    readonly ranges: boolean;
    readonly land: boolean;
    readonly air: boolean;
    readonly centre: boolean;
  }): void {
    this.viewMenu.setChecked("ranges", toggles.ranges);
    this.viewMenu.setChecked("land", toggles.land, !toggles.ranges);
    this.viewMenu.setChecked("air", toggles.air, !toggles.ranges);
    this.viewMenu.setChecked("centre", toggles.centre);
  }

  /** Redraws from the session's state. */
  update(state: PlannerState): void {
    for (const [tool, element] of this.tools) {
      element.setAttribute("aria-pressed", String(state.tool === tool));
    }
    for (const [view, element] of this.views) {
      element.setAttribute("aria-pressed", String(state.view === view));
    }

    this.setGroupEnabled(state.selectionCount);

    this.undo.disabled = !state.canUndo;
    this.undo.title = state.canUndo ? `Undo ${state.undoLabel} (Ctrl+Z)` : "Nothing to undo";
    this.redo.disabled = !state.canRedo;
    this.redo.title = state.canRedo
      ? `Redo ${state.redoLabel} (Ctrl+Shift+Z)`
      : "Nothing to redo";

    this.slotLabel.textContent = state.readOnly
      ? "Read-only"
      : state.previewing
        ? `Previewing “${state.slotName}”`
        : state.slotName
          ? `${state.slotName}${state.dirty ? " · unsaved" : ""}`
          : state.dirty
            ? "Unsaved changes"
            : "No layout loaded";
    this.slotLabel.title = state.readOnly
      ? "This yard can be looked at but not rearranged. Open your own yard in build mode to edit."
      : "";
    this.slotLabel.classList.toggle("planner-bar__slot--read-only", state.readOnly);

    this.summary.textContent = summarise(state);
    // A read-only session never mounts the chip; hiding it as well keeps the
    // two states from disagreeing if one ever slips through.
    this.putBack.hidden = this.readOnly || !state.carrying;
    if (this.readOnly) return;

    this.setStoreEnabled(state.selectionCount);
    // Nothing to store while something is already in hand, and the chip would
    // sit next to "Put back" saying the opposite thing.
    this.storeChip.hidden = state.selectionCount === 0 || state.carrying;
    this.setStoredCount(state.storedCount);
    this.yardMenu.setEnabled(!state.previewing, state.previewing
      ? "Close the preview first"
      : "Actions on the whole yard");

    this.apply.disabled = state.previewing;
    this.apply.title = state.previewing
      ? "Close the preview before applying"
      : "Write this layout to your yard";
  }

  /**
   * Rewrites the six cost cells from a selection summary.
   *
   * The breakdown by type goes into every needed cell's tooltip rather than
   * into a popover: it is a list of at most a handful of rows, it is wanted
   * while the pointer is already over the number, and a popover here would sit
   * under the bar it belongs to.
   */
  setSummary(summary: SelectionSummary): void {
    const breakdown = describeBreakdown(summary.byType, summary.maxed);
    this.setResourceCells(summary.needed, summary.held, summary.shortfall, breakdown);

    this.timeCell.set(
      summary.seconds === 0 ? "—" : formatCountdown(summary.seconds),
      summary.seconds === 0
        ? "No worker time: nothing selected has a next level."
        : `${summary.seconds.toLocaleString()} worker seconds for the next level of everything selected.`,
    );

    this.shinyCell.set(
      summary.shiny === 0 ? "—" : formatAmount(summary.shiny),
      "What it would cost in shiny to buy every step outright. Not for sale in the planner yet.",
    );
  }

  /**
   * The same six cells, read from the plan rather than from the selection
   * (§5.3).
   *
   * `free` is what the wall-clock lower bound is divided by, and it comes from
   * the yard rather than from the totals because the plan does not know how
   * many workers are already on a job.
   */
  setPlanSummary(totals: PlanTotals, free: number): void {
    const breakdown = describeBreakdown(totals.byType, 0);
    this.setResourceCells(totals.needed, totals.held, totals.shortfall, breakdown);

    const clock = wallClockSeconds(totals, free);
    this.timeCell.set(
      totals.seconds === 0 ? "—" : formatCountdown(totals.seconds),
      totals.seconds === 0
        ? "No worker time: nothing is planned."
        : `${totals.seconds.toLocaleString()} worker seconds over ${totals.steps} ${totals.steps === 1 ? "step" : "steps"}.\nAt least ${formatCountdown(clock)} of real time with ${free} free ${free === 1 ? "worker" : "workers"} — a lower bound, because jobs do not parallelise perfectly and one building takes one step at a time.`,
    );

    this.shinyCell.set(
      totals.shiny === 0 ? "—" : formatAmount(totals.shiny),
      "What it would cost in shiny to buy every planned step outright. Not for sale in the planner yet.",
    );
  }

  /**
   * The free-worker readout, and what Apply would do with them.
   *
   * The preview is the same walk Apply runs (§5.5), so the tooltip promises
   * what the dialog will itemise and the server will then report.
   */
  setWorkers(workers: YardWorkers, preview: ApplyPreview | null): void {
    const free = Math.max(0, workers.total - workers.busy);
    const tail = preview
      ? `\n${preview.started.length} would start on Apply, ${preview.waiting.length} would wait for a worker, ${preview.finished.length} would finish instantly.`
      : "";
    this.workersCell.set(
      `${free} free / ${workers.total}`,
      `${workers.busy} of ${workers.total} ${workers.total === 1 ? "worker is" : "workers are"} already on a job.${tail}`,
      preview !== null && preview.waiting.length > 0,
    );
  }

  /**
   * How many buildings are in the plan but nowhere on the plot.
   *
   * Hidden at zero: an untouched plan should not carry a count of nothing.
   * Apply is hard-blocked while it is not zero (§8, Q4), so the cell is the
   * bar's standing answer to "why is Apply refusing me".
   */
  setUnplaced(count: number): void {
    this.unplacedCell.element.hidden = count === 0;
    this.unplacedCell.set(
      String(count),
      count === 0
        ? "Every building has a place."
        : `${count} ${count === 1 ? "building has" : "buildings have"} nowhere to go. Apply is blocked until ${count === 1 ? "it does" : "they do"}.`,
      count > 0,
    );
  }

  /** The four resource cells, from whichever reading of "needed" is current. */
  private setResourceCells(
    needed: SelectionSummary["needed"],
    held: SelectionSummary["held"],
    shortfall: SelectionSummary["shortfall"],
    breakdown: string,
  ): void {
    for (const [key, label] of RESOURCE_LABELS) {
      const cell = this.resourceCells.get(key);
      if (!cell) continue;
      const short = shortfall[key];
      cell.set(
        `${formatAmount(needed[key])} / ${formatAmount(held[key])}`,
        short > 0
          ? `${label}: ${needed[key].toLocaleString()} needed, ${held[key].toLocaleString()} held — ${short.toLocaleString()} short.\n${breakdown}`
          : `${label}: ${needed[key].toLocaleString()} needed, ${held[key].toLocaleString()} held.\n${breakdown}`,
        short > 0,
      );
    }
  }

  /**
   * Lights the group operations up for a selection of `count` buildings.
   *
   * Each control asks for the minimum its own geometry needs rather than one
   * number for all of them: mirroring or aligning one building about its own
   * centre is the identity, and distributing holds the outermost two still, so
   * it has nothing to space until there is a third between them. A button that
   * is off says what would turn it on, because that is the question a player
   * with one tower selected is actually asking.
   */
  setGroupEnabled(selected: number): void {
    // A read-only session never mounts these, and they stay inert as well as
    // absent so a caller holding one cannot fire it (§8, Q5).
    const count = this.readOnly ? 0 : selected;

    for (const element of this.mirrors) {
      element.disabled = count < 2;
      if (count < 2) setTitle(element, "Select two or more buildings to mirror");
    }
    if (count >= 2) {
      const [horizontal, vertical] = this.mirrors;
      if (horizontal) setTitle(horizontal, GROUP_OPS[GroupOp.MIRROR_X].hint);
      if (vertical) setTitle(vertical, GROUP_OPS[GroupOp.MIRROR_Y].hint);
    }

    this.align.setEnabled(
      count >= 2,
      count >= 2
        ? "Align the selection's edges or centres"
        : "Select two or more buildings to align",
    );
    this.distribute.setEnabled(
      count >= 3,
      count >= 3
        ? "Space the selection evenly"
        : "Select three or more buildings to space out evenly",
    );
  }

  /**
   * Lights Store up for a selection of `count` buildings.
   *
   * Off with nothing selected, and saying what would turn it on: "Store" with
   * no selection is a button whose answer is "store what?".
   */
  setStoreEnabled(count: number): void {
    if (this.readOnly) return;
    this.store.disabled = count === 0;
    setTitle(
      this.store,
      count === 0
        ? "Select something to store"
        : `Put ${count === 1 ? "it" : `all ${count}`} in the drawer (Delete)`,
    );
  }

  /**
   * How many buildings the drawer holds.
   *
   * Drives three things at once, because they are three readings of one
   * number: the badge on the drawer button, whether that button can be opened
   * at all, and the Unplaced cost cell that says Apply is blocked.
   */
  setStoredCount(count: number): void {
    if (this.readOnly) return;
    this.inventoryBadge.hidden = count === 0;
    this.inventoryBadge.textContent = String(count);
    this.inventory.disabled = count === 0;
    this.inventory.title =
      count === 0
        ? "Nothing is stored"
        : `${count} ${count === 1 ? "building is" : "buildings are"} in the drawer`;
    this.setUnplaced(count);
  }

  /** Shows the count of blocking problems on the checklist button. */
  setBlocking(count: number): void {
    if (this.readOnly) return;
    this.checklist.textContent = count > 0 ? `Checklist · ${count}` : "Checklist";
    this.checklist.classList.toggle("planner-bar__checklist--bad", count > 0);
  }

  /** How many walls the selection holds, which is what Upgrade walls acts on. */
  setWallCount(count: number): void {
    if (this.readOnly) return;
    this.upgradeWalls.disabled = count === 0;
    this.upgradeWalls.title =
      count === 0
        ? "Select some walls first"
        : `Raise ${count} selected ${count === 1 ? "wall" : "walls"} to a higher level`;
  }

  /** How many fired traps are waiting to be put back. Zero disables the button. */
  setRearmCount(count: number): void {
    if (this.readOnly) return;
    this.rearmBadge.hidden = count === 0;
    this.rearmBadge.textContent = String(count);
    this.rearm.disabled = count === 0;
    this.rearm.title =
      count === 0
        ? "No fired traps to put back"
        : `Put ${count} fired ${count === 1 ? "trap" : "traps"} back where ${count === 1 ? "it" : "they"} stood`;
  }

  destroy(): void {
    // The menus listen on the document, so dropping the bar is not enough.
    this.align.destroy();
    this.distribute.destroy();
    this.yardMenu.destroy();
    this.viewMenu.destroy();
    // So do the popovers, and their bubbles hang off the body rather than off
    // the bar, so they outlive it unless they are taken down by hand.
    for (const dispose of this.popovers) dispose();
    this.popovers.length = 0;
    this.toolbar.remove();
    this.actionBar.remove();
  }
}

/**
 * The breakdown line under every needed cell's tooltip.
 *
 * Named types rather than ids, because the player selected pictures and not
 * numbers, and the maxed count last so a selection that costs nothing still
 * says why.
 */
const describeBreakdown = (
  byType: readonly SelectionTypeCost[],
  maxed: number,
): string => {
  const lines = byType.map(
    (row) =>
      `${row.count} × ${row.name}: ${[
        row.needed.r1 > 0 ? `${row.needed.r1.toLocaleString()} twigs` : "",
        row.needed.r2 > 0 ? `${row.needed.r2.toLocaleString()} pebbles` : "",
        row.needed.r3 > 0 ? `${row.needed.r3.toLocaleString()} putty` : "",
        row.needed.r4 > 0 ? `${row.needed.r4.toLocaleString()} goo` : "",
      ]
        .filter(Boolean)
        .join(", ") || "free"}`,
  );
  if (maxed > 0) {
    lines.push(`${maxed} already at the top of ${maxed === 1 ? "its" : "their"} ladder`);
  }
  return lines.length > 0 ? lines.join("\n") : "Nothing selected has a next level.";
};

const summarise = (state: PlannerState): string => {
  const parts: string[] = [];
  parts.push(
    state.selectionCount === 0
      ? "Nothing selected"
      : state.selectionCount === 1
        ? "1 selected"
        : `${state.selectionCount} selected`,
  );
  parts.push(state.movedCount === 1 ? "1 moved" : `${state.movedCount} moved`);
  // Left out at zero: an untouched plan should not carry a count of nothing.
  if (state.plannedCount > 0) parts.push(`${state.plannedCount} planned`);
  if (state.storedCount > 0) {
    parts.push(`${state.storedCount} stored`);
  }
  if (state.dragInvalid) parts.push("cannot drop here");
  else if (state.placing) {
    parts.push("out of the drawer · click to put it down, Esc to put it back");
  } else if (state.carrying) {
    // Both spellings of "put it back", because the bar is read on a phone too
    // and a finger has no second button (F14).
    parts.push("in hand · click to drop, right-click or Put back to cancel");
  }
  else if (state.readOnly) parts.push("read-only · nothing here can be moved");
  else if (state.previewing) parts.push("read-only preview");
  return parts.join(" · ");
};

const group = (...children: HTMLElement[]): HTMLElement => {
  const element = document.createElement("div");
  element.className = "planner-bar__group";
  element.append(...children);
  return element;
};

const spacer = (): HTMLElement => {
  const element = document.createElement("div");
  element.className = "planner-bar__spacer";
  return element;
};
