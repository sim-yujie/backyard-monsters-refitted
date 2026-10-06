/**
 * The "Stay protected?" prompt's clock (#275).
 *
 * The server counts a player as online, and so safe from attack, only while
 * they have made a real game action in the last ten minutes (#271,
 * `server/src/services/user/online.ts`): building, collecting, hatching,
 * attacking and the like. Moving the mouse is not one, so a player who reads
 * the map or watches their yard for ten minutes becomes attackable while
 * they sit there. The owner's rule: at 9 minutes since the last real action,
 * measured on the server's clock, a small prompt offers to keep them
 * protected; tapping it is a real action (`POST /bm/presence/stay`).
 *
 * The server says when the last real action was: the presence ping's answer
 * carries `now` and `lastAction` every 30 seconds, the tap answers the same
 * way, and every real action's own answer carries `lastAction`
 * (`api/http.ts` `onAnswer`), so the prompt goes the moment the player does
 * something real. A `lastAction` of 0 means none in the last ten minutes;
 * before any is known the clock counts from the first answer, so a player
 * who signs in and only looks around is asked nine minutes later.
 *
 * Only on game screens: every screen past sign-in holds the watch, as it
 * holds the presence ping (`app/presenceScene.ts`), but a Baiter test or its
 * replay, which it waits out (#308). The idle disconnect's
 * "Still there?" countdown comes first: while it is up this prompt waits
 * (`suppress`), and once input takes the countdown down this one shows if it
 * is still due. After the idle disconnect it never shows again (`stop`).
 */

/** The two times, in milliseconds. */
export interface ProtectionTimings {
  /** A real action keeps the player protected this long: the server's ten minutes. */
  readonly windowMs: number;
  /** The prompt shows this long before the protection ends. */
  readonly warningMs: number;
}

/** The owner's times: protected for 10 minutes, asked at 9. */
export const PROTECTION_TIMINGS: ProtectionTimings = { windowMs: 10 * 60_000, warningMs: 60_000 };

/**
 * DEV only: `?protect=<window seconds>[,<warning seconds>]` shortens the times
 * for testing, e.g. `?protect=40,20` asks 20 s after the last real action and
 * counts the protection down to 40 s. The server's own ten minutes do not
 * change. A production build, or a value that does not parse, gets
 * {@link PROTECTION_TIMINGS}. The warning defaults to half the window and is
 * never longer than it.
 */
export const protectionTimingsFor = (search: string, dev: boolean): ProtectionTimings => {
  if (!dev) return PROTECTION_TIMINGS;
  const raw = new URLSearchParams(search).get("protect");
  if (raw === null) return PROTECTION_TIMINGS;
  const [window, warning] = raw.split(",").map(Number);
  if (window === undefined || !Number.isFinite(window) || window <= 0) return PROTECTION_TIMINGS;
  const warn = warning !== undefined && Number.isFinite(warning) && warning > 0 ? warning : window / 2;
  return { windowMs: window * 1000, warningMs: Math.min(warn, window) * 1000 };
};

/**
 * How long the prompt waits after the idle countdown goes: the press on its
 * "I'm still here" is input, which takes the countdown down a moment before
 * the click sends the tap, and the prompt should not flash up in between.
 */
export const RESUME_GRACE_MS = 1_000;

/** What the server's answers say; every field optional, as most answers carry only some. */
export interface ProtectionAnswer {
  /** The server's clock, unix seconds. */
  readonly now?: number;
  /** The last real action, unix seconds; 0 when none in the last ten minutes. */
  readonly lastAction?: number;
}

export interface ProtectionWatchOptions {
  readonly timings?: ProtectionTimings;
  /** Shows the prompt; `endsAt` is when the protection ends, a {@link now} time. */
  readonly onShow: (endsAt: number) => void;
  /** Takes it down: a real action came, or the idle countdown is up. */
  readonly onHide: () => void;
  /** Sends the tap; its answer is heard like a ping's. */
  readonly stay: () => Promise<ProtectionAnswer>;
  /** Who is signed in; a new account starts the clock again. */
  readonly account?: () => string | null;
  /** Milliseconds; `Date.now` by default. */
  readonly now?: () => number;
}

