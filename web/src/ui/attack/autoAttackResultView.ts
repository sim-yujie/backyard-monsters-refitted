import type { AutoAttackResponse, YardLabel } from "@/api/autoAttack";
import { championByType } from "@/game/combat/rules";
import { tribePictureUrl } from "@/game/maproom/tribeAvatars";
import { championPortrait, monsterPortrait, showPortrait } from "@/game/portraits";
import { championName, monsterName } from "@/ui/attack/ArmyPanel";
import { formatAmount } from "@/ui/format";
import { gameIcon, type GameIconName } from "@/ui/gameIcon";
import { RESOURCE_KEYS, RESOURCE_NAMES, resourceAmount } from "@/ui/resourceIcon";
import { yardName, yardPlace } from "./autoAttackText";
import type { ResultLayout } from "./resultLayout";

/**
 * The Repeat attack's result in astra's proposals (owner, 16 Nov 2026: "too
 * wordy, badly formatted"). Every look shares the parts below and puts them
 * in its own order; AutoAttackFlow adds the takeover offer into `offerHost`
 * and keeps Watch and Close under the scrolling middle.
 *
 * - **A, compact receipt:** the camp, the damage bar, the loot, what was
 *   spent; the champion, the bombs and the move folded under "Battle details".
 * - **B, two pages:** the same head, then Loot | Army tabs.
 * - **C, battle board:** a wider window, Loot and Army side by side.
 */

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const portrait = (src: Parameters<typeof showPortrait>[1], className = "arv-portrait"): HTMLImageElement => {
  const picture = make("img", className);
  showPortrait(picture, src);
  picture.alt = "";
  picture.decoding = "async";
  return picture;
};

/** "[portrait] ×20" chips, the confirm sheet's way of counting monsters. */
export const unitChips = (monsters: Readonly<Record<string, number>>): HTMLElement[] =>
  Object.entries(monsters)
    .filter(([, count]) => count > 0)
    .sort((one, other) => other[1] - one[1] || one[0].localeCompare(other[0]))
    .map(([id, count]) => {
      const chip = make("span", "arv-unit");
      chip.title = `${count.toLocaleString("en-US")} ${monsterName(id)}`;
      chip.setAttribute("aria-label", chip.title);
      chip.append(portrait(monsterPortrait(id, "icon")), make("span", "arv-unit__count", `×${count.toLocaleString("en-US")}`));
      return chip;
    });

/** A row led by a painted icon (said to screen readers by its label). */
const iconRow = (icon: GameIconName, label: string, className: string, ...content: (Node | string)[]): HTMLElement => {
  const row = make("div", `arv-row ${className}`);
  const lead = make("span", "arv-row__icon");
  lead.append(gameIcon(icon, { size: 24, label }));
  const body = make("span", "arv-row__body");
  body.append(...content);
  row.append(lead, body);
  return row;
};

/** A row led by a short word, where no painted icon says it. */
const wordRow = (word: string, className: string, ...content: (Node | string)[]): HTMLElement => {
  const row = make("div", `arv-row ${className}`);
  const body = make("span", "arv-row__body");
  body.append(...content);
  row.append(make("span", "arv-row__word", word), body);
  return row;
};

/** The camp's portrait, name and level, and "Conquered!" when it is. */
const head = (result: AutoAttackResponse): HTMLElement => {
  const box = make("div", "arv-head");
  const url = tribePictureUrl(result.tribe);
  if (url) {
    const picture = make("img", "arv-head__tribe");
    picture.src = url;
    picture.alt = "";
    box.append(picture);
  }
  const words = make("div", "arv-head__words");
  words.append(make("p", "arv-head__camp", `${result.tribe} · Level ${result.level}`));
  if (result.conquered) words.append(make("p", "arv-head__outcome arv-head__outcome--won", "Conquered!"));
  words.append(damageLine(result));
  box.append(words);
  return box;
};

