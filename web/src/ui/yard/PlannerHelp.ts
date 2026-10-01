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
 *
 * Since the screen tips (issue #227, `docs/design/tutorial.md` §7.1) the flag
 * also lives on the server, per account, as the planner's entry in
 * `onboarding.tips`, so it carries across devices. The tips package hands
 * this file a {@link PlannerHintRemote} while the own yard is up: "seen" is
 * then the server's word or the local key, and marking it writes both. A
 * local key the server has not heard of yet is sent up on the yard's first
 * load (the move). With no remote (tests, a yard that never loaded) it is the
 * local key alone, as before.
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

/** The server's side of the flag (issue #227): the screen tips' record for the planner. */
export interface PlannerHintRemote {
  /** Whether the account has seen the card, on any device. */
  seen(): boolean;
  /** Remembers it for the account. */
  mark(): void;
}

let remote: PlannerHintRemote | null = null;

/** Hands over the server's side of the flag while the own yard is up; null takes it back. */
export const setPlannerHintRemote = (next: PlannerHintRemote | null): void => {
  remote = next;
};

/** Whether this browser's own key says the card was seen (the server's aside). */
export const hasLocalPlannerHint = (storage: Storage | null = defaultStorage()): boolean => {
  try {
    return storage?.getItem(PLANNER_HINT_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * Whether the hint card has already been shown and dismissed.
 *
 * False whenever the answer cannot be read, which is the safe way round: the
 * cost of showing it again is a card, and the cost of not showing it is a
 * player who never learns the tools exist.
 */
export const hasSeenPlannerHint = (storage: Storage | null = defaultStorage()): boolean =>
  (remote?.seen() ?? false) || hasLocalPlannerHint(storage);

/** Remembers that it has been shown, here and for the account. Silently does nothing if it cannot. */
export const markPlannerHintSeen = (storage: Storage | null = defaultStorage()): void => {
  remote?.mark();
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
      "Store (Delete) lifts the selection off the yard into a drawer, so there is room to move the rest. Click a stack in the drawer, then click the yard once per building; Esc stops.",
  },
  {
    demo: "find",
    text: "Find (F) searches the yard by name or type and puts the camera on what it finds.",
  },
];

/**
 * The same moves, for a finger (#45).
 *
 * A phone has no Shift, no second button, no Esc and no keyboard, and its
 * controls are not where a desktop's are (Mirror and its kin are in the
 * building sheet, Find and the overlays under More), so the card says how to do
 * each thing there rather than leaving half its lines untrue.
 */
const TOUCH_HINT_ROWS: readonly HintRow[] = [
  {
    demo: "select",
    text: "Tap a building to select it. Its panel has Select all, to take every one of that type.",
  },
  {
    demo: "boxSelect",
    text: "Turn Box on and drag a box with one finger to take several at once. Two fingers still move and zoom the yard.",
  },
  {
    demo: "drag",
    text: "Hold a building until it lifts, drag it, and let go to drop it. Near the edge of the screen the yard scrolls along.",
  },
  {
    demo: "carry",
    text: "If it does not fit where you let go, it stays in hand: tap the yard to drop it, or press Put back.",
  },
  {
    demo: "mirrorH",
    text: "Mirror, Align and Distribute are in the building panel when two or more are selected.",
  },
  {
    demo: "store",
    text:
      "Store lifts the selection into the drawer, so there is room to move the rest. Tap a stack in the drawer, then tap the yard once per building; Done stops.",
  },
  {
    demo: "find",
    text: "Find, under More, searches the yard by name or type and puts the camera on what it finds.",
  },
];

/** A phone's plain rows: the two gestures with no button, and the overlays. */
const TOUCH_VIEW_ROWS: readonly string[] = [
  "Tap with two fingers to undo. Pinch to zoom, and Fit shows the whole yard.",
  "More ▸ Tower ranges draws how far every defence tower reaches — Land and Air separately, because an Aerial Defense Tower will not stop a creep walking under it.",
];

/**
 * The rows with no picture: the View menu's switches.
 *
 * They go under the demos rather than among them because Q13's card is about
 * *moves*, and turning a drawing on is not one. An animated circle appearing
 * would illustrate the button rather than the idea, which is the failure mode
 * that decision was taken to avoid.
 */
const VIEW_ROWS: readonly string[] = [
  "View ▸ Tower ranges (R) draws how far every defence tower reaches — Land and Air separately, because an Aerial Defense Tower will not stop a creep walking under it.",
  "View ▸ Centre of yard marks the middle of the plot and its two axes, for laying a base out symmetrically.",
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
  ["R", "Show or hide how far your defence towers reach"],
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
  /**
   * The screen is touched (#45): the card describes fingers, and the
   * Shortcuts tab, which is all keys, is left out.
   */
  readonly touch?: boolean;
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

  const touch = options.touch ?? false;
  const basics = touch ? hintList(TOUCH_HINT_ROWS, TOUCH_VIEW_ROWS) : hintList(HINT_ROWS, VIEW_ROWS);
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

  // A touched screen gets the pictures alone: a tab of keys it has no
  // keyboard for would be a tab of things it cannot do.
  if (touch) panel.setContent(intro, basics, footer);
  else panel.setContent(intro, tablist, basics, shortcuts, footer);
  select(touch ? "basics" : (options.tab ?? "basics"));
  return panel;
};

/** The pictures tab. */
const hintList = (hints: readonly HintRow[], plain: readonly string[]): HTMLElement => {
  const list = document.createElement("ul");
  list.className = "planner-help__rows";
  list.setAttribute("role", "tabpanel");
  for (const row of hints) {
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

  for (const line of plain) {
    const item = document.createElement("li");
    item.className = "planner-help__row planner-help__row--plain";
    const text = document.createElement("p");
    text.className = "planner-help__text";
    text.textContent = line;
    item.append(text);
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
