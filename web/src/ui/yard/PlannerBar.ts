import { tutTarget, TutTarget } from "@/game/guide/targets";
import { PlannerTool, type PlannerState } from "@/game/yard/planner/PlannerSession";
import { YardView } from "@/game/yard/YardRenderer";
import { attachPopover } from "@/ui/Popover";
import { demo, type DemoName } from "./demos";
import { isPhone, PlannerLayout } from "./plannerLayout";
import { iconFace, PLANNER_ICON_WORDS, type PlannerIcon } from "./plannerIcons";

/**
 * The planner's two bars: tools across the top, the actions along the bottom
 * (design §4.1).
 *
 * HTML rather than canvas, as §4 asks, so the buttons get real focus, real
 * tooltips and real keyboard behaviour for nothing. Every control carries its
 * shortcut in the tooltip, because that is the only place a player will look
 * for it.
 *
 * The bar is stateless: `update` is handed the session's state and rewrites the
 * bits that changed. Nothing here calls back into the plan.
 *
 * ## Buttons only (owner, 2026-11-04)
 *
 * The bottom bar used to open with the plan's costs, the free workers, the
 * unplaced count, the coverage and a "N picked" line. The owner found it
 * redundant and asked for all of it to go: what walls cost is in the Upgrade
 * walls window, the coverage in the dead-zones panel, and Apply's blockers in
 * the Checklist. Mirror, Align and Distribute went the same day. The tools
 * that remain and are pressed often (Undo, Redo, Select, Box, Find, Upgrade
 * walls, Re-arm traps) are square icon buttons whose words live in the
 * tooltip and the accessible name; `plannerIcons.ts` holds their faces.
 *
 * ## Touch
 *
 * Two things here are F14's. The "Put back" chip appears on the bottom bar
 * while something is in hand, because a finger cannot right-click the carried
 * selection to put it down again. And every button in both bars is given a
 * 44 px target under `@media (pointer: coarse)` in `planner.css` — the size the
 * spec asks for, applied by how the device is being touched rather than by how
 * wide the window is, so a small window on a laptop keeps its compact bar.
 *
 * ## Phones (#45)
 *
 * `setLayout` rearranges the same controls for a phone, the owner's Option A,
 * with what a thumb presses most on the bottom row (owner, 2026-11-04: "ensure
 * the mobile layout is intuitive too"). Upright: a top bar of Leave, the
 * layout's name, the 3D ⇄ Blueprint switch, Undo and Redo; a bottom bar of
 * Box, Upgrade walls, the drawer, More and Apply, with the Store chip or Put
 * back above them only while there is something to store or put back. Undo
 * and Redo went up top because seven 44 px buttons do not fit 375 px: Apply
 * was laid over More (lead, 2026-11-04). Sideways: all of that in one bar
 * along the bottom.
 * Everything else (Find, Checklist, Layouts, Re-arm traps, Clear yard, the
 * View switches and Help) moves into the More sheet, and the scene's
 * selection row (Select all of a type) sits at the top of More
 * (`setSelectionTools`). The controls are moved, not copied, so every state
 * this class keeps (a count on the drawer) is right in either place; and they
 * are moved back exactly where they were when the window returns to a
 * desktop's shape. A desktop never sees the phone-only controls at all: they
 * are not in the document.
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
 * selection tools, Find and the view switch.
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

const button = (label: string, title: string, className = "btn btn--ghost"): HTMLButtonElement => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  element.title = title;
  return element;
};

/**
 * A square icon button (owner, 2026-11-04): the face from `plannerIcons.ts`,
 * the words as its accessible name, and the shortcut in its tooltip.
 */
const iconButton = (name: PlannerIcon, title: string): HTMLButtonElement => {
  const element = button("", title, "btn btn--ghost planner-bar__icon");
  element.dataset["icon"] = name;
  element.setAttribute("aria-label", PLANNER_ICON_WORDS[name].words);
  element.append(iconFace(name));
  return element;
};