/**
 * The damage once: the broken-wall icon, "0% → 94%", "+94%", and a bar with
 * what was there before, what this attack added, and a mark at 90%.
 */
const damageLine = (result: AutoAttackResponse): HTMLElement => {
  const before = Math.floor(result.damageBefore);
  const after = Math.floor(result.damageAfter);
  const added = Math.floor(result.damageAdded);
  const line = make("div", "arv-damage");
  line.setAttribute("aria-label", `Camp damage ${before}% to ${after}%, ${added}% added`);
  const numbers = make("span", "arv-damage__numbers");
  numbers.append(
    gameIcon("yarddamage2", { size: 24, label: "Camp damage", decorative: true }),
    make("span", "arv-damage__span", `${before}% → ${after}%`),
    make("span", "arv-damage__added", `+${added}%`),
  );
  const bar = make("span", "arv-damage__bar");
  bar.setAttribute("aria-hidden", "true");
  const was = make("span", "arv-damage__was");
  was.style.width = `${Math.min(100, before)}%`;
  const now = make("span", "arv-damage__now");
  now.style.width = `${Math.max(0, Math.min(100, after) - Math.min(100, before))}%`;
  const mark = make("span", "arv-damage__mark");
  mark.title = "90%: take over";
  bar.append(was, now, mark);
  // astra round 1: the mark says what it is.
  const scale = make("span", "arv-damage__scale");
  scale.setAttribute("aria-hidden", "true");
  scale.append(make("span", "arv-damage__ninety", "90% to conquer"));
  line.append(numbers, bar, scale);
  return line;
};

/** The four resources won, two by two, zeros too. */
const lootGrid = (result: AutoAttackResponse): HTMLElement => {
  const loot = make("ul", "arv-loot");
  loot.setAttribute("aria-label", "Loot kept");
  for (const key of RESOURCE_KEYS) {
    const amount = result.loot[key];
    const item = make("li", `arv-loot__item${amount > 0 ? "" : " arv-loot__item--none"}`);
    item.append(resourceAmount(key, amount, { change: "gain", tooltip: false }));
    item.title = `${RESOURCE_NAMES[key]}: ${Math.floor(amount).toLocaleString("en-US")}${amount >= 1 ? " gained" : ""}`;
    loot.append(item);
  }
  return loot;
};

const storageFull = (result: AutoAttackResponse): HTMLElement | null =>
  RESOURCE_KEYS.some((key) => result.lootLeft[key] > 0)
    ? iconRow("storagefull", "Storage full", "arv-note arv-note--storage", "Storage full: some loot left behind")
    : null;

const stalled = (result: AutoAttackResponse): HTMLElement | null =>
  result.damageAdded < 2 && !result.conquered
    ? make("p", "arv-note arv-note--stalled", "Low damage. Attack by hand to try new drop points.")
    : null;

/**
 * What the attack used up: its monsters and its bombs (astra round 2: "Used",
 * as the confirm sheet says "the attack uses up these monsters").
 */
const spentRow = (result: AutoAttackResponse): HTMLElement => {
  const chips = unitChips(result.flung);
  const row = make("div", "arv-row arv-spent");
  const lead = make("span", "arv-row__lead");
  lead.append(make("span", "arv-row__word", "Used"), gameIcon("lost", { size: 24, label: "Monsters used", decorative: true }));
  const body = make("span", "arv-row__body");
  body.append(...(chips.length > 0 ? chips : [make("span", "u-muted", "None")]));
  if (result.bombs.length > 0) {
    const bombs = make("span", "arv-unit arv-bombs");
    bombs.title = result.bombs.length === 1 ? "1 bomb" : `${result.bombs.length} bombs`;
    bombs.setAttribute("aria-label", bombs.title);
    bombs.append(gameIcon("resourcebomb", { size: 24, decorative: true }), make("span", "arv-unit__count", `×${result.bombs.length}`));
    body.append(bombs);
  }
  row.append(lead, body);
  return row;
};

