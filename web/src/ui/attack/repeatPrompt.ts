import type { NoRoom, PlanShortfall, PlanSummary, YardLabel, YardMove } from "@/api/autoAttack";
import { classicLook } from "@/game/classicLook";
import { BOMBS, championByType, monsterName } from "@/game/combat/rules";
import { championPortrait, monsterPortrait } from "@/game/portraits";
import { championName } from "@/ui/attack/ArmyPanel";
import { gameIcon, type GameIconName } from "@/ui/gameIcon";
import { resourceIcon, resourceKeyOf } from "@/ui/resourceIcon";
import { bombSize, grid, paintedCard, portrait, tile } from "./AttackWindow";
import { catapultLabel, feeLabel, puttyAmount, yardName, yardPlace } from "./autoAttackText";
import { tribeGoalPicture } from "./RepeatBar";
import "@/ui/styles/repeat-prompt.css";

/**
 * Repeat attack's sheet, look A "like the Attack window" (owner, 20 Nov 2026):
 *
 * - the camp: the tribe's portrait, its name, "Lv N" and a damage chip;
 * - the army as the hand Attack window's tiles: the champions ("Lv 6") and
 *   every monster kind with its count, then the Catapult's shots as resource
 *   piles with a size word, one per resource and no count;
 * - Repeat attack's putty fee (owner, 20 Nov 2026; astra, round 1): the putty pile and the
 *   amount, under the Catapult, and a warning-coloured shortage (the owner
 *   dropped the "Spent on start" note, 20 Nov 2026);
 * - Smart Repeat attack's moves, one card per move: the yard they leave, the
 *   monsters as small tiles, an arrow, the yard in range; the list scrolls
 *   inside the sheet, with a "more below" cue that shows on a touch screen;
 * - the refusals keep the same camp and army, then their reason and what is
 *   short, each with its picture.
 *
 * No monster names as words: a tile says its name in its tooltip and to a
 * screen reader only. No sentences beyond the refusal's reason and the
 * yellow "Your yards changed" banner.
 */

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const fmt = (count: number): string => count.toLocaleString("en-US");

/** The monster kinds of a plan or a move, biggest first. */
export const byCount = (monsters: Readonly<Record<string, number>>): [string, number][] =>
  Object.entries(monsters)
    .filter(([, count]) => count > 0)
    .sort((one, other) => other[1] - one[1] || one[0].localeCompare(other[0]));

/* ── The camp ───────────────────────────────────────────────────────────── */

const damageChip = (damage: number): HTMLElement => {
  const chip = el("span", "repeat-prompt__damage");
  chip.title = `Camp damage ${damage}%`;
  chip.setAttribute("aria-label", chip.title);
  chip.append(gameIcon("damage", { size: 24, decorative: true }), el("span", "", `${damage}%`));
  return chip;
};

/** The tribe's portrait, then the camp's name over its level and damage. */
export const campHead = (plan: Pick<PlanSummary, "tribe" | "level">, damage: number): HTMLElement => {
  const head = el("div", "repeat-prompt__camp");
  const url = tribeGoalPicture(plan.tribe);
  if (url) {
    const frame = el("span", "repeat-prompt__tribe");
    const image = document.createElement("img");
    image.src = url;
    image.alt = "";
    image.decoding = "async";
    frame.append(image);
    head.append(frame);
  }
  const words = el("div", "repeat-prompt__camp-words");
  const name = el("span", "repeat-prompt__camp-name", plan.tribe);
  name.append(el("span", "repeat-prompt__camp-word", " camp"));
  const facts = el("span", "repeat-prompt__camp-facts");
  const level = el("span", "repeat-prompt__level", `Lv ${plan.level}`);
  level.title = `Camp level ${plan.level}`;
  facts.append(level, damageChip(Math.floor(damage)));
  words.append(name, facts);
  head.append(words);
  return head;
};

/* ── The army ───────────────────────────────────────────────────────────── */

