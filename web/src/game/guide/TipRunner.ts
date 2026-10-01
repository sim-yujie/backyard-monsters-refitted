import type { Onboarding } from "@/api/types";
import { HelpButton } from "@/ui/guide/HelpButton";
import type { GuideStep } from "@/ui/guide/GuideOverlay";
import { guideBus as appBus, GuideScreen, type GuideBus, type GuideEvents } from "./guideBus";
import { findTarget, registerCanvasTarget, type TargetRect } from "./targets";
import { GUIDED_SCREENS, targetsOf, tipsFor, tipWording, type Tip, type TipTarget } from "./tipsCatalogue";

/**
 * Bob's screen tips, run (issue #227, `docs/design/tutorial.md` §7.1).
 *
 * One runner for the whole app. It listens to the guide bus's `screen`
 * events, which every screen sends as it opens, so it reaches the map rooms
 * and the attack too, long after the yard (whose plugin feeds it the account's
 * `onboarding`) has closed. It never edits a screen: it points at the screen's
 * tagged controls, and at a few untagged ones by a selector inside the
 * screen's own element.
 *
 * ## When a screen's tips show by themselves
 *
 * Once the account's `onboarding` is known, the guided start is not pending
 * or running (tips never talk over it, so the practice attack never gets
 * them), and the screen has not been seen. The screens the guided start
 * teaches (yard, Build menu, building panel) show only to a player who
 * skipped it or never had it (Q14); a legacy account counts as one who never
 * had it. Before the yard has said what `onboarding` is, nothing shows.
 *
 * ## Seen
 *
 * Written to the server (`tips/seen`) when the player presses Got it on the
 * last tip, presses Skip tips, or moves on while a tip is up: closes the
 * screen or leaves for another scene. A reload is none of these, so the tips
 * come back. The runner also remembers what it marked itself, so a slow or
 * failed request never shows a screen twice in one sitting.
 *
 * ## More than one screen
 *
 * A panel opening over a screen whose tips are up pauses them; they resume
 * when the panel's tips are done, if their screen is still open. Screens that
 * open together (a damaged building's panel is also its repair screen) take
 * turns. A new scene drops everything (the overlay is cleared under it). The
 * tips hide while something blocks them (the Yard Planner) and come back
 * after.
 *
 * ## "?"
 *
 * Every screen with tips gets a "?" in its title row (or, with none, a round
 * one floating under the HUD) that replays its tips at any time and never
 * marks anything seen. A replay shows every tip, the ones whose control is
 * not on screen without the hand. A panel inside another panel (the Baiter, the
 * Champion Cage) shares the outer panel's "?", which replays both.
 */

/** What draws a tip: the guide kit's `GuideOverlay`, or a stand-in under test. */
export interface TipView {
  show(step: GuideStep): void;
  hide(): void;
  destroy(): void;
  /** False once the overlay was cleared under it (a new scene). */
  readonly attached: boolean;
}

export interface TipTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface TipRunnerOptions {
  /** Posts `tips/seen`. Its failure is ignored: the runner remembers anyway. */
  send(screen: GuideScreen): Promise<unknown>;
  /** Makes the view on the overlay's guide layer; null when there is none. */
  createView(): TipView | null;
  /** True on a touch screen: the tips say "tap" instead of "click". */
  touch(): boolean;
  bus?: GuideBus;
  tips?: (screen: GuideScreen) => readonly Tip[];
  timers?: TipTimers;
  /** How long after a screen opens its tips start, so it can lay out first. */
  startDelayMs?: number;
  /** How often the runner checks that the screen is still open. */
  watchMs?: number;
}

/** A screen's element, as a `screen` event handed it. */
interface ScreenRef {
  readonly screen: GuideScreen;
  readonly root: HTMLElement;
}

interface Pending extends ScreenRef {
  /** From a "?": shows whatever the state, and marks nothing seen. */
  readonly replay: boolean;
  /** Screens announced in the same moment share a batch, and take turns. */
  readonly batch: number;
}

interface Sequence extends ScreenRef {
  readonly tips: readonly Tip[];
  readonly replay: boolean;
  index: number;
  /** A tip of it has been on screen. */
  displayed: boolean;
}

