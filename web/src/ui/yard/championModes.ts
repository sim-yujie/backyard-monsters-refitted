import {
  CHAMPION_STANCES,
  championByType,
  hasHabits,
  type ChampionStance,
} from "@/game/combat/rules";
import {
  STANCE_NAMES,
  habitAttacks,
  modeView,
  naturalRow,
  type TraitIcon,
  type TraitRow,
} from "@/game/yard/championBrain";

/**
 * How a champion with habits fights, in the Champion Cage (champion modes
 * round 2, option B "Instincts and Habits"; design
 * `review-desk/drafts/champion-modes-fable.md`): one tab per Mode with the
 * attacks fought in it, the Mode's instincts marked "always", each habit in
 * the champion's row with 0 to 3 pips, and Forget for that Mode's habits.
 *
 * Krallen has no habits (owner, 10 Nov): the cage keeps the old block for any
 * champion without them.
 */

/** The tabs' order, as the attack screen's Mode picker lists them. */
const TAB_ORDER: readonly ChampionStance[] = ["offensive", "defensive", "hybrid"];

/**
 * PLACEHOLDER until painted icons (Codex): plain line shapes from the
 * design's mock-up (`champion-modes-mockup.html`), drawn in the text colour
 * so the Modern and Classic looks both show them.
 */
const PLACEHOLDER_ICON_PATHS: Readonly<Record<TraitIcon, string>> = {
  tower: "M7 21V9l5-5 5 5v12M4 21h16M10 13h4",
  finish: "M5 19 19 5M14 5h5v5M5 9l4 4",
  guard: "M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z",
  air: "M3 9c4-5 14-5 18 0M12 9v11M8 20h8M12 4v1",
  gun: "M4 14h12l4-4M4 14v5h6v-5M9 14V9h4",
  dodge: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18M6 6l12 12",
  pack: "M8 9a3 3 0 1 0 0-.1M16 9a3 3 0 1 0 0-.1M3 20c1-4 9-4 10 0M11 20c1-4 9-4 10 0",
  skip: "M5 5l14 14M19 5 5 19",
  close: "M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11M12 10v.1",
  loot: "M5 10h14l-2 10H7zM9 10V7a3 3 0 0 1 6 0v3",
  hall: "M4 20V10l8-6 8 6v10zM10 20v-6h4v6",
  hurt: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.5-7 10-7 10M9 11h2l1-2 1 4 1-2h2",
  quake: "M3 17l4-5 3 3 4-7 3 5 4-3M3 21h18",
  crowd: "M6 9a2 2 0 1 0 0-.1M18 9a2 2 0 1 0 0-.1M12 6a2 2 0 1 0 0-.1M12 14a2 2 0 1 0 0-.1M4 19h16",
  big: "M12 4a4 4 0 1 0 0 8a4 4 0 0 0 0-8M4 21c1-7 15-7 16 0",
  none: "M5 12h14",
};

const SVG = "http://www.w3.org/2000/svg";

/** A trait's PLACEHOLDER icon, marked as one so the painted icons can replace it. */
export const placeholderIcon = (icon: TraitIcon): HTMLElement => {
  const frame = document.createElement("span");
  frame.className = "champion__trait-icon champion__trait-icon--placeholder";
  frame.dataset["placeholder"] = icon;
  frame.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", PLACEHOLDER_ICON_PATHS[icon]);
  svg.append(path);
  frame.append(svg);
  return frame;
};

/** Whether the cage shows a champion's Modes, or the old block (Krallen). */
export const showsModes = (entry: { readonly t: number }): boolean => hasHabits(championByType(entry.t));

/** The Mode the cage opens on: the one it last attacked in, else Hybrid. */
export const savedStance = (entry: { readonly s?: unknown }): ChampionStance =>
  CHAMPION_STANCES.find((stance) => stance === entry.s) ?? "hybrid";

/** What a redraw compares: a learned or forgotten habit redraws the cage. */
export const modesShape = (entry: { readonly t: number; readonly h?: unknown; readonly hs?: unknown }): string =>
  showsModes(entry)
    ? TAB_ORDER.map((stance) => {
        const mode = modeView(entry, stance);
        return `${mode.attacks}/${mode.habits.map((row) => `${row.name}${row.pips ?? 0}`).join(",")}`;
      }).join("|")
    : "";

export interface ModesBlockOptions {
  readonly entry: { readonly t: number; readonly h?: unknown; readonly hs?: unknown; readonly bs?: unknown };
  /** The tab to show. */
  readonly stance: ChampionStance;
  /** A tab was picked: the caller keeps it over redraws and swaps the block. */
  readonly onTab: (stance: ChampionStance) => void;
  /** Forget was confirmed for the shown Mode. */
  readonly onForget: (stance: ChampionStance) => void;
  /** Whether a forget is running, so its button waits. */
  readonly forgetting: (stance: ChampionStance) => boolean;
}