export const monsterTile = (id: string, count: number, extra = ""): HTMLElement => {
  const picture = monsterPortrait(id, "icon");
  const element = tile(
    portrait(picture),
    `×${fmt(count)}`,
    `${monsterName(id)} ×${fmt(count)}`,
    `attack-window__tile--monster repeat-prompt__monster${extra ? ` ${extra}` : ""}`,
  );
  element.dataset["monster"] = id;
  paintedCard(element, picture, "ground");
  return element;
};

export const championTile = (champion: PlanSummary["champions"][number]): HTMLElement => {
  const picture = championPortrait(championByType(champion.t) ?? `G${champion.t}`, champion.l, "icon");
  const element = tile(
    portrait(picture),
    `Lv ${champion.l}`,
    `${championName(champion.t)}, level ${champion.l}`,
    "attack-window__tile--champion repeat-prompt__champion",
  );
  paintedCard(element, picture, "cut-out");
  return element;
};

/** A catapult shot's resource pile. */
const bombPile = (id: string): HTMLElement =>
  resourceIcon(resourceKeyOf(BOMBS.find((one) => one.id === id)?.resource ?? 1), { decorative: true, realm: "surface" });

/**
 * The catapult's shots, one tile per resource: the pile and its size word,
 * never a count. A catapult flings each resource at most once per attack
 * (`BOMBS`, `ResourceBombs.as:310-314`), so a plan holding a second shot of a
 * resource shows the first (owner, 20 Nov 2026).
 */
export const catapultShots = (bombs: readonly string[]): string[] => {
  const seen = new Set<number>();
  return bombs.filter((id) => {
    const resource = BOMBS.find((one) => one.id === id)?.resource ?? 0;
    if (seen.has(resource)) return false;
    seen.add(resource);
    return true;
  });
};

const bombTiles = (bombs: readonly string[]): HTMLElement[] =>
  catapultShots(bombs).map((id) => {
    const element = tile(bombPile(id), bombSize(id), catapultLabel(id), "attack-window__tile--bomb repeat-prompt__bomb");
    element.dataset["bomb"] = id;
    return element;
  });

/** A section as the hand Attack window has them: a painted icon, a word, then the tiles. */
const section = (icon: GameIconName, words: string, tiles: HTMLElement[], className: string, extra?: HTMLElement): HTMLElement => {
  const part = el("section", `repeat-prompt__section ${className}`);
  part.setAttribute("aria-label", words);
  const heading = el("h3", "attack-window__heading repeat-prompt__heading");
  heading.append(gameIcon(icon, { size: 24, decorative: true }), el("span", "repeat-prompt__heading-word", words));
  if (extra) heading.append(extra);
  const list = grid(`repeat-prompt__grid ${className}-grid`);
  list.append(...tiles);
  part.append(heading, list);
  return part;
};

/** The fee, as it is paid and as it is short. */
export interface FeeShown {
  /** The fee in putty. */
  readonly fee: number;
  /** Putty short of the fee and the Catapult's putty shots together; 0 or absent when it can be paid. */
  readonly short?: number;
}

/**
 * astra, round 1: the putty pile and amount keep their normal colour.
 * A separate warning says how much is short, rounded up; the refusal keeps
 * its own list.
 */
export const feeLine = ({ fee, short = 0 }: FeeShown): HTMLElement => {
  const line = el("section", `repeat-prompt__fee${short > 0 ? " repeat-prompt__fee--short" : ""}`);
  const tip = short > 0 ? `${feeLabel(fee)}. Putty: ${fmt(short)} short` : feeLabel(fee);
  line.title = tip;
  line.setAttribute("aria-label", tip);
  const heading = el("span", "repeat-prompt__fee-word", "Repeat fee");
  heading.setAttribute("aria-hidden", "true");
  const amount = el("span", "repeat-prompt__fee-amount");
  amount.setAttribute("aria-hidden", "true");
  amount.append(resourceIcon("r3", { decorative: true, realm: "surface" }), el("span", "repeat-prompt__fee-number", puttyAmount(fee)));
  line.append(heading, amount);
  if (short > 0) {
    const shortage = el("span", "repeat-prompt__fee-short", `${puttyAmount(short, "up")} short`);
    shortage.setAttribute("aria-hidden", "true");
    line.append(shortage);
  }
  return line;
};

