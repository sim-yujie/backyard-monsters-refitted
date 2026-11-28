import type { PlanSummary } from "@/api/autoAttack";
import { showPortrait } from "@/game/portraits";
import { formatCompact } from "@/ui/format";
import { gameIcon } from "@/ui/gameIcon";
import { artUrl } from "@/artUrl";
import { byCount, championTile, monsterTile } from "./repeatPrompt";
import type { RepeatLook } from "./repeatLook";
import { marchersOf, tribeGoalPicture, type Marcher } from "./RepeatBar";
import "@/ui/styles/repeat-looks.css";

/**
 * Repeat attack's working window, prototypes for the Review Desk (owner,
 * 28 Nov 2026: "why is there a 'panel' within a panel?"). neon's three
 * directions (round 0), each one frame only:
 *
 * - A, battlefield diorama: the window's own frame holds a frameless sunken
 *   battlefield; the army marches as a tidy two-rank block, no overlaps, to
 *   the camp on the same road, then fights at its gate.
 * - B, versus card: your army as the confirm sheet's tiles, facing the camp's
 *   big portrait across a clash medallion.
 * - C, map raid banner: no window; one thin bar plate at the top of the map,
 *   a vanguard racing along a full-width rail and the whole army fixed below.
 *
 * RepeatBar keeps the timing (start, hold, resume, complete, stop); these
 * only build the parts. `--repeat-progress` and `--march` (0 to 1, the
 * travelling part) and the classes `repeat-bar--fighting`, `--waiting`,
 * `--full` and `--stopped` on the root drive the CSS (repeat-looks.css).
 */

/** The part of the bar that is the march; the rest is the fight at the camp (neon round 0). */
export const FIGHT_AT = 0.68;

type Plan = Pick<PlanSummary, "monsters" | "champions" | "tribe"> & { readonly level?: number };

const QUEUE_ICON_URL = artUrl("/assets/popups/hourglass.png");

const part = (className: string, tag: keyof HTMLElementTagNameMap = "div", text?: string): HTMLElement => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const totalOf = (plan: Plan | null): number =>
  plan ? Object.values(plan.monsters).reduce((sum, count) => sum + (count > 0 ? count : 0), 0) : 0;

/** Leaders first: the champions, then the kinds by size. */
const leadersFirst = (plan: Plan | null): Marcher[] => {
  const all = marchersOf(plan);
  return [...all.filter((one) => one.count === null), ...all.filter((one) => one.count !== null)];
};

/** One marcher: its portrait (a round token for Modern's square paintings) and its count or "Lv". */
const unitOf = (marcher: Marcher, className: string): HTMLElement => {
  const champion = marcher.count === null;
  const unit = part(
    `${className}${champion ? ` ${className}--champion` : ""}${
      !champion && marcher.picture.src.includes("/portraits/") ? ` ${className}--token` : ""
    }`,
  );
  const image = document.createElement("img");
  image.className = `${className}-pic`;
  image.alt = "";
  image.draggable = false;
  showPortrait(image, marcher.picture);
  unit.append(image);
  const chip = part(`${className}-count`, "span", champion ? `Lv ${marcher.level ?? ""}`.trim() : formatCompact(marcher.count ?? 0));
  unit.append(chip);
  unit.title = champion ? marcher.name : `${marcher.name} ×${marcher.count}`;
  return unit;
};

const tribeImage = (plan: Plan | null, className: string): HTMLElement => {
  const goal = part(className);
  const url = plan ? tribeGoalPicture(plan.tribe) : null;
  if (url) {
    const image = document.createElement("img");
    image.className = `${className}-pic`;
    image.alt = "";
    image.draggable = false;
    image.decoding = "async";
    image.src = url;
    goal.append(image);
  }
  if (plan) goal.title = `${plan.tribe} camp`;
  return goal;
};

