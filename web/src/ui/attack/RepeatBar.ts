import type { PlanSummary } from "@/api/autoAttack";
import { artUrl } from "@/artUrl";
import { classicLook } from "@/game/classicLook";
import { championByType, monsterName } from "@/game/combat/rules";
import { championName } from "@/ui/attack/ArmyPanel";
import { tribePictureUrl } from "@/game/maproom/tribeAvatars";
import { championPortrait, monsterPortrait, showPortrait, type Portrait } from "@/game/portraits";
import { formatCompact } from "@/ui/format";
import { REAL_TIMERS, REPEAT_BAR_FULL_HOLD_MS, REPEAT_BAR_MIN_MS, waitingProgress, type BarTimers } from "./repeatBarTiming";
import "@/ui/styles/repeat-bar.css";

/**
 * Repeat attack's working bar (owner, 15 Nov 2026), on the sheet while the
 * server fights the battle: the marching army (look A, chosen 15 Nov). The
 * monsters the attack sends (its plan, as the confirm sheet showed it) march
 * along the bar to the camp's tribe at the end, from art the game already has.
 *
 * The frame is the window style's own bar plate (skin.css `--skin-bar`):
 * steel in Modern, Flash brown in Classic. `--repeat-progress` (0 to 1) on
 * the element drives it; the CSS does the rest.
 */

/** From this many marchers, two staggered ranks. */
export const RANKS_FROM = 7;

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
    return { picture: championPortrait(id, champion.l, "icon"), count: null, name: championName(champion.t) };
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

export interface RepeatBarOptions {
  /** The attack being repeated: who marches, and to which tribe. */
  readonly plan: Pick<PlanSummary, "monsters" | "champions" | "tribe"> | null;
  readonly timers?: BarTimers;
  readonly reducedMotion?: boolean;
  readonly minMs?: number;
}

export class RepeatBar {
  readonly element: HTMLElement;
  /** How long the full bar stays up before the result. */
  readonly holdMs = REPEAT_BAR_FULL_HOLD_MS;
  private readonly timers: BarTimers;
  private readonly minMs: number;
  private startedAt = 0;
  private progress = 0;
  private frame: number | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private state: "idle" | "running" | "full" | "stopped" = "idle";

  constructor(options: RepeatBarOptions) {
    this.timers = options.timers ?? REAL_TIMERS;
    this.minMs = options.minMs ?? REPEAT_BAR_MIN_MS;
    const reduced = options.reducedMotion ?? prefersReducedMotion();

    const root = part(`repeat-bar${reduced ? " repeat-bar--still" : ""}`);
    root.setAttribute("role", "progressbar");
    root.setAttribute("aria-label", "Attacking");
    root.setAttribute("aria-valuemin", "0");
    root.setAttribute("aria-valuemax", "100");
    const track = part("repeat-bar__track");
    root.append(track);
    this.buildArmy(root, track, options.plan);
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

  /** The answer is in and the minimum time passed: jump to full. */
  complete(): void {
    if (this.state === "full") return;
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
    if (this.state !== "running") return;
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
  }

  /* ── The army ──────────────────────────────────────────────────────────── */

  private buildArmy(root: HTMLElement, track: HTMLElement, plan: RepeatBarOptions["plan"]): void {
    track.append(part("repeat-bar__road"));
    const troop = part("repeat-bar__troop");
    const all = marchersOf(plan);
    // Left to right: the smallest kind at the back, the biggest behind the champions, who lead.
    const marchers = [...all.filter((one) => one.count !== null).reverse(), ...all.filter((one) => one.count === null)];
    marchers.forEach((marcher, index) => {
      const unit = part(
        `repeat-bar__marcher${marcher.count === null ? " repeat-bar__marcher--champion" : ""}${
          marcher.count !== null && marcher.picture.src.includes("/portraits/") ? " repeat-bar__marcher--token" : ""
        }`,
      );
      unit.style.setProperty("--marcher", String(index));
      if (index % 2 === 1) unit.classList.add("repeat-bar__marcher--up");
      const image = document.createElement("img");
      image.className = "repeat-bar__marcher-pic";
      image.alt = "";
      image.draggable = false;
      showPortrait(image, marcher.picture);
      unit.append(image);
      if (marcher.count !== null) {
        // Next to each other the counts take turns above and below the
        // portraits, so two never overlap (owner, 20 Nov 2026).
        const count = part(`repeat-bar__count${index % 2 === 1 ? " repeat-bar__count--high" : ""}`, "span");
        count.textContent = formatCompact(marcher.count);
        unit.append(count);
      }
      unit.title = marcher.count === null ? marcher.name : `${marcher.name} ×${marcher.count}`;
      troop.append(unit);
    });
    troop.style.setProperty("--marchers", String(Math.max(1, marchers.length)));
    // A big army marches in two staggered ranks (astra, 20 Nov 2026: ten in
    // one line hid each other): every other marcher a rank up, its count above.
    if (marchers.length >= RANKS_FROM) root.classList.add("repeat-bar--ranks");
    track.append(troop);

    const goal = part("repeat-bar__goal repeat-bar__goal--tribe");
    const tribe = plan ? tribeGoalPicture(plan.tribe) : null;
    if (tribe) goal.append(picture("repeat-bar__goal-pic", tribe));
    else goal.classList.add("repeat-bar__goal--none");
    if (plan) goal.title = plan.tribe;
    root.append(goal);
  }
}