/** The champions and the monsters (one tile per kind), then the Catapult's shots, then the fee. */
export const armyParts = (plan: Pick<PlanSummary, "monsters" | "champions" | "bombs">, fee?: FeeShown | null): HTMLElement[] => {
  const monsters = byCount(plan.monsters);
  const total = monsters.reduce((sum, [, count]) => sum + count, 0);
  const totalChip = el("span", "chip attack-window__total repeat-prompt__total", `×${fmt(total)}`);
  totalChip.title = `${fmt(total)} monsters`;
  const parts = [
    section(
      "swords",
      "Monsters",
      [...plan.champions.map(championTile), ...monsters.map(([id, count]) => monsterTile(id, count))],
      "repeat-prompt__monsters",
      totalChip,
    ),
  ];
  if (plan.bombs.length > 0) parts.push(section("resourcebomb", "Catapult", bombTiles(plan.bombs), "repeat-prompt__bombs"));
  if (fee && fee.fee > 0) parts.push(feeLine(fee));
  return parts;
};

/* ── The yards and the moves ────────────────────────────────────────────── */

const yardIcon = (label: YardLabel | undefined): HTMLImageElement =>
  gameIcon(label?.main ? "townhall" : classicLook() ? "outpostclassic" : "outpost", { size: 24, decorative: true });

/** "Main yard" / "Outpost" with its painted icon, and its map spot. */
export const yardChip = (label: YardLabel | undefined, end: "from" | "to" | "room"): HTMLElement => {
  const chip = el("span", `repeat-prompt__yard repeat-prompt__yard--${end}`);
  chip.append(yardIcon(label));
  const words = el("span", "repeat-prompt__yard-words");
  words.append(el("span", "repeat-prompt__yard-name", yardName(label)), el("span", "repeat-prompt__yard-place", yardPlace(label)));
  chip.append(words);
  return chip;
};

const arrow = (): HTMLElement => {
  const node = gameIcon(classicLook() ? "friendnextclassic" : "friendnext", { size: 24, decorative: true });
  node.classList.add("repeat-prompt__arrow");
  return node;
};

const moveLabel = (move: YardMove, yards: Readonly<Record<string, YardLabel>>): string => {
  const from = yards[move.from];
  const to = yards[move.to];
  const what = byCount(move.monsters)
    .map(([id, count]) => `${fmt(count)} ${monsterName(id)}`)
    .join(", ");
  return `${what}: from ${yardName(from)} ${yardPlace(from)} to ${yardName(to)} ${yardPlace(to)}`;
};

/** One card per move: the yard it leaves on top, its monsters, an arrow, the yard in range. */
export const moveCards = (moves: readonly YardMove[], yards: Readonly<Record<string, YardLabel>>): HTMLUListElement => {
  const list = el("ul", "repeat-prompt__moves");
  list.setAttribute("aria-label", "Monsters that move first");
  for (const move of moves) {
    const card = el("li", "repeat-prompt__move");
    card.setAttribute("aria-label", moveLabel(move, yards));
    const cargo = el("span", "repeat-prompt__cargo");
    for (const [id, count] of byCount(move.monsters)) cargo.append(monsterTile(id, count, "repeat-prompt__mini"));
    card.append(yardChip(yards[move.from], "from"), cargo, arrow(), yardChip(yards[move.to], "to"));
    list.append(card);
  }
  return list;
};

/**
 * The cue for rows further down a list (a touch screen draws no scroll bar):
 * a painted arrow and how many, in a strip of its own right under whatever
 * scrolls, so it never covers a row (astra, round 2). {@link watchMoreRows}
 * places it and keeps it up to date.
 */