/** "Dreadnaut camp" and "Lv 36" on one line. */
const campLine = (plan: Plan | null): HTMLElement => {
  const line = part("rl-camp");
  if (!plan) return line;
  const name = part("rl-camp-name", "span", plan.tribe);
  name.append(part("rl-camp-word", "span", " camp"));
  line.append(name);
  if (plan.level !== undefined) line.append(part("rl-level", "span", `Lv ${plan.level}`));
  return line;
};

/** The swords and the army's size. */
const totalChip = (plan: Plan | null): HTMLElement => {
  const chip = part("rl-total", "span");
  const total = totalOf(plan);
  chip.title = `${total.toLocaleString("en-US")} monsters`;
  chip.append(gameIcon("swords", { size: 24, decorative: true }), part("", "span", `×${formatCompact(total)}`));
  return chip;
};

/** The place in the server's battle line: the hourglass and "#3", and that nothing is spent yet. */
const waitBadge = (): HTMLElement => {
  const badge = part("rl-wait");
  const glass = document.createElement("img");
  glass.className = "rl-wait-icon";
  glass.alt = "";
  glass.src = QUEUE_ICON_URL;
  const words = part("rl-wait-words");
  words.append(part("rl-place", "span", "#1"), part("rl-wait-note", "span", "In line · nothing spent yet"));
  badge.append(glass, words);
  return badge;
};

/** The slim progress rail and its cue: swords marching, the clash while fighting. */
const footOf = (): HTMLElement => {
  const foot = part("rl-foot");
  const rail = part("rl-rail");
  rail.append(part("rl-fill"), part("rl-tick"));
  const cue = part("rl-cue");
  const glass = document.createElement("img");
  glass.className = "rl-cue-glass";
  glass.alt = "";
  glass.src = QUEUE_ICON_URL;
  cue.append(gameIcon("swords", { size: 24, decorative: true, className: "rl-cue-swords" }), glass);
  foot.append(rail, cue);
  return foot;
};

/** The clash at the camp's gate while fighting. */
const clashOf = (): HTMLElement => {
  const clash = part("rl-clash");
  clash.append(part("rl-clash-ring"), gameIcon("swords", { size: 32, decorative: true, className: "rl-clash-icon" }));
  return clash;
};

/* ── A: battlefield diorama ─────────────────────────────────────────────── */

const buildA = (root: HTMLElement, plan: Plan | null): void => {
  const head = part("rl-head");
  head.append(campLine(plan), totalChip(plan));
  const stage = part("rl-stage");
  stage.append(part("rl-sky"), part("rl-road"));
  const marchers = leadersFirst(plan);
  const two = marchers.length > 5;
  const columns = two ? Math.ceil(marchers.length / 2) : Math.max(1, marchers.length);
  const block = part(`rl-block${marchers.length === 1 ? " rl-block--solo" : two ? " rl-block--two" : ""}`);
  block.style.setProperty("--cols", String(columns));
  block.style.setProperty("--rows", two ? "2" : "1");
  // The leaders at the front (right), the smallest kinds at the back; two ranks for a big army.
  marchers.forEach((marcher, index) => {
    const unit = unitOf(marcher, "rl-unit");
    const column = two ? columns - Math.floor(index / 2) : columns - index;
    unit.style.gridColumn = String(column);
    unit.style.gridRow = String(two ? (index % 2) + 1 : 1);
    unit.style.setProperty("--marcher", String(index));
    block.append(unit);
  });
  stage.append(block, clashOf(), tribeImage(plan, "rl-goal"), waitBadge());
  root.append(head, stage, footOf());
};

/* ── B: versus card ─────────────────────────────────────────────────────── */

