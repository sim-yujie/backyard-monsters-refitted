import type { PlanSummary } from "@/api/autoAttack";
import { artUrl } from "@/artUrl";
import { classicLook } from "@/game/classicLook";
import { championByType, monsterName } from "@/game/combat/rules";
import { championName } from "@/ui/attack/ArmyPanel";
import { tribePictureUrl } from "@/game/maproom/tribeAvatars";
import { championPortrait, monsterPortrait, showPortrait, type Portrait } from "@/game/portraits";
import { formatCompact } from "@/ui/format";
import { gameIcon } from "@/ui/gameIcon";
import {
  REAL_TIMERS,
  REPEAT_BAR_AFTER_LINE_MS,
  REPEAT_BAR_FULL_HOLD_MS,
  REPEAT_BAR_MIN_MS,
  waitingProgress,
  type BarTimers,
} from "./repeatBarTiming";
import { QUEUE_ICON, QUEUE_NOTE, queueWords } from "./repeatQueue";
import "@/ui/styles/repeat-bar.css";

/**
 * Repeat attack's working window while the server fights the battle: the
 * battlefield scene (owner, 28 Nov 2026, look A, after "why is there a
 * 'panel' within a panel?"). The window's own frame holds one frameless
 * battlefield: the army the attack sends (its plan, as the confirm sheet
 * showed it) marches as a tidy block along the road to the camp's tribe,
 * then fights at its gate. Over it, the army's size on the left and the
 * camp on the right; under it, a slim rail with the cue (chevrons on the
 * march, swords in the fight, the hourglass in line).
 *
 * `--repeat-progress` (0 to 1), `--march` (0 to 1, the travelling part, up
 * to {@link FIGHT_AT}) and the classes `repeat-bar--fighting`, `--waiting`,
 * `--full`, `--stopped` and `--still` on the element drive the CSS
 * (repeat-bar.css).
 *
 * In the server's battle line (patch 9.1) the army halts where it is
 * ({@link RepeatBar.hold}) and marches on when the turn comes
 * ({@link RepeatBar.resume}); a badge over the scene shows the place. Time
 * in line does not count towards the bar's minimum, and after a wait of
 * {@link REPEAT_BAR_AFTER_LINE_MS} or more the march from there is at most
 * that long (neon, 26 Nov 2026).
 */

/** The part of the bar that is the march; the rest is the fight at the camp's gate. */
export const FIGHT_AT = 0.68;

/**
 * At most this many marchers in the block (five columns of two ranks):
 * more would leave the army no road to march on a phone. A bigger army
 * shows its first {@link MAX_MARCHERS} - 1 and a "+N" for the rest.
 */
export const MAX_MARCHERS = 10;

/** The tribe's portrait at the end of the army's road: Modern's painting, Classic's Flash splash. */
export const tribeGoalPicture = (tribe: string, classic: boolean = classicLook()): string | null => {
  const file = tribe.toLowerCase();
  if (!["legionnaire", "kozu", "abunakki", "dreadnaut"].includes(file)) return null;
  return classic ? artUrl(`/assets/popups/tribe_${file}.v2.png`) : tribePictureUrl(tribe);
};

/** One marcher: a monster kind (with how many) or a champion. */
export interface Marcher {
  readonly picture: Portrait;
  /** How many of the kind; null for a champion. */
  readonly count: number | null;
  readonly name: string;
  /** A champion's level. */
  readonly level?: number;
}

/**
 * Who marches: every monster kind of the plan, the most numerous first, then
 * its champions, which lead. Every kind marches with its count (owner, 20 Nov
 * 2026: a five-kind army showed four counts).
 */
export const marchersOf = (plan: Pick<PlanSummary, "monsters" | "champions"> | null): Marcher[] => {
  if (!plan) return [];
  const kinds = Object.entries(plan.monsters)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id, count]): Marcher => ({ picture: monsterPortrait(id, "icon"), count, name: monsterName(id) }));
  const champions = plan.champions.map((champion): Marcher => {
    const id = championByType(champion.t) ?? `G${champion.t}`;
    return { picture: championPortrait(id, champion.l, "icon"), count: null, name: championName(champion.t), level: champion.l };
  });
  return [...kinds, ...champions];
};

const prefersReducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const part = (className: string, tag = "div"): HTMLElement => {
  const node = document.createElement(tag);
  node.className = className;
  return node;
};

