import { tutTarget, TutTarget } from "@/game/guide/targets";
import type { SelectionSummary, SelectionTypeCost } from "@/game/yard/planner/summary";
import { GroupOp, GROUP_OPS } from "@/game/yard/planner/groupTools";
import { percentText, type CoverageFigures } from "@/game/yard/planner/coverage";
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
import { RESOURCE_KEYS, RESOURCE_NAMES, resourceIcon } from "@/ui/resourceIcon";
import { demo, GROUP_OP_DEMOS, type DemoName } from "./demos";
import { costLineParts, isPhone, PlannerLayout } from "./plannerLayout";

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
 * ## Phones (#45)
 *
 * `setLayout` rearranges the same controls for a phone, the owner's Option A:
 * upright, a top bar of Leave, the layout's name, a 3D ⇄ Blueprint switch and
 * undo/redo, and a bottom bar of the summary, a one-line cost, Box, the
 * drawer, More and Apply; sideways, all of that in one bar along the bottom.
 * Everything else moves into the More sheet, and Mirror, Align and Distribute
 * are lent to the building sheet (`lendArrange`). The controls are moved, not
 * copied, so every state this class keeps (a disabled Mirror, a count on the
 * drawer) is right in either place; and they are moved back exactly where
 * they were when the window returns to a desktop's shape. A desktop never
 * sees the phone-only controls at all: they are not in the document.
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
export type OverlayName = "ranges" | "land" | "air" | "centre" | "deadZones";

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
  /** A phone's More sheet opened or closed (#45), so the scene can hide the other sheets. */
  onMore?: (open: boolean) => void;
}

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
  /** Every row, for a menu shown inline, whose rows stand in for the trigger. */
  private readonly rows: HTMLButtonElement[] = [];
  /** Shown as a list in a sheet rather than dropped from a trigger (#45). */
  private inline = false;

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
      this.rows.push(item);
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
      if (this.inline || this.list.hidden) return;
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
    // Inline, the rows are the control, so they take the trigger's state.
    for (const row of this.rows) row.disabled = this.inline && !enabled;
    if (!enabled) this.toggle(false);
  }

  /**
   * Shows the rows in place of the trigger, as a list inside a sheet, or puts
   * the trigger back (#45): a phone's More sheet holds the View switches and
   * Clear yard this way, with nothing to open first.
   */
  setInline(inline: boolean): void {
    if (inline === this.inline) return;
    this.inline = inline;
    this.element.classList.toggle("planner-menu--inline", inline);
    this.list.hidden = !inline;
    this.trigger.setAttribute("aria-expanded", "false");
    for (const row of this.rows) row.disabled = inline && this.trigger.disabled;
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
    if (this.inline) return;
    // Where the list would hang, for a phone: there the bar scrolls sideways
    // and would clip it, so the stylesheet pins it to the viewport here.
    if (open) {
      const anchor = this.element.getBoundingClientRect();
      this.list.style.setProperty("--menu-top", `${anchor.bottom}px`);
      this.list.style.setProperty("--menu-left", `${anchor.left}px`);
      // Low on the screen (Align in a phone's building sheet, #45) it opens
      // upward, or it would hang off the bottom of the screen.
      this.list.style.setProperty("--menu-bottom", `${window.innerHeight - anchor.top}px`);
      this.list.classList.toggle("planner-menu__list--up", anchor.bottom > window.innerHeight / 2);
    }
    this.list.hidden = !open;
    this.trigger.setAttribute("aria-expanded", String(open));
  }
}

/**
 * Moves controls between the bars and a phone's sheets, and puts them back
 * (#45).
 *
 * Each node moved leaves a comment where it stood, so returning to the
 * desktop layout restores the exact order without the bar having to remember
 * it. A node that was never mounted (a read-only bar's edit controls) is left
 * alone.
 */
class Relocator {
  private readonly marks = new Map<Node, Comment>();

  move(node: Node, into: Node, before: Node | null = null): void {
    const parent = node.parentNode;
    if (!parent) return;
    if (!this.marks.has(node)) {
      const mark = document.createComment("");
      parent.insertBefore(mark, node);
      this.marks.set(node, mark);
    }
    into.insertBefore(node, before);
  }

  /** Puts one node back, if it was moved. */
  restoreOne(node: Node): void {
    const mark = this.marks.get(node);
    if (!mark) return;
    mark.replaceWith(node);
    this.marks.delete(node);
  }

  restore(): void {
    for (const [node, mark] of this.marks) mark.replaceWith(node);
    this.marks.clear();
  }
}