const buildB = (root: HTMLElement, plan: Plan | null): void => {
  const arena = part("rl-arena");
  const army = part("rl-side rl-army");
  const armyHead = part("rl-side-head");
  armyHead.append(totalChip(plan));
  const tiles = part("rl-tiles");
  tiles.setAttribute("role", "list");
  if (plan) {
    const monsters = byCount(plan.monsters).map(([id, count]) => {
      const tile = monsterTile(id, count);
      // A short count on a small tile: "×1.2K".
      const caption = tile.querySelector(".attack-window__caption");
      if (caption) caption.textContent = `×${formatCompact(count)}`;
      return tile;
    });
    const all = [...plan.champions.map(championTile), ...monsters];
    tiles.style.setProperty("--tiles", String(all.length));
    if (all.length === 1) tiles.classList.add("rl-tiles--solo");
    else if (all.length <= 5) tiles.classList.add("rl-tiles--row");
    all.forEach((tile, index) => {
      tile.style.setProperty("--marcher", String(index));
      tiles.append(tile);
    });
  }
  army.append(armyHead, tiles);

  const medal = part("rl-medal");
  const disc = part("rl-disc");
  const glass = document.createElement("img");
  glass.className = "rl-disc-glass";
  glass.alt = "";
  glass.src = QUEUE_ICON_URL;
  disc.append(part("rl-clash-ring"), gameIcon("swords", { size: 32, decorative: true, className: "rl-disc-swords" }), glass);
  const chevrons = part("rl-chevrons");
  for (let i = 0; i < 3; i++) chevrons.append(part("rl-chevron", "span"));
  medal.append(chevrons, disc, part("rl-place rl-place--medal", "span", "#1"));

  const foe = part("rl-side rl-foe");
  foe.append(tribeImage(plan, "rl-foe-portrait"), campLine(plan));
  arena.append(army, medal, foe);
  const note = part("rl-wait-note rl-wait-note--b", "p", "In line · nothing spent yet");
  root.append(arena, footOf(), note);
};

/* ── C: map raid banner ─────────────────────────────────────────────────── */

const buildC = (root: HTMLElement, plan: Plan | null): void => {
  const head = part("rl-head");
  const right = part("rl-head-right");
  const cue = part("rl-cue");
  const glass = document.createElement("img");
  glass.className = "rl-cue-glass";
  glass.alt = "";
  glass.src = QUEUE_ICON_URL;
  cue.append(gameIcon("swords", { size: 24, decorative: true, className: "rl-cue-swords" }), glass, part("rl-place", "span", "#1"));
  right.append(totalChip(plan), cue);
  head.append(campLine(plan), right);

  const marchers = leadersFirst(plan);
  const sprint = part("rl-sprint");
  const track = part("rl-track");
  track.append(part("rl-fill"));
  const lead = marchers[0];
  const vanguard = part("rl-vanguard");
  if (lead) vanguard.append(unitOf(lead, "rl-unit"));
  sprint.append(track, vanguard, clashOf(), tribeImage(plan, "rl-goal"));

  const manifest = part(`rl-manifest${marchers.length <= 1 ? " rl-manifest--none" : ""}`);
  if (marchers.length > 1) {
    marchers.forEach((marcher, index) => {
      const unit = unitOf(marcher, "rl-slot");
      unit.style.setProperty("--marcher", String(index));
      manifest.append(unit);
    });
  }
  manifest.style.setProperty("--slots", String(Math.max(1, marchers.length)));
  const note = part("rl-wait-note rl-wait-note--c", "p", "In line · nothing spent yet");
  root.append(head, sprint, manifest, note);
};

/** Builds look `look`'s parts into the bar's root. */
export const buildRepeatLook = (look: Exclude<RepeatLook, "today">, root: HTMLElement, plan: Plan | null): void => {
  root.classList.add("repeat-look", `repeat-look--${look}`);
  if (look === "a") buildA(root, plan);
  else if (look === "b") buildB(root, plan);
  else buildC(root, plan);
};

/** Shows the place in the battle line on every "#N" of the look. */
export const showLookPlace = (root: HTMLElement, place: number | null): void => {
  for (const node of root.querySelectorAll<HTMLElement>(".rl-place")) node.textContent = place === null ? "" : `#${place}`;
};