const picture = (className: string, src: string): HTMLImageElement => {
  const image = document.createElement("img");
  image.className = className;
  image.alt = "";
  image.draggable = false;
  image.decoding = "async";
  image.src = src;
  return image;
};

type ScenePlan = (Pick<PlanSummary, "monsters" | "champions" | "tribe"> & { readonly level?: number }) | null;

/**
 * A dev build's frozen point for the pictures' scripts (`globalThis.__repeatFreeze`,
 * 0 to 0.97), else null. Never in a release build.
 */
const devFreeze = (): number | null => {
  if (!import.meta.env.DEV) return null;
  const asked = (globalThis as Record<string, unknown>)["__repeatFreeze"];
  return typeof asked === "number" && Number.isFinite(asked) ? Math.min(0.97, Math.max(0, asked)) : null;
};

/** One marcher: its portrait (a round token for Modern's square paintings) and its count or "Lv" on a chip. */
const unitOf = (marcher: Marcher, index: number): HTMLElement => {
  const champion = marcher.count === null;
  const unit = part(
    `repeat-bar__unit${champion ? " repeat-bar__unit--champion" : ""}${
      !champion && marcher.picture.src.includes("/portraits/") ? " repeat-bar__unit--token" : ""
    }`,
  );
  unit.style.setProperty("--marcher", String(index));
  const image = document.createElement("img");
  image.className = "repeat-bar__unit-pic";
  image.alt = "";
  image.draggable = false;
  showPortrait(image, marcher.picture);
  unit.append(image);
  const chip = part("repeat-bar__count", "span");
  chip.textContent = champion ? `Lv ${marcher.level ?? ""}`.trim() : formatCompact(marcher.count ?? 0);
  unit.append(chip);
  unit.title = champion ? marcher.name : `${marcher.name} ×${marcher.count}`;
  return unit;
};

/** The kinds that do not fit the block, as one "+N" token. */
const moreOf = (rest: readonly Marcher[], index: number): HTMLElement => {
  const unit = part("repeat-bar__unit repeat-bar__unit--more");
  unit.style.setProperty("--marcher", String(index));
  unit.append(part("repeat-bar__more", "span"));
  unit.firstElementChild!.textContent = `+${rest.length}`;
  unit.title = rest.map((one) => (one.count === null ? one.name : `${one.name} ×${one.count}`)).join(", ");
  return unit;
};

/**
 * The army as a tidy block, the leaders at the front (right): champions,
 * then the kinds by size; one rank up to five, two ranks above.
 */
const blockOf = (plan: ScenePlan): HTMLElement => {
  const all = marchersOf(plan);
  const leaders = [...all.filter((one) => one.count === null), ...all.filter((one) => one.count !== null)];
  const shown = leaders.length > MAX_MARCHERS ? leaders.slice(0, MAX_MARCHERS - 1) : leaders;
  const units = shown.map(unitOf);
  if (shown.length < leaders.length) units.push(moreOf(leaders.slice(shown.length), shown.length));
  const two = units.length > 5;
  const columns = two ? Math.ceil(units.length / 2) : Math.max(1, units.length);
  const block = part(`repeat-bar__block${units.length === 1 ? " repeat-bar__block--solo" : two ? " repeat-bar__block--two" : ""}`);
  block.style.setProperty("--cols", String(columns));
  block.style.setProperty("--rows", two ? "2" : "1");
  units.forEach((unit, index) => {
    unit.style.gridColumn = String(two ? columns - Math.floor(index / 2) : columns - index);
    unit.style.gridRow = String(two ? (index % 2) + 1 : 1);
    block.append(unit);
  });
  return block;
};

/** The army's size: the army icon and "×132" (never the swords: those mean the fight, neon). */
const totalOf = (plan: ScenePlan): HTMLElement => {
  const total = plan ? Object.values(plan.monsters).reduce((sum, count) => sum + (count > 0 ? count : 0), 0) : 0;
  const chip = part("repeat-bar__total", "span");
  chip.title = `${total.toLocaleString("en-US")} monsters`;
  const words = part("", "span");
  words.textContent = `×${formatCompact(total)}`;
  chip.append(gameIcon("lastarmy", { size: 24, decorative: true }), words);
  return chip;
};