export class ProtectionWatch {
  readonly timings: ProtectionTimings;
  private readonly onShow: (endsAt: number) => void;
  private readonly onHide: () => void;
  private readonly sendStay: () => Promise<ProtectionAnswer>;
  private readonly account: () => string | null;
  private readonly now: () => number;
  /** The server's clock minus the browser's, milliseconds. */
  private offsetMs = 0;
  /** What the clock counts from, server unix seconds; null before any answer. */
  private since: number | null = null;
  /** The account {@link since} belongs to. */
  private sinceAccount: string | null = null;
  private holders = 0;
  private suppressed = false;
  /** When the prompt may show again after the idle countdown, a browser-clock time. */
  private resumeAt = 0;
  private stopped = false;
  private shown = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ProtectionWatchOptions) {
    this.timings = options.timings ?? PROTECTION_TIMINGS;
    this.onShow = options.onShow;
    this.onHide = options.onHide;
    this.sendStay = options.stay;
    this.account = options.account ?? (() => null);
    this.now = options.now ?? Date.now;
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  /** Whether the prompt is up. */
  get showing(): boolean {
    return this.shown;
  }

  /** Whether the prompt is due now, shown or held back by the idle countdown. */
  get due(): boolean {
    const promptAt = this.promptAt();
    return promptAt !== null && this.now() >= promptAt;
  }

  /** Hears an answer from the server: a ping's, the tap's, or a real action's. */
  hear(answer: ProtectionAnswer): void {
    const account = this.account();
    if (account !== this.sinceAccount) {
      this.since = null;
      this.sinceAccount = account;
    }
    const serverNow = finite(answer.now);
    if (serverNow !== null) this.offsetMs = serverNow * 1000 - this.now();
    const lastAction = finite(answer.lastAction);
    if (lastAction !== null && lastAction > 0) {
      this.since = Math.max(this.since ?? 0, lastAction);
    } else if (this.since === null && serverNow !== null) {
      this.since = serverNow;
    }
    this.schedule();
  }

  /** Holds the watch for one game screen; the returned function gives it back. */
  hold(): () => void {
    this.holders += 1;
    if (this.holders === 1) this.schedule();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holders -= 1;
      if (this.holders === 0) this.schedule();
    };
  }

  /** Holds the prompt back while the idle countdown is up, and lets it show after. */
  suppress(on: boolean): void {
    if (on === this.suppressed) return;
    this.suppressed = on;
    if (!on) this.resumeAt = this.now() + RESUME_GRACE_MS;
    this.schedule();
  }

  /** The tap: tells the server, and hears its answer. A failure is the caller's to show. */
  async stay(): Promise<void> {
    this.hear(await this.sendStay());
  }

  /** For good: the idle disconnect. */
  stop(): void {
    this.stopped = true;
    this.schedule();
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  /** When the prompt is due, a browser-clock time; null while nothing is known. */
  private promptAt(): number | null {
    if (this.since === null) return null;
    return this.since * 1000 + this.timings.windowMs - this.timings.warningMs - this.offsetMs;
  }

  // Hidden tabs throttle timers: measure again on the way back.
  private readonly onVisibility = (): void => {
    if (document.visibilityState === "visible") this.schedule();
  };

  private readonly schedule = (): void => {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const promptAt = this.promptAt();
    if (this.stopped || this.holders === 0 || promptAt === null) {
      this.setShown(false);
      return;
    }
    const now = this.now();
    const showAt = Math.max(promptAt, this.resumeAt);
    if (now < showAt) {
      this.setShown(false);
      this.timer = setTimeout(this.schedule, showAt - now);
      return;
    }
    this.setShown(!this.suppressed);
  };

  private setShown(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    const promptAt = this.promptAt();
    if (on && promptAt !== null) this.onShow(promptAt + this.timings.warningMs);
    else this.onHide();
  }
}

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