/** What moved into the yards in range first, and from where to where. */
const movedRows = (result: AutoAttackResponse): HTMLElement[] => {
  const moves = result.moved ?? [];
  if (moves.length === 0) return [];
  const total: Record<string, number> = {};
  for (const move of moves) for (const [id, count] of Object.entries(move.monsters)) total[id] = (total[id] ?? 0) + count;
  const yards = result.yards ?? {};
  const place = (label: YardLabel | undefined): string => (label?.main ? yardName(label) : `(${yardPlace(label)})`);
  const routes = make("span", "arv-route");
  routes.textContent = moves.map((move) => `${place(yards[move.from])} → ${place(yards[move.to])}`).join(", ");
  return [wordRow("Moved", "arv-moved", ...unitChips(total), routes)];
};

/** Each champion: portrait, name, the heart and the health left, or "Fell". */
const championRows = (result: AutoAttackResponse): HTMLElement[] =>
  result.champions.map((champion) => {
    const level = result.plan.champions.find((one) => one.t === champion.t)?.l ?? 1;
    const unit = make("span", "arv-champion");
    unit.append(
      portrait(championPortrait(championByType(champion.t) ?? `G${champion.t}`, level, "icon")),
      make("span", "arv-champion__name", championName(champion.t)),
    );
    const alive = champion.hp > 0;
    const health = make("span", `arv-champion__health${alive ? "" : " arv-champion__health--fell"}`);
    health.append(gameIcon("health", { size: 16, label: "Health left" }), alive ? formatAmount(Math.floor(champion.hp)) : "Fell");
    health.title = alive ? `Health left: ${formatAmount(Math.floor(champion.hp))}` : "Fell in the battle";
    const row = make("div", "arv-row arv-champion-row");
    row.append(unit, health);
    return row;
  });

/** The champion and move rows, the "Battle details" of A and the Army of B and C (the bombs are in Used). */
const armyRows = (result: AutoAttackResponse): HTMLElement[] => [...championRows(result), ...movedRows(result)];

/** A: the champion, bombs and move under one disclosure, with their pictures on its line. */
const detailsFold = (result: AutoAttackResponse): HTMLElement | null => {
  const rows = armyRows(result);
  if (rows.length === 0) return null;
  const fold = make("details", "arv-fold");
  const summary = make("summary", "arv-fold__summary");
  summary.append(make("span", "arv-fold__word", "Battle details"));
  const peek = make("span", "arv-fold__peek");
  peek.setAttribute("aria-hidden", "true");
  for (const champion of result.champions) {
    const level = result.plan.champions.find((one) => one.t === champion.t)?.l ?? 1;
    peek.append(portrait(championPortrait(championByType(champion.t) ?? `G${champion.t}`, level, "icon")));
  }
  // astra round 3: the move is its own group, "[portrait] ×8 →", so it does not read as the champion moving.
  const moved: Record<string, number> = {};
  for (const move of result.moved ?? []) for (const [id, count] of Object.entries(move.monsters)) moved[id] = (moved[id] ?? 0) + count;
  if (Object.keys(moved).length > 0) {
    const group = make("span", "arv-fold__moved");
    group.append(...unitChips(moved), "→");
    peek.append(group);
  }
  summary.append(peek);
  const body = make("div", "arv-fold__body");
  body.append(...rows);
  fold.append(summary, body);
  return fold;
};