/** "Dreadnaut camp" and "Lv 36", over the camp's side of the scene. */
const campOf = (plan: ScenePlan): HTMLElement => {
  const line = part("repeat-bar__camp");
  if (!plan) return line;
  const name = part("repeat-bar__camp-name", "span");
  name.textContent = `${plan.tribe} camp`;
  line.append(name);
  if (plan.level !== undefined) {
    const level = part("repeat-bar__level", "span");
    level.textContent = `Lv ${plan.level}`;
    line.append(level);
  }
  return line;
};

/** The place in the battle line over the scene: the hourglass, "Waiting in line · #3" and that nothing is spent. */
const waitOf = (): HTMLElement => {
  const badge = part("repeat-bar__wait");
  // The working sheet's own line tells a screen reader.
  badge.setAttribute("aria-hidden", "true");
  const words = part("repeat-bar__wait-words");
  const note = part("repeat-bar__wait-note", "span");
  note.textContent = QUEUE_NOTE;
  words.append(part("repeat-bar__wait-place", "span"), note);
  badge.append(picture("repeat-bar__wait-icon", QUEUE_ICON), words);
  return badge;
};

/** The cue at the rail's end: chevrons on the march, swords in the fight, the hourglass in line. */
const cueOf = (): HTMLElement => {
  const cue = part("repeat-bar__cue");
  const chevrons = part("repeat-bar__chevrons");
  for (let i = 0; i < 3; i++) chevrons.append(part("repeat-bar__chevron", "span"));
  cue.append(chevrons, gameIcon("swords", { size: 24, decorative: true, className: "repeat-bar__cue-swords" }), picture("repeat-bar__cue-glass", QUEUE_ICON));
  return cue;
};

/** The clash in the gap between the army's front and the camp, while fighting. */
const clashOf = (): HTMLElement => {
  const clash = part("repeat-bar__clash");
  clash.append(part("repeat-bar__clash-ring"), gameIcon("swords", { size: 32, decorative: true, className: "repeat-bar__clash-icon" }));
  return clash;
};

/** The camp's tribe at the road's end. */
const goalOf = (plan: ScenePlan): HTMLElement => {
  const goal = part("repeat-bar__goal");
  const url = plan ? tribeGoalPicture(plan.tribe) : null;
  if (url) goal.append(picture("repeat-bar__goal-pic", url));
  else goal.classList.add("repeat-bar__goal--none");
  if (plan) goal.title = `${plan.tribe} camp`;
  return goal;
};

/** The whole scene: the head, the battlefield and the rail. */
const buildScene = (root: HTMLElement, plan: ScenePlan): void => {
  const head = part("repeat-bar__head");
  head.append(totalOf(plan), campOf(plan));
  const stage = part("repeat-bar__stage");
  stage.append(part("repeat-bar__sky"), part("repeat-bar__road"), blockOf(plan), clashOf(), goalOf(plan), waitOf());
  const foot = part("repeat-bar__foot");
  const rail = part("repeat-bar__rail");
  rail.append(part("repeat-bar__fill"));
  foot.append(rail, cueOf());
  root.append(head, stage, foot);
};

export interface RepeatBarOptions {
  /** The attack being repeated: who marches, and to which tribe. */
  readonly plan: ScenePlan;
  readonly timers?: BarTimers;
  readonly reducedMotion?: boolean;
  readonly minMs?: number;
  /** Holds the march at this point (tests; pictures in a dev build use `__repeatFreeze`). */
  readonly freeze?: number | null;
}

export class RepeatBar {
  readonly element: HTMLElement;
  /** How long the full bar stays up before the result. */
  readonly holdMs = REPEAT_BAR_FULL_HOLD_MS;
  private readonly timers: BarTimers;
  private minMs: number;
  private startedAt = 0;
  private progress = 0;
  private frame: number | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private state: "idle" | "running" | "full" | "stopped" = "idle";
  /** When the army halted in the line, or null while it marches. */
  private heldAt: number | null = null;
  /** Time spent in the line so far. */
  private heldMs = 0;
  private readonly freeze: number | null;

  constructor(options: RepeatBarOptions) {
    this.timers = options.timers ?? REAL_TIMERS;
    this.freeze = options.freeze ?? null;
    this.minMs = options.minMs ?? REPEAT_BAR_MIN_MS;
    const reduced = options.reducedMotion ?? prefersReducedMotion();

    const root = part(`repeat-bar${reduced ? " repeat-bar--still" : ""}`);
    root.setAttribute("role", "progressbar");
    root.setAttribute("aria-label", "Attacking");
    root.setAttribute("aria-valuemin", "0");
    root.setAttribute("aria-valuemax", "100");
    buildScene(root, options.plan);
    this.element = root;
    this.paint(0);
  }

