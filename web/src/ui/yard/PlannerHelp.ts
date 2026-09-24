import { Panel } from "@/ui/Panel";
import { demo, type DemoName } from "./demos";

/**
 * The card that meets a player the first time the planner opens, and the
 * shortcut sheet, as two tabs of one panel.
 *
 * The planner is a mode with eleven controls, three pointer gestures and
 * eighteen keys, and until now the only thing that explained any of it was a
 * `title` on each button — which is to say, nothing a player sees before they
 * have already guessed what to hover. So the first opening now shows the six
 * moves that matter, each as a picture rather than a sentence
 * (`./demos.ts`), and the `?` button brings the same card back for anyone who
 * dismissed it too fast.
 *
 * ## Why two tabs and not two panels
 *
 * The `?` button used to open the shortcut sheet, and a player who has learnt
 * where that lives should not lose it. Making the sheet the card's second tab
 * keeps one door for both: the card is what a new player needs and the sheet
 * is what a returning one does, and neither has to know the other's name.
 *
 * ## The flag
 *
 * "First time" is one `localStorage` key, read and written through try/catch.
 * A browser with storage blocked — a private window, a locked-down profile —
 * throws on the *read* as well as the write, so a failure has to mean "show
 * the card": a player who sees the card twice has lost four seconds, where one
 * who never sees it has lost the feature. The key is namespaced like the
 * session's, so clearing the site's data clears it with everything else.
 */

/** Where "the player has seen the hint card" is remembered. */
export const PLANNER_HINT_KEY = "bymr.planner.hint-seen";

/**
 * The storage the flag lives in, or null where there is none.
 *
 * Reading `window.localStorage` at all throws in a browser with site data
 * blocked, so even the lookup is guarded.
 */
const defaultStorage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/**
 * Whether the hint card has already been shown and dismissed.
 *
 * False whenever the answer cannot be read, which is the safe way round: the
 * cost of showing it again is a card, and the cost of not showing it is a
 * player who never learns the tools exist.
 */
export const hasSeenPlannerHint = (storage: Storage | null = defaultStorage()): boolean => {
  try {
    return storage?.getItem(PLANNER_HINT_KEY) === "1";
  } catch {
    return false;
  }
};

/** Remembers that it has been shown. Silently does nothing if it cannot. */
export const markPlannerHintSeen = (storage: Storage | null = defaultStorage()): void => {
  try {
    storage?.setItem(PLANNER_HINT_KEY, "1");
  } catch {
    // A full or blocked store is not worth an error: the only consequence is
    // that the card comes back next time.
  }
};

/** Forgets it, so the card shows again. Used by tests and by nothing else. */
export const forgetPlannerHint = (storage: Storage | null = defaultStorage()): void => {
  try {
    storage?.removeItem(PLANNER_HINT_KEY);
  } catch {
    // As above.
  }
};

/** Which half of the card is showing. */
export type HelpTab = "basics" | "shortcuts";

/** One row of the card: a moving picture and the one line it means. */
interface HintRow {
  readonly demo: DemoName;
  readonly text: string;
}

/**
 * The seven moves the planner is made of.
 *
 * Seven and not seventeen: this is the set a player needs before the planner
 * stops being a wall of buttons, and everything left out is on the Shortcuts
 * tab or on a button's own popover. Ordered the way a session goes — pick
 * something, pick several, move them, move them the other way, tidy them, get
 * them out of the way, find them.
 */
const HINT_ROWS: readonly HintRow[] = [
  { demo: "select", text: "Click a building to select it. Shift-click adds or removes one." },
  {
    demo: "boxSelect",
    text: "Drag a box — the Box tool (B), or hold Shift and drag — to take several at once.",
  },
  {
    demo: "drag",
    text: "Drag a selection to move it. The arrow keys nudge it one grid step, Shift ten.",
  },
  {
    demo: "carry",
    text: "Or click once to lift the selection, move the pointer, and click again to drop it.",
  },
  {
    demo: "mirrorH",
    text: "Mirror, Align and Distribute tidy a selection: two or more to mirror or align, three or more to space out.",
  },
  {
    demo: "store",
    text:
      "Store (Delete) lifts the selection off the yard into a drawer, so there is room to move the rest. Click a stack in the drawer to put one back.",
  },
  {
    demo: "find",
    text: "Find (F) searches the yard by name or type and puts the camera on what it finds.",
  },
];