/** B: the Loot | Army tabs over their two pages. */
const tabs = (loot: HTMLElement[], army: HTMLElement[]): HTMLElement[] => {
  const strip = make("div", "arv-tabs");
  strip.setAttribute("role", "tablist");
  const pages = [make("div", "arv-page arv-page--loot"), make("div", "arv-page arv-page--army")];
  pages[0]!.append(...loot);
  pages[1]!.append(...army);
  const labels = ["Loot", "Army"];
  const buttons = labels.map((label, index) => {
    const tab = make("button", "arv-tab", label);
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.id = `arv-tab-${index}`;
    pages[index]!.setAttribute("role", "tabpanel");
    pages[index]!.setAttribute("aria-labelledby", tab.id);
    return tab;
  });
  // astra round 2: both pages share one grid cell, so the window keeps the
  // taller page's height and nothing jumps when the tab changes.
  const stack = make("div", "arv-pages");
  stack.append(...pages);
  const choose = (chosen: number): void => {
    buttons.forEach((tab, index) => {
      tab.setAttribute("aria-selected", String(index === chosen));
      tab.classList.toggle("arv-tab--on", index === chosen);
      pages[index]!.classList.toggle("arv-page--off", index !== chosen);
      pages[index]!.inert = index !== chosen;
      pages[index]!.setAttribute("aria-hidden", String(index !== chosen));
    });
  };
  buttons.forEach((tab, index) => tab.addEventListener("click", () => choose(index)));
  choose(0);
  strip.append(...buttons);
  return [strip, stack];
};

/** C: a titled column. */
const column = (title: string, className: string, rows: (HTMLElement | null)[]): HTMLElement => {
  const box = make("section", `arv-col ${className}`);
  box.setAttribute("aria-label", title);
  box.append(make("h3", "arv-col__title", title), ...rows.filter((row): row is HTMLElement => row !== null));
  return box;
};

export interface ResultView {
  /** Stays on top: the camp and the damage. */
  readonly head: HTMLElement;
  /** Scrolls when the screen is short. */
  readonly middle: HTMLElement[];
  /** Where the takeover offer goes, when the camp was conquered. */
  readonly offerHost: HTMLElement | null;
  /** C with army rows to show: the wider window. */
  readonly wide: boolean;
}

/** One of astra's looks for this result. */
export const resultView = (layout: Exclude<ResultLayout, "today">, result: AutoAttackResponse): ResultView => {
  const offerHost = result.conquered ? make("div", "arv-offer") : null;
  const keep = (list: (HTMLElement | null)[]): HTMLElement[] => list.filter((one): one is HTMLElement => one !== null);
  // astra round 2: the storage note right above the loot it explains; the stalled one under it.
  const full = storageFull(result);
  const low = stalled(result);
  const lootPart = (): HTMLElement[] => keep([full, lootGrid(result), low]);
  const rows = armyRows(result);
  // Nothing but what was spent (astra round 1): every look is the plain receipt, no tabs, no second column.
  if (layout === "A" || rows.length === 0) {
    const middle = keep([...lootPart(), spentRow(result), layout === "A" ? detailsFold(result) : null, offerHost]);
    return { head: head(result), middle, offerHost, wide: false };
  }
  if (layout === "B") {
    // astra round 2: what was used shows above the tabs, on both pages.
    // astra round 3: the offer sits under both pages, not on the Loot page only.
    return { head: head(result), middle: keep([spentRow(result), ...tabs(lootPart(), rows), offerHost]), offerHost, wide: false };
  }
  // C: on a phone upright the army's other rows fold under "Army details" (astra round 1);
  // wider, they show in the column. Both are built; the screen size picks one.
  const shown = make("div", "arv-army-rows");
  shown.append(...rows);
  const fold = make("details", "arv-fold arv-fold--army");
  const summary = make("summary", "arv-fold__summary");
  summary.append(make("span", "arv-fold__word", "Details"));
  const body = make("div", "arv-fold__body");
  body.append(...armyRows(result));
  fold.append(summary, body);
  const board = make("div", "arv-board");
  board.append(
    column("Loot", "arv-col--loot", lootPart()),
    column("Army", "arv-col--army", [spentRow(result), shown, fold]),
  );
  return { head: head(result), middle: keep([board, offerHost]), offerHost, wide: true };
};