const moreCue = (): HTMLElement => {
  const more = el("div", "repeat-prompt__more");
  more.setAttribute("aria-hidden", "true");
  const cue = el("button", "repeat-prompt__more-cue");
  cue.type = "button";
  cue.tabIndex = -1;
  const down = gameIcon(classicLook() ? "friendnextclassic" : "friendnext", { size: 24, decorative: true });
  down.classList.add("repeat-prompt__more-arrow");
  cue.append(down, el("span", "repeat-prompt__more-count"));
  more.append(cue);
  more.hidden = true;
  return more;
};

/** "5 moves first" over the cards. */
export const movesPart = (moves: readonly YardMove[], yards: Readonly<Record<string, YardLabel>>): HTMLElement => {
  const part = el("section", "repeat-prompt__section repeat-prompt__moves-part");
  const words = moves.length === 1 ? "1 move first" : `${moves.length} moves first`;
  part.setAttribute("aria-label", words);
  const heading = el("h3", "attack-window__heading repeat-prompt__heading");
  heading.append(gameIcon(classicLook() ? "outpostclassic" : "outpost", { size: 24, decorative: true }), el("span", "repeat-prompt__heading-word", words));
  part.append(heading, moveCards(moves, yards));
  return part;
};

/** The nearest box that scrolls up and down: the list itself, or what holds it. */
const scrollerOf = (element: HTMLElement): HTMLElement | null => {
  for (let at: HTMLElement | null = element; at; at = at.parentElement) {
    const style = getComputedStyle(at);
    if ((style.overflowY === "auto" || style.overflowY === "scroll") && at.scrollHeight > at.clientHeight + 1) return at;
    if (at.classList.contains("panel__body")) break;
  }
  return null;
};

/**
 * Keeps a list's "more below" cue up to date (the moves, what is short, the
 * room in range): it shows how many rows are not wholly in sight below, and
 * a tap brings the next one up. Measures the laid-out page; does nothing
 * where nothing is laid out (tests).
 *
 * @returns Stops watching.
 */
export const watchMoreRows = (list: HTMLElement): (() => void) => {
  const more = moreCue();
  const count = more.querySelector<HTMLElement>(".repeat-prompt__more-count")!;
  const cue = more.querySelector<HTMLButtonElement>(".repeat-prompt__more-cue")!;
  list.after(more);
  let scroller: HTMLElement | null = null;
  // Rows were below at some point in this scroller: the strip stays for good.
  let needed = false;
  const below = (): HTMLElement[] => {
    if (!scroller) return [];
    const bottom = scroller.getBoundingClientRect().bottom;
    return [...list.querySelectorAll<HTMLElement>(":scope > li")].filter((row) => row.getBoundingClientRect().bottom > bottom + 1);
  };
  const update = () => {
    const next = scrollerOf(list);
    if (next !== scroller) {
      scroller?.removeEventListener("scroll", update);
      scroller = next;
      needed = false;
      scroller?.addEventListener("scroll", update, { passive: true });
      // The strip sits right under what scrolls: the list, or the sheet's words.
      if (scroller && more.previousElementSibling !== scroller) scroller.after(more);
    }
    // While the list runs past what shows the strip stays, its cue lit while
    // rows are below and dim at the end, so nothing jumps as it scrolls.
    const hidden = below();
    if (hidden.length > 0) needed = true;
    more.hidden = scroller === null || !needed;
    more.classList.toggle("repeat-prompt__more--done", hidden.length === 0);
    count.textContent = `+${hidden.length}`;
    cue.title = `${hidden.length} more below`;
  };
  cue.addEventListener("click", () => {
    // One screenful on, keeping the row that was cut off in sight.
    if (!scroller) return;
    scroller.scrollBy({ top: Math.max(48, scroller.clientHeight - 64), behavior: "smooth" });
  });
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => update());
  observer?.observe(list);
  const panel = list.closest<HTMLElement>(".panel__body");
  if (panel) observer?.observe(panel);
  window.addEventListener("resize", update);
  requestAnimationFrame(update);
  for (const image of list.closest(".panel")?.querySelectorAll("img") ?? []) image.addEventListener("load", update, { once: true });
  update();
  return () => {
    scroller?.removeEventListener("scroll", update);
    observer?.disconnect();
    window.removeEventListener("resize", update);
    more.remove();
  };
};