  /** The fill shown now, 0 to 1. */
  get value(): number {
    return this.progress;
  }

  /** Full, and the bar has landed. */
  get full(): boolean {
    return this.state === "full";
  }

  /** Starts the bar at empty. */
  start(): void {
    if (this.state !== "idle") return;
    this.state = "running";
    this.startedAt = this.timers.now();
    this.loop();
  }

  /** When the bar started, on its timers' clock. */
  get started(): number {
    return this.startedAt;
  }

  /** In the battle line: the army halts where it is. */
  hold(): void {
    if (this.state !== "running" || this.heldAt !== null) return;
    this.heldAt = this.timers.now();
    this.halt();
    this.element.classList.add("repeat-bar--waiting");
  }

  /** The turn came: the army marches on from where it halted. */
  resume(): void {
    if (this.heldAt === null) return;
    const now = this.timers.now();
    const held = now - this.heldAt;
    this.heldAt = null;
    this.heldMs += held;
    this.element.classList.remove("repeat-bar--waiting");
    // The clock skips the time in line, so the army does not jump ahead.
    this.startedAt += held;
    if (this.heldMs >= REPEAT_BAR_AFTER_LINE_MS) {
      // After a real wait the march is short; the bar never goes backwards.
      const marched = now - this.startedAt;
      this.minMs = Math.min(this.minMs, marched + REPEAT_BAR_AFTER_LINE_MS);
    }
    if (this.state === "running") this.loop();
  }

  /** Halted in the line. */
  get waiting(): boolean {
    return this.heldAt !== null;
  }

  /** How long the bar must still run before it may jump to full (0: may now). */
  remainingMs(): number {
    if (this.heldAt !== null) return this.minMs;
    return Math.max(0, this.minMs - (this.timers.now() - this.startedAt));
  }

  /** The answer is in and the minimum time passed: jump to full. */
  complete(): void {
    if (this.state === "full") return;
    this.heldAt = null;
    this.element.classList.remove("repeat-bar--waiting");
    this.halt();
    this.state = "full";
    this.paint(1);
    this.element.classList.add("repeat-bar--full");
  }

  /** An error: stop where it is. */
  stop(): void {
    if (this.state === "full") return;
    this.halt();
    this.state = "stopped";
    this.element.classList.add("repeat-bar--stopped");
  }

  /** Stops the animation for good (the sheet went). */
  destroy(): void {
    this.halt();
    if (this.state === "running") this.state = "stopped";
  }

  /** Moves the bar to where it should be now. Called each frame; the tests call it by hand. */
  update(): void {
    if (this.state !== "running" || this.heldAt !== null) return;
    const frozen = this.freeze ?? devFreeze();
    if (frozen !== null) {
      this.paint(frozen);
      return;
    }
    this.paint(waitingProgress(this.timers.now() - this.startedAt, this.minMs));
  }

  private loop(): void {
    if (typeof requestAnimationFrame === "function") {
      const step = (): void => {
        this.frame = null;
        if (this.state !== "running") return;
        this.update();
        this.frame = requestAnimationFrame(step);
      };
      this.frame = requestAnimationFrame(step);
    } else {
      this.tick = setInterval(() => this.update(), 50);
    }
  }

  private halt(): void {
    if (this.frame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.frame);
    this.frame = null;
    if (this.tick !== null) clearInterval(this.tick);
    this.tick = null;
  }

  private paint(value: number): void {
    // Never backwards: a late frame cannot undo the jump to full.
    this.progress = Math.max(this.progress, Math.min(1, value));
    this.element.style.setProperty("--repeat-progress", this.progress.toFixed(4));
    this.element.setAttribute("aria-valuenow", String(Math.round(this.progress * 100)));
    // The march, then the fight at the camp's gate.
    this.element.style.setProperty("--march", Math.min(1, this.progress / FIGHT_AT).toFixed(4));
    this.element.classList.toggle("repeat-bar--fighting", this.progress >= FIGHT_AT);
  }

  /** The place in the server's battle line on the scene's badge (null: not in line). */
  showPlace(place: number | null): void {
    const words = this.element.querySelector(".repeat-bar__wait-place");
    if (words) words.textContent = place === null ? "" : queueWords(place);
  }
}