/** One "needed / held" readout, with its own label and its own tooltip. */
class CostCell {
  readonly element: HTMLElement;

  private readonly value: HTMLElement;

  constructor(label: string | Node, className = "planner-cost__cell") {
    this.element = document.createElement("span");
    this.element.className = className;

    const name = document.createElement("span");
    name.className = "planner-cost__label";
    name.append(label);

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
  /** Land and air coverage of the plan (#55). */
  private readonly coverageCell: CostCell;
  private readonly readOnly: boolean;
  private readonly actions: PlannerBarActions;

  /* ── Phones (#45) ─────────────────────────────────────────────────── */

  private layout: PlannerLayout = PlannerLayout.DESKTOP;
  /** The screen is touched: the summary says "tap", not "click". */
  private touch = false;
  private readonly places = new Relocator();
  private container: HTMLElement | null = null;
  private lastState: PlannerState | null = null;
  private readonly heading: HTMLElement;
  private readonly box: HTMLButtonElement;
  private readonly find: HTMLButtonElement;
  private readonly layoutsButton: HTMLButtonElement;
  private readonly help: HTMLButtonElement;
  private readonly exit: HTMLButtonElement;
  /** Mirror, Align and Distribute: lent to the building sheet on a phone. */
  private readonly arrangeGroup: HTMLElement | null;
  /** Upgrade walls, re-arm, Checklist, Layouts and Apply. Null when read-only. */
  private readonly actionRow: HTMLElement | null;
  /** One button for the two views, which a phone has no room to show side by side. */
  private readonly viewSwitch: HTMLButtonElement;
  private readonly moreButton: HTMLButtonElement;
  /** The costs in one line; a tap shows the full cells. */
  private readonly costLine: HTMLButtonElement;
  private readonly moreSheet: HTMLElement;
  private readonly moreView: HTMLElement;
  private readonly morePlanSection: HTMLElement;
  private readonly morePlan: HTMLElement;
  private moreOpen = false;
  private costsOpen = false;
  private tool: PlannerTool = PlannerTool.SELECT;
  private view: YardView = YardView.ISO;
  /** What the cost line was last told, so it can be redrawn on its own. */
  private line = {
    needed: ZERO as SelectionSummary["needed"],
    shortfall: ZERO as SelectionSummary["shortfall"],
    seconds: 0,
    coverage: "",
  };

  constructor(
    actions: PlannerBarActions,
    options: {
      readOnly?: boolean;
      /**
       * Whether the yard has layout slots: false on an outpost, where Flash's
       * planner could neither save nor load one (`BasePlanner.as:41`, #191).
       */
      layouts?: boolean;
    } = {},
  ) {
    this.readOnly = options.readOnly ?? false;
    this.actions = actions;
    const hasLayouts = options.layouts ?? true;

    this.toolbar = document.createElement("div");
    this.toolbar.className = "planner-bar planner-bar--top";
    this.toolbar.setAttribute("aria-label", "Planner tools");

    const title = document.createElement("span");
    title.className = "planner-bar__title";
    title.textContent = "Yard Planner";

    this.slotLabel = document.createElement("span");
    this.slotLabel.className = "planner-bar__slot u-muted";

    // One box for the two, which a desktop lays out as if it were not there
    // (`display: contents`) and a phone stacks, name over slot.
    this.heading = document.createElement("div");
    this.heading.className = "planner-bar__heading";
    this.heading.append(title, this.slotLabel);

    const select = button("Select", "Select tool (V)");
    select.addEventListener("click", () => actions.onTool(PlannerTool.SELECT));
    const box = button("Box", "Box select (B)");
    // On a phone Select has no button of its own: Box is a switch, and off is Select.
    box.addEventListener("click", () =>
      actions.onTool(
        isPhone(this.layout) && this.tool === PlannerTool.BOX ? PlannerTool.SELECT : PlannerTool.BOX,
      ),
    );
    this.tools.set(PlannerTool.SELECT, select);
    this.tools.set(PlannerTool.BOX, box);
    this.box = box;

    const find = button("Find", "Find buildings by name or type (F)");
    find.addEventListener("click", actions.onFind);
    this.find = find;

    const iso = button("3D", "The yard as it looks (Tab switches)");
    iso.addEventListener("click", () => actions.onView(YardView.ISO));
    const blueprint = button("Blueprint", "Flat top-down view for planning (Tab switches)");
    blueprint.addEventListener("click", () => actions.onView(YardView.BLUEPRINT));
    this.views.set(YardView.ISO, iso);
    this.views.set(YardView.BLUEPRINT, blueprint);
    // The one control that still works while comparing (#9): both panes switch.
    iso.dataset["compare"] = "on";
    blueprint.dataset["compare"] = "on";

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
        label: "Dead zones",
        title: "Hatch the parts of the yard no tower reaches, for the layers Land and Air tick",
        checkable: true,
        key: "deadZones",
        run: () => actions.onOverlay("deadZones"),
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
    tutTarget(help, TutTarget.PLANNER_HELP);
    help.addEventListener("click", actions.onHelp);
    this.help = help;

    const exit = button("Leave planner", "Leave planner (P)");
    exit.classList.add("planner-bar__exit");
    exit.setAttribute("aria-label", "Leave planner");
    exit.addEventListener("click", actions.onExit);
    this.exit = exit;

    this.undo.setAttribute("aria-label", "Undo");
    this.redo.setAttribute("aria-label", "Redo");
    const history = group(this.undo, this.redo);
    history.classList.add("planner-bar__group--history");
    this.arrangeGroup = this.readOnly
      ? null
      : group(...this.mirrorTips, this.align.element, this.distribute.element);

    this.toolbar.append(
      this.heading,
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
            ...(this.arrangeGroup ? [this.arrangeGroup] : []),
            history,
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

    // Each resource cell and the shiny cell are headed by the icon (#93).
    for (const key of RESOURCE_KEYS) {
      // The cell's own tooltip names the resource and says more, so the
      // icon keeps its name for a screen reader but not a tooltip of its own.
      const cell = new CostCell(resourceIcon(key, { tooltip: false }));
      this.resourceCells.set(key, cell);
      costs.append(cell.element);
    }

    this.timeCell = new CostCell("Time", "planner-cost__cell planner-cost__cell--time");
    this.shinyCell = new CostCell(
      resourceIcon("shiny", { tooltip: false }),
      "planner-cost__cell planner-cost__cell--shiny",
    );
    this.workersCell = new CostCell("Workers", "planner-cost__cell planner-cost__cell--workers");
    // Nothing can be unplaced yet (phase 1 §1.3), so the cell starts hidden and
    // the store tool turns it on rather than adding it.
    this.unplacedCell = new CostCell(
      "Unplaced",
      "planner-cost__cell planner-cost__cell--unplaced",
    );
    this.unplacedCell.element.hidden = true;
    // Shown whatever the overlay says: a number to compare two arrangements by
    // is wanted most when the hatching is off (#55).
    this.coverageCell = new CostCell("Coverage", "planner-cost__cell planner-cost__cell--coverage");
    costs.append(
      this.timeCell.element,
      this.shinyCell.element,
      this.workersCell.element,
      this.unplacedCell.element,
      this.coverageCell.element,
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
    this.layoutsButton = layouts;
    layouts.addEventListener("click", actions.onLayouts);
    layouts.hidden = !hasLayouts;
    layouts.disabled = !hasLayouts;

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
      this.actionRow = null;
    } else {
      // The actions share a wrapper: one group at the bar's right end on a
      // desktop (#192), its own scrolling row on a phone with Apply pinned in
      // view (#151).
      const actionRow = document.createElement("div");
      actionRow.className = "planner-bar__actions";
      actionRow.append(this.upgradeWalls, this.rearm, this.checklist, layouts, this.apply);
      this.actionRow = actionRow;
      this.actionBar.append(
        costs,
        this.summary,
        this.storeChip,
        this.putBack,
        spacer(),
        actionRow,
      );
    }

    /* ── The phone-only controls (#45), mounted by `setLayout` ────────── */

    this.viewSwitch = button("3D ⇄", "Switch between the 3D yard and the blueprint (Tab)");
    this.viewSwitch.classList.add("planner-bar__view-switch");
    // Compare changes both panes' view, so this stays live through it (#9).
    this.viewSwitch.dataset["compare"] = "on";
    this.viewSwitch.addEventListener("click", () =>
      actions.onView(this.view === YardView.ISO ? YardView.BLUEPRINT : YardView.ISO),
    );

    this.moreButton = button("More", "Everything else the planner does");
    this.moreButton.classList.add("planner-bar__more");
    this.moreButton.setAttribute("aria-haspopup", "true");
    this.moreButton.setAttribute("aria-expanded", "false");
    this.moreButton.addEventListener("click", () => this.setMoreOpen(!this.moreOpen));

    this.costLine = button("", "Show every cost", "btn btn--ghost planner-bar__cost-line");
    this.costLine.setAttribute("aria-expanded", "false");
    this.costLine.addEventListener("click", () => this.setCostsOpen(!this.costsOpen));

    this.moreSheet = document.createElement("section");
    this.moreSheet.className = "panel map-panel planner-more";
    this.moreSheet.setAttribute("aria-label", "More planner tools");
    this.moreSheet.hidden = true;
    const moreTitlebar = document.createElement("header");
    moreTitlebar.className = "panel__titlebar";
    const moreTitle = document.createElement("h2");
    moreTitle.className = "panel__title";
    moreTitle.textContent = "More";
    const moreClose = button("×", "Close", "btn btn--ghost btn--icon");
    moreClose.setAttribute("aria-label", "Close");
    moreTitlebar.append(moreTitle, moreClose);
    const moreBody = document.createElement("div");
    moreBody.className = "panel__body";
    const moreSection = (heading: string): [HTMLElement, HTMLElement] => {
      const section = document.createElement("section");
      section.className = "planner-more__section";
      const title = document.createElement("h3");
      title.className = "planner-more__heading";
      title.textContent = heading;
      const list = document.createElement("div");
      list.className = "planner-more__list";
      section.append(title, list);
      moreBody.append(section);
      return [section, list];
    };
    [, this.moreView] = moreSection("Show on the yard");
    [this.morePlanSection, this.morePlan] = moreSection("Plan");
    this.moreSheet.append(moreTitlebar, moreBody);
    // A choice in the sheet closes it, as a menu does; a switch leaves it up,
    // so two overlays can be flipped in one visit.
    this.moreSheet.addEventListener("click", (event) => {
      const pressed = event.target instanceof Element ? event.target.closest("button") : null;
      if (!pressed || pressed.getAttribute("role") === "menuitemcheckbox") return;
      this.setMoreOpen(false);
    });

    this.setSummary(EMPTY_SUMMARY);
  }

  mount(container: HTMLElement): this {
    this.container = container;
    container.append(this.toolbar, this.actionBar);
    return this;
  }

  /** Which shape the bars are in, for the tests and the scene. */
  get currentLayout(): PlannerLayout {
    return this.layout;
  }

  /** The More sheet, while it is mounted (a phone). */
  get moreElement(): HTMLElement {
    return this.moreSheet;
  }

  get isMoreOpen(): boolean {
    return this.moreOpen;
  }

  /**
   * Lays the bars out for a desktop or for a phone, upright or on its side
   * (#45), and says whether the screen is touched, which is only a matter of
   * wording ("tap" where a mouse reads "click").
   */
  setLayout(layout: PlannerLayout, touch: boolean): void {
    this.touch = touch;
    if (layout !== this.layout) {
      this.layout = layout;
      this.arrange(layout);
    }
    if (this.lastState) this.summary.textContent = summarise(this.lastState, this.touch);
  }

  /**
   * Lends Mirror, Align and Distribute to `host` (a phone's building sheet),
   * or takes them back into the top bar with null. A read-only bar has none.
   */
  lendArrange(host: HTMLElement | null): void {
    const arrange = this.arrangeGroup;
    if (!arrange) return;
    if (host && isPhone(this.layout)) this.places.move(arrange, host);
    else this.places.restoreOne(arrange);
  }

  /** Opens or closes a phone's More sheet. A desktop has none. */
  setMoreOpen(open: boolean): void {
    const next = open && isPhone(this.layout);
    if (next === this.moreOpen) return;
    this.moreOpen = next;
    this.moreSheet.hidden = !next;
    this.moreButton.setAttribute("aria-expanded", String(next));
    this.moreButton.setAttribute("aria-pressed", String(next));
    this.actions.onMore?.(next);
  }

  /** Shows or hides the full cost cells under a phone's one-line cost. */
  private setCostsOpen(open: boolean): void {
    this.costsOpen = open && isPhone(this.layout);
    this.actionBar.classList.toggle("planner-bar--costs-open", this.costsOpen);
    this.costLine.setAttribute("aria-expanded", String(this.costsOpen));
    this.renderCostLine();
  }

  /**
   * Moves every control to where `layout` wants it.
   *
   * Always from the desktop arrangement: everything goes home first, so the
   * two phone shapes are each one list of moves rather than a list per pair.
   */
  private arrange(layout: PlannerLayout): void {
    this.places.restore();
    this.viewMenu.setInline(false);
    this.yardMenu.setInline(false);
    this.viewSwitch.remove();
    this.moreButton.remove();
    this.costLine.remove();
    this.setMoreOpen(false);
    this.setCostsOpen(false);
    this.moreSheet.remove();

    const phone = isPhone(layout);
    // Stamped on a phone only: the stylesheet's phone rules key off it, so a
    // window that goes back to a desktop's width must lose it, not keep "desktop".
    for (const element of [this.toolbar, this.actionBar, this.moreSheet]) {
      if (phone) element.dataset["layout"] = layout;
      else delete element.dataset["layout"];
    }
    // Glyphs where a phone has no room for the words; the names stay the same.
    this.exit.textContent = phone ? "✕" : "Leave planner";
    this.undo.textContent = phone ? "↶" : "Undo";
    this.redo.textContent = phone ? "↷" : "Redo";
    this.help.textContent = phone ? "Help" : "?";
    if (!phone) return;

    // Top: Leave first, then the name, the view switch and undo/redo. The
    // tool groups stay where they are and the stylesheet hides what is left.
    this.places.move(this.exit, this.toolbar, this.heading);
    this.heading.after(this.viewSwitch);

    // Bottom: the one-line cost beside the summary, then Box, the drawer,
    // More and Apply.
    this.summary.after(this.costLine);
    const row = this.actionRow ?? this.actionBar;
    const end = this.actionRow ? this.apply : null;
    this.places.move(this.box, row, row.firstChild);
    this.places.move(this.inventory, row, end);
    row.insertBefore(this.moreButton, end);

    // Everything else, into More.
    this.places.move(this.viewMenu.element, this.moreView);
    this.viewMenu.setInline(true);
    this.places.move(this.find, this.morePlan);
    for (const control of [this.checklist, this.layoutsButton, this.upgradeWalls, this.rearm]) {
      this.places.move(control, this.morePlan);
    }
    this.places.move(this.yardMenu.element, this.morePlan);
    this.yardMenu.setInline(!this.readOnly);
    this.places.move(this.help, this.morePlan);
    this.morePlanSection.hidden = this.morePlan.childElementCount === 0;

    if (layout === PlannerLayout.LANDSCAPE) {
      // Sideways there is one bar: Leave, undo and redo open it, and the view
      // switch joins the tools at its right end. The top bar is left empty.
      const first = this.actionBar.firstChild;
      this.places.move(this.exit, this.actionBar, first);
      this.places.move(this.undo, this.actionBar, first);
      this.places.move(this.redo, this.actionBar, first);
      row.insertBefore(this.viewSwitch, this.inventory.parentNode === row ? this.inventory : this.moreButton);
    }

    this.container?.append(this.moreSheet);
    this.renderCostLine();
  }

  /**
   * A phone's cost line: what the selection or the plan would take, compact,
   * and the worker time; or the coverage when nothing costs anything (#45).
   */
  private renderCostLine(): void {
    const parts = costLineParts(this.line.needed, this.line.shortfall, this.line.seconds);
    const children: Node[] = [];
    if (parts.length === 0) {
      children.push(document.createTextNode(this.line.coverage));
    }
    for (const part of parts) {
      const figure = document.createElement("span");
      figure.className = "planner-bar__cost-part";
      figure.classList.toggle("planner-bar__cost-part--short", part.short);
      if (part.key !== "time") figure.append(resourceIcon(part.key, { tooltip: false }));
      figure.append(part.text);
      children.push(figure);
    }
    const caret = document.createElement("span");
    caret.className = "planner-bar__cost-caret";
    caret.setAttribute("aria-hidden", "true");
    caret.textContent = this.costsOpen ? "▴" : "▾";
    children.push(caret);
    this.costLine.replaceChildren(...children);
    this.costLine.setAttribute(
      "aria-label",
      parts.length === 0
        ? `${this.line.coverage}. Show every cost`
        : `Costs ${parts.map((part) => part.text).join(", ")}. Show every cost`,
    );
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
    readonly deadZones: boolean;
  }): void {
    this.viewMenu.setChecked("ranges", toggles.ranges);
    // Dimmed only while neither the discs nor the dead zones read them.
    this.viewMenu.setChecked("land", toggles.land, !toggles.ranges && !toggles.deadZones);
    this.viewMenu.setChecked("air", toggles.air, !toggles.ranges && !toggles.deadZones);
    this.viewMenu.setChecked("deadZones", toggles.deadZones);
    this.viewMenu.setChecked("centre", toggles.centre);
  }

  /**
   * Turns the Blueprint button off with the reason as its tooltip, or back
   * on with null (owner decision 2026-09-30: it needs a Yard Planner, and an
   * outpost never has it).
   */
  setBlueprintBlocked(reason: string | null): void {
    const blueprint = this.views.get(YardView.BLUEPRINT);
    if (!blueprint) return;
    blueprint.disabled = reason !== null;
    blueprint.title = reason ?? "Flat top-down view for planning (Tab switches)";
    blueprint.setAttribute("aria-label", reason ? `Blueprint. ${reason}` : "Blueprint");
  }

  /** Redraws from the session's state. */
  update(state: PlannerState): void {
    this.lastState = state;
    this.tool = state.tool;
    this.view = state.view;
    this.viewSwitch.textContent = state.view === YardView.ISO ? "3D ⇄" : "Blueprint ⇄";
    this.viewSwitch.setAttribute(
      "aria-label",
      state.view === YardView.ISO ? "Showing the 3D yard. Switch to the blueprint" : "Showing the blueprint. Switch to the 3D yard",
    );
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

    this.summary.textContent = summarise(state, this.touch);
    // A desktop cuts a long summary to an ellipsis when the bar is short of room (#192).
    this.summary.title = this.summary.textContent;
    // A read-only session never mounts the chip; hiding it as well keeps the
    // two states from disagreeing if one ever slips through.
    this.putBack.hidden = this.readOnly || !state.carrying;
    if (this.readOnly) return;

    this.setStoreEnabled(state.selectionCount);
    // Nothing to store while something is already in hand, and the chip would
    // sit next to "Put back" saying the opposite thing.
    this.storeChip.hidden = state.selectionCount === 0 || state.carrying;
    this.setStoredCount(state.storedCount, state.unplacedCount);
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

    this.line.seconds = summary.seconds;
    this.renderCostLine();
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
    this.line.seconds = totals.seconds;
    this.renderCostLine();
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
      ? `\n${preview.started.length} would start on Apply, ${preview.waiting.length} would wait for a worker, ${preview.finished.length} wall and trap ${preview.finished.length === 1 ? "step" : "steps"} would finish instantly.`
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
  /**
   * The share of the plot the towers reach, land and air (#55): "Land 87% ·
   * Air 41%", or "No towers" when none is placed.
   */
  setCoverage(coverage: CoverageFigures): void {
    this.line.coverage =
      coverage.towers === 0
        ? "No towers"
        : `Land ${percentText(coverage.land)} · Air ${percentText(coverage.air)}`;
    this.renderCostLine();
    if (coverage.towers === 0) {
      this.coverageCell.set(
        "No towers",
        "No towers placed, so there is nothing to cover.",
      );
      return;
    }
    const land = percentText(coverage.land);
    const air = percentText(coverage.air);
    this.coverageCell.set(
      `Land ${land} · Air ${air}`,
      `How much of the yard is within reach of at least one defence tower: ${land} for creeps on the ground, ${air} for flyers. View › Dead zones shows the rest.`,
    );
  }

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
    this.line.needed = needed;
    this.line.shortfall = shortfall;
    for (const key of RESOURCE_KEYS) {
      const label = RESOURCE_NAMES[key];
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
  /**
   * The drawer's count on its button, and in the Unplaced cell what of it
   * blocks Apply: a decoration in the drawer does not (#128), so `unplaced`
   * leaves those out. Absent, everything counts.
   */
  setStoredCount(count: number, unplaced = count): void {
    if (this.readOnly) return;
    this.inventoryBadge.hidden = count === 0;
    this.inventoryBadge.textContent = String(count);
    this.inventory.disabled = count === 0;
    this.inventory.title =
      count === 0
        ? "Nothing is stored"
        : `${count} ${count === 1 ? "building is" : "buildings are"} in the drawer`;
    this.setUnplaced(unplaced);
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
    this.moreSheet.remove();
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

const summarise = (state: PlannerState, touch = false): string => {
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
    // The next one off the stack follows each drop (#57), so this is worded
    // as a run rather than a single placement.
    parts.push(
      touch
        ? "out of the drawer · tap the yard once per building"
        : "out of the drawer · click the yard once per building, Esc to stop",
    );
  } else if (state.carrying) {
    // Both spellings of "put it back" for a mouse, because a desktop can be
    // touched too; a phone has no second button and no Esc (F14, #45).
    parts.push(
      touch
        ? "in hand · tap to drop it, or Put back"
        : "in hand · click to drop, right-click or Put back to cancel",
    );
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