/* ── What is short ──────────────────────────────────────────────────────── */

const shortRow = (picture: HTMLElement, words: string, tip: string, kind: string): HTMLLIElement => {
  const row = el("li", `repeat-prompt__short repeat-prompt__short--${kind}`);
  row.title = tip;
  row.setAttribute("aria-label", tip);
  const art = el("span", "repeat-prompt__short-art");
  art.setAttribute("aria-hidden", "true");
  art.append(picture);
  const text = el("span", "repeat-prompt__short-words", words);
  text.setAttribute("aria-hidden", "true");
  row.append(art, text);
  return row;
};

const CHAMPION_SHORT = {
  hurt: "No health left",
  away: "Not ready (frozen or away)",
  none: "No longer yours",
} as const;

const BOMB_SHORT = {
  catapult: "Catapult too low",
  cost: "Not enough resources",
  unknown: "Not available",
} as const;

/**
 * What is missing, one row each with its picture: a monster's portrait and
 * "35 short", a champion's portrait and why, a catapult shot's pile, size and why.
 * Names only in the tooltip and for a screen reader.
 */
export const shortageList = (
  missing: readonly PlanShortfall[],
  champions: PlanSummary["champions"] = [],
): HTMLUListElement => {
  const list = el("ul", "repeat-prompt__shorts");
  list.setAttribute("aria-label", "What is missing");
  for (const item of missing) {
    if (item.kind === "monster") {
      const short = fmt(item.need - item.have);
      const picture = monsterPortrait(item.id, "icon");
      list.append(shortRow(portrait(picture), `${short} short`, `${monsterName(item.id)}: ${short} short`, "monster"));
    } else if (item.kind === "fee") {
      // The owner's words, "Putty: 1.2M short" (20 Nov 2026): the fee and the putty shots together.
      const short = puttyAmount(item.need - item.have, "up");
      const tip = `Putty: ${fmt(item.need - item.have)} short (the fee and the Catapult's putty)`;
      list.append(shortRow(resourceIcon("r3", { decorative: true, realm: "surface" }), `${short} short`, tip, "fee"));
    } else if (item.kind === "champion") {
      const level = champions.find((one) => one.t === item.t)?.l ?? 1;
      const picture = championPortrait(championByType(item.t) ?? `G${item.t}`, level, "icon");
      const why = CHAMPION_SHORT[item.reason];
      list.append(shortRow(portrait(picture), why, `${championName(item.t)}: ${why}`, "champion"));
    } else {
      const why = BOMB_SHORT[item.reason];
      const size = bombSize(item.id);
      list.append(shortRow(bombPile(item.id), size ? `${size}: ${why}` : why, `${catapultLabel(item.id)}: ${why}`, "bomb"));
    }
  }
  return list;
};

/**
 * No room in range: the space the monsters moving in need, and the free
 * space each yard in range has.
 */
export const roomParts = (noRoom: NoRoom, yards: Readonly<Record<string, YardLabel>>): HTMLElement[] => {
  const need = el("p", "repeat-prompt__need");
  need.title = `Incoming monsters need ${fmt(noRoom.need)} housing space`;
  need.append(gameIcon("housing", { size: 24, decorative: true }), el("span", "", `${fmt(noRoom.need)} space needed`));
  if (noRoom.free.length === 0) return [need];
  const list = el("ul", "repeat-prompt__room");
  list.setAttribute("aria-label", "Free housing in range");
  for (const one of noRoom.free) {
    const row = el("li", "repeat-prompt__room-yard");
    const free = el("span", "repeat-prompt__room-free");
    free.append(gameIcon("housing", { size: 16, decorative: true }), el("span", "", `${fmt(one.free)} free`));
    row.append(yardChip(yards[one.baseid], "room"), free);
    list.append(row);
  }
  return [need, list];
};
