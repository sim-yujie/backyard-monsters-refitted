import { fetchSupportReminderDue, recordSupportReminder } from "@/api/support";
import { openSupportPanel, type SupportPanelOptions } from "@/ui/support/SupportPanel";

/**
 * The rare, polite "Support the game" reminder (owner 24 Oct 2026; 4 Nov:
 * "not too intrusive"). This file keeps the visit's part of the rule; the
 * server keeps the account's (`GET /bm/support/reminder`: at most once every
 * 7 days, never in the first 3 days, never after "Don't show again").
 *
 * It may show only:
 * - after {@link PLAY_MINUTES} minutes of play in this visit, counted only
 *   while the tab is shown (a tab left open in the background does not count);
 * - on the player's own main yard: the yard screen offers a {@link ReminderSpot}
 *   only there, never on a visit, an attack, a replay or the tribe editor,
 *   and never while Bob's guided start runs;
 * - while no other popup is open;
 * - once per visit at most, whatever the server says.
 *
 * This device also remembers "Don't show again" and the last time it showed,
 * so a failed save never makes it show more often here. When the server
 * cannot be asked, it does not show.
 */

export const PLAY_MINUTES = 30;
/** How often the clock is read. */
const TICK_MS = 15_000;
/** A longer gap between ticks (the computer slept) counts as this much play at most. */
const MAX_STEP_MS = 60_000;
const DAY_MS = 86_400_000;
/** The same 7 days the server keeps, so this device does not ask the server for nothing. */
const LOCAL_EVERY_MS = 7 * DAY_MS;
const STORAGE_KEY = "bymr.supportReminder";

/** Where the reminder may show right now: the modal layer, or null for "not now". */
export type ReminderSpot = () => HTMLElement | null;

interface LocalRecord {
  readonly off?: boolean;
  readonly shownAt?: number;
}

export interface SupportReminderDeps {
  readonly now: () => number;
  readonly visible: () => boolean;
  /** Whether any popup is open (the reminder never stacks on one). */
  readonly popupOpen: () => boolean;
  readonly fetchDue: () => Promise<boolean>;
  readonly record: (answer: "shown" | "never") => Promise<unknown>;
  readonly open: (options: SupportPanelOptions) => unknown;
  readonly load: () => LocalRecord;
  readonly save: (record: LocalRecord) => void;
}

const loadLocal = (): LocalRecord => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return {};
    const record = parsed as Record<string, unknown>;
    return {
      ...(record["off"] === true && { off: true }),
      ...(typeof record["shownAt"] === "number" && { shownAt: record["shownAt"] }),
    };
  } catch {
    return {};
  }
};

const saveLocal = (record: LocalRecord): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Private windows and blocked storage: the server's record is the real one.
  }
};

const defaultDeps: SupportReminderDeps = {
  now: () => Date.now(),
  visible: () => document.visibilityState === "visible",
  popupOpen: () => document.querySelector(".popup-backdrop") !== null,
  fetchDue: fetchSupportReminderDue,
  record: recordSupportReminder,
  open: openSupportPanel,
  load: loadLocal,
  save: saveLocal,
};

export class SupportReminder {
  private readonly deps: SupportReminderDeps;
  private playedMs = 0;
  private lastTick: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private spot: ReminderSpot | null = null;
  /** Asked the server (or showed) already in this visit. */
  private done = false;
  private asking = false;

  constructor(deps: Partial<SupportReminderDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps };
  }

  /** Minutes of shown play counted so far in this visit. */
  get playedMinutes(): number {
    return this.playedMs / 60_000;
  }

  /**
   * The own main yard offers where the reminder may show; the first offer
   * starts the play clock. Returns the call that takes the offer back, which
   * does nothing once a newer offer replaced it.
   */
  offer(spot: ReminderSpot): () => void {
    this.spot = spot;
    this.start();
    return () => {
      if (this.spot === spot) this.spot = null;
    };
  }

  /** Starts the play clock, once. */
  start(): void {
    if (this.timer !== null || this.done) return;
    this.lastTick = this.deps.now();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Counts the time since the last tick if the tab is shown, then shows the reminder if it may. */
  async tick(): Promise<void> {
    const now = this.deps.now();
    const step = this.lastTick === null ? 0 : Math.min(Math.max(now - this.lastTick, 0), MAX_STEP_MS);
    this.lastTick = now;
    if (this.deps.visible()) this.playedMs += step;
    await this.maybeShow(now);
  }

  private async maybeShow(now: number): Promise<void> {
    if (this.done || this.asking) return;
    if (this.playedMs < PLAY_MINUTES * 60_000) return;
    const local = this.deps.load();
    if (local.off || (local.shownAt !== undefined && now - local.shownAt < LOCAL_EVERY_MS)) {
      this.finish();
      return;
    }
    if (!this.spot || !this.spot() || this.deps.popupOpen()) return;

    this.asking = true;
    let due = false;
    try {
      due = await this.deps.fetchDue();
    } catch {
      due = false;
    }
    this.asking = false;
    this.finish();
    if (!due) return;
    // The player may have left the yard or opened something while the server answered.
    const container = this.spot?.() ?? null;
    if (!container || this.deps.popupOpen()) return;

    this.deps.save({ shownAt: now });
    void this.deps.record("shown").catch(() => undefined);
    this.deps.open({
      container,
      reminder: {
        onLater: () => undefined,
        onNever: () => {
          this.deps.save({ off: true, shownAt: now });
          void this.deps.record("never").catch(() => undefined);
        },
      },
    });
  }

  /** Dev only (`__bymrSupportReminder`): counts the 30 minutes as played and checks now. */
  skipWait(): Promise<void> {
    this.playedMs = Math.max(this.playedMs, PLAY_MINUTES * 60_000);
    return this.maybeShow(this.deps.now());
  }

  /** At most one try per visit. */
  private finish(): void {
    this.done = true;
    this.stop();
  }
}

/** The game's one reminder. */
export const supportReminder = new SupportReminder();

/**
 * Dev builds only, for screenshots and checks without waiting 30 minutes:
 * `__bymrSupportReminder.skipWait()` counts the 30 minutes as played and runs
 * the real check at once (server, yard, popups); `.show()` just opens the
 * reminder on the modal layer and records nothing.
 */
if (import.meta.env.DEV && typeof window !== "undefined") {
  Object.assign(window, {
    __bymrSupportReminder: {
      skipWait: () => supportReminder.skipWait(),
      show: () =>
        openSupportPanel({
          container: document.querySelector<HTMLElement>(".overlay__layer--modal") ?? document.body,
          reminder: { onLater: () => undefined, onNever: () => undefined },
        }),
    },
  });
}