/** Redraws an icon button's face, words or glyph, leaving a badge alone. */
const setFace = (element: HTMLButtonElement, name: PlannerIcon, compact: boolean): void => {
  element.querySelector(":scope > .planner-bar__face")?.replaceWith(iconFace(name, compact));
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
 * pointer events at all over a disabled button — and a disabled Store is
 * exactly when a player wants to know what Store does.
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
 * The View switches and Clear yard each sit behind one trigger, so the top
 * bar stays one row on a laptop. Written by hand rather than with `<select>` or `<details>`
 * because both of those carry a meaning this does not have: a select holds a
 * value, and a details discloses content rather than firing an action.
 *
 * It closes on a choice, on Escape and on a press anywhere else, which are the
 * three ways anyone tries to dismiss a menu. Disabling the trigger closes it
 * too: a menu of dead rows is worse than no menu.
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
      // Low on the screen (a phone's bottom bar, #45) it opens
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

export class PlannerBar {
  readonly toolbar: HTMLElement;
  readonly actionBar: HTMLElement;

  private readonly tools = new Map<PlannerTool, HTMLButtonElement>();
  private readonly views = new Map<YardView, HTMLButtonElement>();
  /** Detaches every popover the bar attached. */
  private readonly popovers: (() => void)[] = [];
  private readonly viewMenu: Menu;
  private readonly undo: HTMLButtonElement;
  private readonly redo: HTMLButtonElement;
  private readonly apply: HTMLButtonElement;
  private readonly checklist: HTMLButtonElement;
  private readonly upgradeWalls: HTMLButtonElement;
  private readonly rearm: HTMLButtonElement;
  private readonly rearmBadge: HTMLElement;
  private readonly putBack: HTMLButtonElement;
  private readonly store: HTMLButtonElement;
  private readonly storeChip: HTMLButtonElement;
  private readonly inventory: HTMLButtonElement;
  private readonly inventoryBadge: HTMLElement;
  private readonly yardMenu: Menu;
  private readonly slotLabel: HTMLElement;
  private readonly readOnly: boolean;
  private readonly actions: PlannerBarActions;

  /* ── Phones (#45) ─────────────────────────────────────────────────── */

  private layout: PlannerLayout = PlannerLayout.DESKTOP;
  private readonly places = new Relocator();
  private container: HTMLElement | null = null;
  private readonly heading: HTMLElement;
  private readonly box: HTMLButtonElement;
  private readonly find: HTMLButtonElement;
  private readonly layoutsButton: HTMLButtonElement;
  private readonly help: HTMLButtonElement;
  private readonly exit: HTMLButtonElement;
  /** Upgrade walls, re-arm, Checklist, Layouts and Apply. Null when read-only. */
  private readonly actionRow: HTMLElement | null;
  /** One button for the two views, which a phone has no room to show side by side. */
  private readonly viewSwitch: HTMLButtonElement;
  private readonly moreButton: HTMLButtonElement;
  private readonly moreSheet: HTMLElement;
  /** More's first section on a phone: Select all of a type (#45). */
  private readonly moreSelectionSection: HTMLElement;
  private readonly moreSelection: HTMLElement;
  private readonly moreView: HTMLElement;
  private readonly morePlanSection: HTMLElement;
  private readonly morePlan: HTMLElement;
  private moreOpen = false;
  private tool: PlannerTool = PlannerTool.SELECT;
  private view: YardView = YardView.ISO;

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

    const select = iconButton("select", "Select: click a building, Shift+drag for a box (V)");
    select.addEventListener("click", () => actions.onTool(PlannerTool.SELECT));
    const box = iconButton("box", "Box select: drag a box over buildings (B)");
    // On a phone Select has no button of its own: Box is a switch, and off is Select.
    box.addEventListener("click", () =>
      actions.onTool(
        isPhone(this.layout) && this.tool === PlannerTool.BOX ? PlannerTool.SELECT : PlannerTool.BOX,
      ),
    );
    this.tools.set(PlannerTool.SELECT, select);
    this.tools.set(PlannerTool.BOX, box);
    this.box = box;

    const find = iconButton("find", "Find buildings by name or type (F)");
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

    this.undo = iconButton("undo", "Undo (Ctrl+Z)");
    this.undo.addEventListener("click", actions.onUndo);
    this.redo = iconButton("redo", "Redo (Ctrl+Shift+Z or Ctrl+Y)");
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

    const history = group(this.undo, this.redo);
    history.classList.add("planner-bar__group--history");

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
            history,
          ]),
      spacer(),
      help,
      exit,
    );

    /* ── Bottom bar ─────────────────────────────────────────────────── */

    this.actionBar = document.createElement("div");
    this.actionBar.className = "planner-bar planner-bar--bottom";
    this.actionBar.setAttribute("aria-label", "Planner actions");

    /*
     * F14's "put back", for a hand that has no second button.
     *
     * Only on screen while something is in hand, because that is the only
     * moment it means anything, and at the start of the bottom bar rather
     * than out among the actions: it undoes a gesture, not an edit.
     */
    this.putBack = button(
      "Put back",
      "Put the buildings in hand back where they were (Esc)",
      "btn btn--ghost planner-bar__put-back",
    );
    this.putBack.hidden = true;
    this.putBack.addEventListener("click", actions.onPutBack);

    /*
     * The same Store the toolbar has, as a chip on a phone's bottom bar while
     * something is selected: a phone's top bar has no Store and no Delete
     * key, so this is its only way to store. A desktop never shows it (the
     * stylesheet hides it there; the top bar's Store is the one).
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

    // Pressed first, then the walls are picked on the yard (owner, 2026-11-04):
    // a switch, pressed while the picking runs.
    this.upgradeWalls = iconButton("wallupgrade", "No walls in this yard");
    this.upgradeWalls.classList.add("planner-bar__walls");
    this.upgradeWalls.disabled = true;
    this.upgradeWalls.setAttribute("aria-pressed", "false");
    this.upgradeWalls.addEventListener("click", actions.onUpgradeWalls);

    // The label and the badge are separate children so the count can be
    // rewritten without the label being rebuilt around it.
    this.rearm = iconButton("rearm", "No fired traps to put back");
    this.rearm.classList.add("planner-bar__rearm");
    this.rearmBadge = document.createElement("span");
    this.rearmBadge.className = "planner-bar__badge";
    this.rearmBadge.hidden = true;
    this.rearm.append(this.rearmBadge);
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
      this.actionBar.append(spacer());
      this.actionRow = null;
    } else {
      // The actions share a wrapper: one group at the bar's right end on a
      // desktop (#192), its own scrolling row on a phone with Apply pinned in
      // view (#151).
      const actionRow = document.createElement("div");
      actionRow.className = "planner-bar__actions";
      actionRow.append(this.upgradeWalls, this.rearm, this.checklist, layouts, this.apply);
      this.actionRow = actionRow;
      this.actionBar.append(this.storeChip, this.putBack, spacer(), actionRow);
    }

    /* ── The phone-only controls (#45), mounted by `setLayout` ────────── */

    this.viewSwitch = button("3D ⇄", "Switch between the 3D yard and the blueprint (Tab)");
    this.viewSwitch.classList.add("planner-bar__view-switch");
    // Compare changes both panes' view, so this stays live through it (#9).
    this.viewSwitch.dataset["compare"] = "on";
    this.viewSwitch.addEventListener("click", () =>
      actions.onView(this.view === YardView.ISO ? YardView.BLUEPRINT : YardView.ISO),
    );

    this.moreButton = button("⋯", "More: Find, Checklist, Layouts, Re-arm traps, the View switches and Help");
    this.moreButton.setAttribute("aria-label", "More");
    this.moreButton.classList.add("planner-bar__more");
    this.moreButton.setAttribute("aria-haspopup", "true");
    this.moreButton.setAttribute("aria-expanded", "false");
    this.moreButton.addEventListener("click", () => this.setMoreOpen(!this.moreOpen));

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
    [this.moreSelectionSection, this.moreSelection] = moreSection("Selection");
    this.moreSelectionSection.classList.add("planner-more__section--selection");
    this.moreSelectionSection.hidden = true;
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
    if (layout !== this.layout) {
      this.layout = layout;
      this.arrange(layout);
    }
    // A finger has no Esc and no right button: the chip is the way back.
    this.putBack.title = touch
      ? "Put the buildings in hand back where they were"
      : "Put the buildings in hand back where they were (Esc or right-click)";
  }

  /**
   * Puts the scene's selection row (Select all of a type) at the top of a
   * phone's More sheet, or takes it out with
   * null (#45). The section follows the row's own `hidden`, so the scene calls
   * this again whenever the selection changes what the row offers.
   *
   * It used to live in the building sheet, which opened over the yard on every
   * selection; that sheet was removed on 2026-11-03 (owner: nothing may open
   * over the yard while a building is picked up or moved).
   */
  setSelectionTools(tools: HTMLElement | null): void {
    if (!tools || !isPhone(this.layout)) {
      if (this.moreSelection.firstChild) this.moreSelection.replaceChildren();
      this.moreSelectionSection.hidden = true;
      return;
    }
    if (tools.parentNode !== this.moreSelection) this.moreSelection.replaceChildren(tools);
    this.moreSelectionSection.hidden = tools.hidden;
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
    this.setMoreOpen(false);
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
    setFace(this.undo, "undo", phone);
    setFace(this.redo, "redo", phone);
    this.help.textContent = phone ? "Help" : "?";
    if (!phone) return;

    // Top, upright: Leave, the layout's name and the view switch, the things
    // pressed least, then Undo and Redo at the right end. The tool groups stay
    // where they are and the stylesheet hides what is left.
    this.places.move(this.exit, this.toolbar, this.heading);
    this.heading.after(this.viewSwitch);
    const sideways = layout === PlannerLayout.LANDSCAPE;
    if (!sideways) {
      this.places.move(this.undo, this.toolbar, this.viewSwitch.nextSibling);
      this.places.move(this.redo, this.toolbar, this.undo.nextSibling);
    }

    // Bottom, under the thumb (owner, 2026-11-04: "ensure the mobile layout
    // is intuitive too"): Box, Upgrade walls, the drawer, More and Apply, the
    // presses a planning session is made of; sideways Undo and Redo join them
    // after Box. The Store chip and Put back sit over them only while there is
    // something to store or put back.
    //
    // Width budget, upright (no test runner here lays out pixels, so it is
    // kept by hand): Box 44 + Upgrade walls 44 + Stored ~88 + More 44 +
    // Apply ~88 = 308, four 2 px gaps = 8, the bar's 8 px padding each side =
    // 16; 332 px, under the 360 px of a common Android phone. Seven buttons
    // (Undo and Redo too) came to 424 and laid Apply over More.
    const row = this.actionRow ?? this.actionBar;
    const end = this.actionRow ? this.apply : null;
    this.places.move(this.box, row, row.firstChild);
    let after: Node = this.box;
    if (sideways) {
      this.places.move(this.undo, row, after.nextSibling);
      this.places.move(this.redo, row, this.undo.nextSibling);
      if (this.redo.parentNode === row) after = this.redo;
    }
    if (this.actionRow) this.places.move(this.upgradeWalls, row, after.nextSibling);
    this.places.move(this.inventory, row, end);
    row.insertBefore(this.moreButton, end);

    // Everything else, into More: what a session needs now and then.
    this.places.move(this.viewMenu.element, this.moreView);
    this.viewMenu.setInline(true);
    this.places.move(this.find, this.morePlan);
    for (const control of [this.checklist, this.layoutsButton, this.rearm]) {
      this.places.move(control, this.morePlan);
    }
    this.places.move(this.yardMenu.element, this.morePlan);
    this.yardMenu.setInline(!this.readOnly);
    this.places.move(this.help, this.morePlan);
    this.morePlanSection.hidden = this.morePlan.childElementCount === 0;

    if (sideways) {
      // Sideways there is one bar: Leave opens it, and the view switch joins
      // the tools before the drawer. The top bar is left empty.
      this.places.move(this.exit, this.actionBar, this.actionBar.firstChild);
      row.insertBefore(this.viewSwitch, this.inventory.parentNode === row ? this.inventory : this.moreButton);
    }

    this.container?.append(this.moreSheet);
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
    this.upgradeWalls.setAttribute("aria-pressed", String(state.wallPicking));
    // Picking walls (owner, 2026-11-04): the Upgrade walls window says what
    // the pick is and what it costs, and nothing picked may be stored.
    this.actionBar.classList.toggle("planner-bar--wall-pick", state.wallPicking);

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

    // A read-only session never mounts the chip; hiding it as well keeps the
    // two states from disagreeing if one ever slips through.
    this.putBack.hidden = this.readOnly || !state.carrying;
    if (this.readOnly) return;

    this.setStoreEnabled(state.selectionCount);
    // Nothing to store while something is already in hand, and the chip would
    // sit next to "Put back" saying the opposite thing.
    this.storeChip.hidden = state.selectionCount === 0 || state.carrying || state.wallPicking;
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
   * How many buildings the drawer holds: the badge on the drawer button, and
   * whether that button can be opened at all. (What of it blocks Apply is the
   * Checklist's to say.)
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
  }

  /** Shows the count of blocking problems on the checklist button. */
  setBlocking(count: number): void {
    if (this.readOnly) return;
    this.checklist.textContent = count > 0 ? `Checklist · ${count}` : "Checklist";
    this.checklist.classList.toggle("planner-bar__checklist--bad", count > 0);
  }

  /**
   * How many walls stand in the yard. Upgrade walls is pressed first and the
   * walls picked after (owner, 2026-11-04), so only a yard without any greys
   * it out.
   */
  setWallCount(count: number): void {
    if (this.readOnly) return;
    this.upgradeWalls.disabled = count === 0;
    this.upgradeWalls.title =
      count === 0 ? "No walls in this yard" : "Upgrade walls: pick walls on the yard and raise them a level";
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
        : `Re-arm traps: put ${count} fired ${count === 1 ? "trap" : "traps"} back where ${count === 1 ? "it" : "they"} stood`;
    this.rearm.setAttribute("aria-label", count === 0 ? "Re-arm traps" : `Re-arm traps, ${count} fired`);
  }

  destroy(): void {
    // The menus listen on the document, so dropping the bar is not enough.
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