interface HelpHost {
  readonly button: HelpButton;
  entries: ScreenRef[];
}

/**
 * The scenes' own screens: one of them arriving means a new scene, so a "?"
 * forgets what it replayed before. The outposts screen adds to the yard's (an
 * outpost is both).
 */
const SCENE_SCREENS: ReadonlySet<GuideScreen> = new Set<GuideScreen>([
  GuideScreen.YARD,
  GuideScreen.MR1,
  GuideScreen.MR2,
  GuideScreen.ATTACK,
]);

/** The screens that start a "?"'s list again: the scenes', and the building panel's own. */
const RESET_SCREENS: ReadonlySet<GuideScreen> = new Set<GuideScreen>([...SCENE_SCREENS, GuideScreen.BUILDING]);

/** Screens that replace each other in one place: the Monsters screen's tabs. */
const groupOf = (screen: GuideScreen): string => (screen.startsWith("monsters-") ? "monsters" : screen);

/** The canvas-target prefix the runner answers for its selector targets. */
const SELECTOR_TARGET = "tip:";

const START_DELAY_MS = 400;
const WATCH_MS = 250;
/** How many recent screens are remembered, to start their tips when the guided start ends. */
const RECENT = 8;

const browserTimers: TipTimers = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (handle) => window.clearTimeout(handle as number),
};