/** One trait's row: icon, name, and "always" for an instinct or 3 pips for a habit. */
const traitRow = (row: TraitRow, kind: "instinct" | "habit"): HTMLElement => {
  const item = document.createElement("li");
  item.className = `champion__trait champion__trait--${kind}`;
  item.title = row.what;
  const name = document.createElement("span");
  name.className = "champion__trait-name";
  name.textContent = row.name;
  item.append(placeholderIcon(row.icon), name);
  if (kind === "instinct") {
    const lock = document.createElement("span");
    lock.className = "champion__trait-always";
    lock.textContent = "always";
    item.append(lock);
    return item;
  }
  const filled = row.pips ?? 0;
  item.dataset["pips"] = String(filled);
  item.classList.toggle("champion__trait--fresh", filled === 0);
  const pips = document.createElement("span");
  pips.className = "champion__pips";
  pips.setAttribute("role", "img");
  pips.setAttribute("aria-label", `${filled} of 3`);
  for (let i = 0; i < 3; i++) {
    const pip = document.createElement("span");
    pip.className = "champion__pip";
    pip.classList.toggle("champion__pip--on", i < filled);
    pips.append(pip);
  }
  item.append(pips);
  return item;
};

const traitList = (rows: readonly TraitRow[], kind: "instinct" | "habit", label: string): HTMLElement => {
  const list = document.createElement("ul");
  list.className = `champion__traits champion__traits--${kind}`;
  list.setAttribute("aria-label", label);
  for (const row of rows) list.append(traitRow(row, kind));
  return list;
};

const tag = (text: string): HTMLElement => {
  const element = document.createElement("p");
  element.className = "champion__trait-tag";
  element.textContent = text;
  return element;
};

const group = (...children: HTMLElement[]): HTMLElement => {
  const element = document.createElement("div");
  element.className = "champion__trait-group";
  element.append(...children);
  return element;
};

/**
 * The Modes block: tabs, then the shown Mode's instincts, habits and Forget.
 * Forget asks once ("Sure?") before it calls `onForget`.
 */
export const modesBlock = (options: ModesBlockOptions): HTMLElement => {
  const { entry, stance } = options;
  const id = championByType(entry.t) ?? "";
  const block = document.createElement("div");
  block.className = "champion__part champion__part--modes";

  const tabs = document.createElement("div");
  tabs.className = "champion__modes";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "How it fights in each Mode");
  for (const one of TAB_ORDER) {
    const mode = modeView(entry, one);
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "champion__mode-tab";
    tab.dataset["stance"] = one;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(one === stance));
    tab.title = `${mode.attacks} attack${mode.attacks === 1 ? "" : "s"} in ${STANCE_NAMES[one]}`;
    const name = document.createElement("span");
    name.className = "champion__mode-name";
    name.textContent = STANCE_NAMES[one];
    const count = document.createElement("small");
    count.className = "champion__mode-count";
    count.textContent = `×${mode.attacks}`;
    tab.append(name, count);
    tab.addEventListener("click", () => {
      if (one !== stance) options.onTab(one);
    });
    tabs.append(tab);
  }

  const mode = modeView(entry, stance);
  const panel = document.createElement("div");
  panel.className = "champion__mode";
  panel.dataset["stance"] = stance;
  panel.setAttribute("role", "tabpanel");
  const instincts = mode.instincts.length > 0 ? mode.instincts : [naturalRow(id)];
  panel.append(
    group(tag("Instincts"), traitList(instincts, "instinct", "Instincts")),
    group(tag("Habits"), traitList(mode.habits, "habit", "Habits it learned")),
  );

  const foot = document.createElement("div");
  foot.className = "champion__mode-foot";
  const fade = document.createElement("p");
  fade.className = "champion__note";
  const total = habitAttacks(entry);
  fade.textContent = `${total > 0 ? `${total} attacks · ` : ""}Habits fade if they stop working.`;
  const forget = document.createElement("button");
  forget.type = "button";
  forget.className = "btn btn--ghost champion__forget";
  forget.textContent = "Forget";
  forget.title = mode.learned ? `Forget its ${STANCE_NAMES[stance]} habits` : "Nothing learned yet";
  forget.disabled = !mode.learned || options.forgetting(stance);
  let armed = false;
  forget.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      forget.textContent = "Sure?";
      forget.classList.add("champion__forget--armed");
      return;
    }
    forget.disabled = true;
    options.onForget(stance);
  });
  foot.append(fade, forget);
  panel.append(foot);

  // Named for screen readers; the tabs say it to the eye.
  const heading = document.createElement("h4");
  heading.className = "champion__heading u-visually-hidden";
  heading.textContent = "How it fights";
  block.append(heading, tabs, panel);
  return block;
};