/** F13's shortcut list, as it always was. */
const SHORTCUT_ROWS: readonly (readonly [string, string])[] = [
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

export interface PlannerHelpOptions {
  /** Which tab opens first. Defaults to the pictures. */
  readonly tab?: HelpTab;
  /**
   * True when this is the automatic first opening.
   *
   * The only difference it makes is the line of copy at the top: a card that
   * appeared on its own has to say why it is there, and one the player asked
   * for by pressing `?` does not.
   */
  readonly firstOpen?: boolean;
  readonly onClose: () => void;
}

/**
 * Builds the card.
 *
 * A plain `Panel`, so it closes on its own cross and the caller decides where
 * it is docked. "Got it" is the same close, with a name that says the player
 * has read it rather than that they are getting rid of it.
 */
export const plannerHelpPanel = (options: PlannerHelpOptions): Panel => {
  const panel = new Panel({
    title: "Using the layout planner",
    className: "map-panel planner-help",
    onClose: options.onClose,
  });

  const intro = document.createElement("p");
  intro.className = "planner-help__intro";
  intro.textContent = options.firstOpen
    ? "Everything you do here is a plan. Nothing moves in your yard until you press Apply."
    : "Nothing here reaches your yard until you press Apply.";

  const tablist = document.createElement("div");
  tablist.className = "planner-help__tabs";
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "Planner help");

  const basics = hintList();
  basics.id = "planner-help-basics";
  const shortcuts = shortcutList();
  shortcuts.id = "planner-help-shortcuts";

  const panels: Record<HelpTab, HTMLElement> = { basics, shortcuts };
  const tabs = new Map<HelpTab, HTMLButtonElement>();

  const select = (tab: HelpTab): void => {
    for (const [name, element] of Object.entries(panels) as [HelpTab, HTMLElement][]) {
      element.hidden = name !== tab;
    }
    for (const [name, button] of tabs) {
      button.setAttribute("aria-selected", String(name === tab));
      // One stop on the way through: a tablist is one tab stop and the arrow
      // keys move inside it, which is what a screen-reader user expects.
      button.tabIndex = name === tab ? 0 : -1;
    }
  };

  const order: readonly [HelpTab, string][] = [
    ["basics", "The basics"],
    ["shortcuts", "Shortcuts"],
  ];
  for (const [name, label] of order) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn--ghost planner-help__tab";
    button.textContent = label;
    button.id = `planner-help-tab-${name}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", panels[name].id);
    panels[name].setAttribute("aria-labelledby", button.id);
    button.addEventListener("click", () => select(name));
    tabs.set(name, button);
    tablist.append(button);
  }

  tablist.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const names = order.map(([name]) => name);
    const current = names.findIndex((name) => tabs.get(name)?.getAttribute("aria-selected") === "true");
    const next = names[(current + (event.key === "ArrowRight" ? 1 : names.length - 1)) % names.length];
    if (!next) return;
    event.preventDefault();
    select(next);
    tabs.get(next)?.focus();
  });

  const done = document.createElement("button");
  done.type = "button";
  done.className = "btn btn--primary planner-help__done";
  done.textContent = "Got it";
  done.addEventListener("click", () => panel.close());

  const footer = document.createElement("div");
  footer.className = "planner-help__footer";
  footer.append(done);

  panel.setContent(intro, tablist, basics, shortcuts, footer);
  select(options.tab ?? "basics");
  return panel;
};

/** The pictures tab. */
const hintList = (): HTMLElement => {
  const list = document.createElement("ul");
  list.className = "planner-help__rows";
  list.setAttribute("role", "tabpanel");
  for (const row of HINT_ROWS) {
    const item = document.createElement("li");
    item.className = "planner-help__row";

    const figure = document.createElement("span");
    figure.className = "planner-help__demo";
    figure.append(demo(row.demo));

    const text = document.createElement("p");
    text.className = "planner-help__text";
    text.textContent = row.text;

    item.append(figure, text);
    list.append(item);
  }
  return list;
};

/** The shortcut tab, which is the old shortcut sheet unchanged. */
const shortcutList = (): HTMLElement => {
  const list = document.createElement("dl");
  list.className = "cell-facts planner-help__shortcuts";
  list.setAttribute("role", "tabpanel");
  for (const [key, meaning] of SHORTCUT_ROWS) {
    const term = document.createElement("dt");
    term.textContent = key;
    const value = document.createElement("dd");
    value.textContent = meaning;
    list.append(term, value);
  }
  return list;
};