/** Whether an element is on screen: attached, not hidden, with a size (as `targets.ts`). */
export const shown = (element: Element): boolean => {
  if (!element.isConnected || element.closest("[hidden]")) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

const rectOf = (element: Element): TargetRect => {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
};

/** The first element matching `selector` inside `root` that is on screen. */
const findIn = (root: HTMLElement, selector: string): HTMLElement | null => {
  for (const element of root.querySelectorAll<HTMLElement>(selector)) {
    if (shown(element)) return element;
  }
  return null;
};

/** Whether a rectangle is not wholly inside the window. */
const offScreen = (rect: TargetRect): boolean =>
  rect.top < 0 || rect.left < 0 || rect.top + rect.height > window.innerHeight || rect.left + rect.width > window.innerWidth;

/** Whether the guided start is still to run or running: no tips then. */
const guideOpen = (onboarding: Onboarding | null): boolean =>
  onboarding?.guide.state === "pending" || onboarding?.guide.state === "active";

export class TipRunner {
  private readonly options: TipRunnerOptions;
  private readonly timers: TipTimers;
  private readonly tips: (screen: GuideScreen) => readonly Tip[];
  private readonly unsubscribe: () => void;
  private readonly unregisterTarget: () => void;

  private onboarding: Onboarding | null = null;
  private blocked: (() => boolean) | null = null;
  /** Screens this runner marked seen, whatever the server has said since. */
  private readonly seenHere = new Set<string>();

  private view: TipView | null = null;
  private current: Sequence | null = null;
  private paused: Sequence[] = [];
  private pending: Pending[] = [];
  private startTimer: unknown = null;
  private watchTimer: unknown = null;
  private hiddenByBlock = false;
  private batch = 0;
  private batchOpen = false;
  /** Where the current tip's selector target is looked up. */
  private selectorTarget: { root: HTMLElement; selector: string } | null = null;

  private readonly helpHosts = new Map<HTMLElement, HelpHost>();
  private recent: ScreenRef[] = [];

  constructor(options: TipRunnerOptions) {
    this.options = options;
    this.timers = options.timers ?? browserTimers;
    this.tips = options.tips ?? tipsFor;
    const bus = options.bus ?? appBus;
    this.unsubscribe = bus.on("screen", (event) => this.onScreen(event));
    this.unregisterTarget = registerCanvasTarget(SELECTOR_TARGET, () => {
      const target = this.selectorTarget;
      const element = target ? findIn(target.root, target.selector) : null;
      return element ? rectOf(element) : null;
    });
  }

  /* ── What the yard tells it ─────────────────────────────────────────── */

  /** The account's latest `onboarding`, from the own yard's store; null for unknown. */
  setOnboarding(onboarding: Onboarding | null): void {
    const wasOpen = guideOpen(this.onboarding);
    const known = this.onboarding !== null;
    this.onboarding = onboarding;
    const open = guideOpen(onboarding);
    for (const host of this.helpHosts.values()) host.button.setHidden(open);
    if (open) {
      this.dropAutomatic();
    } else if (onboarding && (wasOpen || !known)) {
      // The guided start just ended (or the record arrived late): the screens
      // already open get their tips now.
      for (const ref of this.recent) {
        if (shown(ref.root)) this.offer(ref);
      }
    }
  }

  /** What hides the tips while it says so (the Yard Planner); null for nothing. */
  setBlocked(blocked: (() => boolean) | null): void {
    this.blocked = blocked;
  }

  /** Whether a screen's tips were seen: on the server, or marked here. */
  isSeen(screen: string): boolean {
    return this.seenHere.has(screen) || this.onboarding?.tips[screen] !== undefined;
  }

  /** Marks a screen seen, here and on the server. Once per screen and sitting. */
  markSeen(screen: GuideScreen): void {
    if (this.seenHere.has(screen)) return;
    this.seenHere.add(screen);
    if (this.onboarding?.tips[screen] !== undefined) return;
    this.options.send(screen).catch(() => {
      // Nothing to do: it is remembered here, and the next sitting asks again.
    });
  }

  /** Stops listening and takes everything down. */
  destroy(): void {
    this.unsubscribe();
    this.unregisterTarget();
    this.stopAll(false);
    for (const host of this.helpHosts.values()) host.button.remove();
    this.helpHosts.clear();
  }

  /* ── Screens ────────────────────────────────────────────────────────── */

  private onScreen({ id, root, header }: GuideEvents["screen"]): void {
    this.prune();
    const ref: ScreenRef = { screen: id, root };
    this.recent = [ref, ...this.recent.filter((one) => one.screen !== id)].slice(0, RECENT);
    this.attachHelp(ref, header);
    this.offer(ref);
  }

  /** Whether a screen's tips show by themselves now. */
  autoShows(screen: GuideScreen): boolean {
    const onboarding = this.onboarding;
    if (!onboarding || guideOpen(onboarding)) return false;
    if (this.tips(screen).length === 0) return false;
    if (GUIDED_SCREENS.has(screen) && onboarding.guide.state === "done") return false;
    return !this.isSeen(screen);
  }

  /** Queues a screen's tips if they should show and are not already on their way. */
  private offer(ref: ScreenRef): void {
    if (!this.autoShows(ref.screen)) return;
    const busy =
      this.current?.screen === ref.screen ||
      this.pending.some((one) => one.screen === ref.screen) ||
      this.paused.some((one) => one.screen === ref.screen);
    if (busy) return;
    this.enqueue(ref, false, this.options.startDelayMs ?? START_DELAY_MS);
  }

  /** Replays screens' tips (a "?"), first one first, now. */
  replay(refs: readonly ScreenRef[]): void {
    this.prune();
    for (const ref of refs) {
      if (this.tips(ref.screen).length === 0) continue;
      if (this.current?.screen === ref.screen) {
        // Already up: back to its first tip.
        this.current.index = 0;
        this.display();
        continue;
      }
      this.pending = this.pending.filter((one) => one.screen !== ref.screen);
      this.enqueue(ref, true, 0);
    }
  }

  private enqueue(ref: ScreenRef, replay: boolean, delay: number): void {
    if (!this.batchOpen) {
      this.batch += 1;
      this.batchOpen = true;
      queueMicrotask(() => {
        this.batchOpen = false;
      });
    }
    this.pending.push({ ...ref, replay, batch: this.batch });
    if (this.startTimer !== null) this.timers.clear(this.startTimer);
    this.startTimer = this.timers.set(() => {
      this.startTimer = null;
      this.startNewest();
    }, delay);
  }

  /** Starts the first screen of the newest batch; the rest wait their turn. */
  private startNewest(): void {
    this.prune();
    const newest = Math.max(...this.pending.map((one) => one.batch));
    const index = this.pending.findIndex((one) => one.batch === newest);
    if (index < 0) return;
    const [entry] = this.pending.splice(index, 1);
    if (entry) this.begin(entry);
  }

  /** Starts a screen's tips, pausing whatever was up. */
  private begin(entry: Pending): void {
    if (!shown(entry.root) || (!entry.replay && !this.autoShows(entry.screen))) {
      this.next();
      return;
    }
    // A tip whose target is not on screen as the tips start is left out; a
    // replay asked for them all, so it shows them, without the hand.
    const all = this.tips(entry.screen);
    const tips = entry.replay
      ? all
      : all.filter((tip) => targetsOf(tip).length === 0 || this.resolve(tip, entry.root) !== null);
    if (tips.length === 0) {
      this.next();
      return;
    }
    if (!this.view) this.view = this.options.createView();
    if (!this.view) {
      this.stopAll(false);
      return;
    }
    if (this.current) this.paused.push(this.current);
    this.current = { screen: entry.screen, root: entry.root, tips, replay: entry.replay, index: 0, displayed: false };
    this.display();
    this.watch();
  }

  /** The first of a tip's targets on screen now, as a target name; null for none. */
  private resolve(tip: Tip, root: HTMLElement): { name: string; selector?: string } | null {
    for (const target of targetsOf(tip)) {
      const found = this.find(target, root);
      if (found) return found;
    }
    return null;
  }

  private find(target: TipTarget, root: HTMLElement): { name: string; selector?: string } | null {
    if (typeof target === "string") return findTarget(target) ? { name: target } : null;
    return findIn(root, target.selector) ? { name: SELECTOR_TARGET, selector: target.selector } : null;
  }

  /** Puts the current tip on screen (or keeps it off while blocked). */
  private display(): void {
    const sequence = this.current;
    const view = this.view;
    if (!sequence || !view) return;
    if (this.blocked?.()) {
      view.hide();
      this.hiddenByBlock = true;
      return;
    }
    this.hiddenByBlock = false;
    const tip = sequence.tips[sequence.index];
    if (!tip) return;

    // Point at whichever target is there now; with none, at the first, so the
    // hand appears if it comes back.
    const first = targetsOf(tip)[0];
    const found =
      this.resolve(tip, sequence.root) ??
      (first === undefined
        ? null
        : typeof first === "string"
          ? { name: first }
          : { name: SELECTOR_TARGET, selector: first.selector });
    this.selectorTarget = found?.selector ? { root: sequence.root, selector: found.selector } : null;

    const root = sequence.root;
    const last = sequence.index === sequence.tips.length - 1;
    const count = sequence.tips.length;
    view.show({
      text: tipWording(tip.text, this.options.touch()),
      icon: true,
      block: false,
      target: found?.name ?? null,
      ...(count > 1 && { dots: { index: sequence.index, count } }),
      actions: [{ label: last ? "Got it" : "Next", primary: true, onClick: () => this.advance() }],
      skip: { label: sequence.replay ? "Close" : "Skip tips", onClick: () => this.finish() },
      // A control scrolled out of its panel (the Shop's Protection) is brought into view.
      onTargetFound: (rect) => {
        if (!found || !offScreen(rect)) return;
        const element = found.selector ? findIn(root, found.selector) : findTarget(found.name)?.element;
        element?.scrollIntoView?.({ block: "nearest" });
      },
    });
    sequence.displayed = true;
  }

  private advance(): void {
    const sequence = this.current;
    if (!sequence) return;
    sequence.index += 1;
    if (sequence.index >= sequence.tips.length) this.finish();
    else this.display();
  }

  /** The current screen is done (finished, skipped or left): marks it seen and moves on. */
  private finish(): void {
    const sequence = this.current;
    this.current = null;
    if (sequence) this.retire(sequence);
    this.next();
  }

  /** Marks a sequence seen if it was on screen and was not a replay. */
  private retire(sequence: Sequence): void {
    if (sequence.displayed && !sequence.replay) this.markSeen(sequence.screen);
  }

  /** What comes after a screen's tips: the rest of its batch, then what it paused. */
  private next(): void {
    if (this.current) return;
    if (this.startTimer !== null) {
      // A screen just opened; its tips start in a moment.
      this.view?.hide();
      return;
    }
    const entry = this.pending.shift();
    if (entry) {
      this.begin(entry);
      return;
    }
    while (this.paused.length > 0) {
      const sequence = this.paused.pop()!;
      if (shown(sequence.root)) {
        this.current = sequence;
        this.display();
        return;
      }
      this.retire(sequence);
    }
    this.teardownView();
  }

  /** Lets go of screens that went away while their tips were up or paused. */
  private prune(): void {
    if (this.view && !this.view.attached) {
      // A new scene cleared the overlay: whatever was up was left.
      this.stopAll(true);
      return;
    }
    this.paused = this.paused.filter((sequence) => {
      if (shown(sequence.root)) return true;
      this.retire(sequence);
      return false;
    });
    if (this.current && !shown(this.current.root)) this.finish();
  }

  /** Drops everything; with `left`, what was on screen counts as seen. */
  private stopAll(left: boolean): void {
    if (this.startTimer !== null) this.timers.clear(this.startTimer);
    this.startTimer = null;
    const sequences = [...this.paused, ...(this.current ? [this.current] : [])];
    this.current = null;
    this.paused = [];
    this.pending = [];
    if (left) for (const sequence of sequences) this.retire(sequence);
    this.teardownView();
  }

  /** The guided start began: its own steps take over, unseen tips wait. */
  private dropAutomatic(): void {
    this.pending = this.pending.filter((one) => one.replay);
    this.paused = this.paused.filter((one) => one.replay);
    if (this.current && !this.current.replay) {
      this.current = null;
      this.next();
    }
  }

  private teardownView(): void {
    this.view?.destroy();
    this.view = null;
    this.selectorTarget = null;
    this.hiddenByBlock = false;
    if (this.watchTimer !== null) this.timers.clear(this.watchTimer);
    this.watchTimer = null;
  }

  /** Checks, while tips are up, that their screen is still open and nothing blocks them. */
  private watch(): void {
    if (this.watchTimer !== null) return;
    this.watchTimer = this.timers.set(() => {
      this.watchTimer = null;
      this.tick();
      if (this.view) this.watch();
    }, this.options.watchMs ?? WATCH_MS);
  }

  /** One check (exposed for tests through the timers). */
  private tick(): void {
    this.prune();
    if (!this.current || !this.view) return;
    const blocked = this.blocked?.() ?? false;
    if (blocked && !this.hiddenByBlock) {
      this.view.hide();
      this.hiddenByBlock = true;
    } else if (!blocked && this.hiddenByBlock) {
      this.display();
    }
  }

  /* ── "?" ─────────────────────────────────────────────────────────────── */

  /**
   * Gives a screen with tips its "?": in its title row, in the title row of
   * the panel it sits in, or floating over the scene.
   */
  private attachHelp(ref: ScreenRef, header: HTMLElement | null): void {
    if (this.tips(ref.screen).length === 0) return;
    for (const [host, entry] of this.helpHosts) {
      if (!entry.button.attached) this.helpHosts.delete(host);
    }

    const titlebar =
      header ?? ref.root.closest(".panel")?.querySelector<HTMLElement>(":scope > .panel__titlebar") ?? null;
    const host = titlebar ?? ref.root;
    let entry = this.helpHosts.get(host);
    if (!entry) {
      const button = new HelpButton(titlebar ? "header" : "float", () => {
        const current = this.helpHosts.get(host);
        if (current) this.replay(current.entries.filter((one) => shown(one.root)));
      }).attach(host);
      entry = { button, entries: [] };
      this.helpHosts.set(host, entry);
    }
    entry.button.setHidden(guideOpen(this.onboarding));
    // A new scene, or the building panel on another building, starts the list
    // again; a Monsters tab replaces the tab before it.
    if (RESET_SCREENS.has(ref.screen)) entry.entries = [];
    const group = groupOf(ref.screen);
    entry.entries = [
      ...entry.entries.filter((one) => groupOf(one.screen) !== group && shown(one.root)),
      ref,
    ];
  }
}
