/**
 * Disconnecting a player who has left the game open (#271).
 *
 * The presence ping (`presencePing.ts`) keeps a player "online" for as long as
 * their tab is visible, input or none, so a player who walks away from an open
 * tab reads as online for ever and can never be attacked. Flash disconnected
 * after 10 minutes without input (`GLOBAL.AFK`, `GLOBAL.as:1699-1712`, and
 * `POPUPS.Timeout`); the owner's rules for the web client:
 *
 * - 10 minutes with no input (pointer move, click or tap, wheel, key, touch)
 *   disconnects: the game stops behind a "You were away too long" screen with
 *   a Reconnect button, and no presence goes while it is up.
 * - At 9 minutes a 1-minute "Still there?" countdown shows; any input cancels
 *   it.
 * - Never during an attack or a replay: a screen can defer the disconnect,
 *   and when the last deferral ends a player still idle is disconnected at
 *   once (or warned, when the 9 minutes are up but not the 10).
 *
 * Time with the tab hidden counts, as in Flash, which measured from the wall
 * clock: a hidden tab sends no presence, so the player already reads as away,
 * and coming back after ten minutes finds the disconnect screen rather than a
 * yard that has stood still. Hidden tabs throttle timers, so every decision
 * reads the clock, and a return to the tab checks again at once.
 *
 * Input is heard on the window in the capture phase, before anything in the
 * game can stop it. A pointer move only writes the time; the one timer is set
 * for when the warning or the disconnect would be due and, when it fires,
 * measures again from the last input.
 */

/** The two times, in milliseconds. */
export interface IdleTimings {
  /** No input for this long disconnects. */
  readonly disconnectMs: number;
  /** The countdown shows for this long before the disconnect. */
  readonly warningMs: number;
}

/** The owner's times (#271): disconnect after 10 minutes, warn for the last one. */
export const IDLE_TIMINGS: IdleTimings = { disconnectMs: 10 * 60_000, warningMs: 60_000 };

/** The events that count as the player being there. */
export const IDLE_INPUT_EVENTS = [
  "pointermove",
  "pointerdown",
  "wheel",
  "keydown",
  "touchstart",
  "touchmove",
] as const;

/**
 * DEV only: `?idle=<disconnect seconds>[,<warning seconds>]` shortens the
 * times for testing, e.g. `?idle=40,20` warns after 20 s and disconnects after
 * 40 s. A production build, or a value that does not parse, gets
 * {@link IDLE_TIMINGS}. The warning defaults to half the disconnect time and
 * is never longer than it.
 */
export const idleTimingsFor = (search: string, dev: boolean): IdleTimings => {
  if (!dev) return IDLE_TIMINGS;
  const raw = new URLSearchParams(search).get("idle");
  if (raw === null) return IDLE_TIMINGS;
  const [disconnect, warning] = raw.split(",").map(Number);
  if (disconnect === undefined || !Number.isFinite(disconnect) || disconnect <= 0)
    return IDLE_TIMINGS;
  const warn =
    warning !== undefined && Number.isFinite(warning) && warning > 0 ? warning : disconnect / 2;
  return { disconnectMs: disconnect * 1000, warningMs: Math.min(warn, disconnect) * 1000 };
};

/** A time in words for the disconnect screen: "10 minutes", "1 minute", "40 seconds". */
export const idleDurationText = (ms: number): string => {
  const plural = (count: number, unit: string): string =>
    `${count} ${unit}${count === 1 ? "" : "s"}`;
  return ms % 60_000 === 0
    ? plural(ms / 60_000, "minute")
    : plural(Math.round(ms / 1000), "second");
};

/** Where the watch stands. */
export const IdleState = {
  /** No game screen holds the watch, or a deferral pauses it. */
  OFF: "off",
  WATCHING: "watching",
  /** The countdown is up. */
  WARNING: "warning",
  /** Disconnected: nothing more happens until the page is reloaded. */
  DISCONNECTED: "disconnected",
} as const;
export type IdleState = (typeof IdleState)[keyof typeof IdleState];

export interface IdleWatchOptions {
  readonly timings?: IdleTimings;
  /** Shows the countdown; `disconnectAt` is a {@link IdleWatchOptions.now} time. */
  readonly onWarn: (disconnectAt: number) => void;
  /** Takes the countdown down: input came, or a deferral began. */
  readonly onCancelWarn: () => void;
  /** Disconnects; called once. */
  readonly onDisconnect: () => void;
  /** Where input is heard; `window` by default. */
  readonly input?: EventTarget;
  /** Milliseconds; `Date.now` by default. */
  readonly now?: () => number;
}

export class IdleWatch {
  readonly timings: IdleTimings;
  private readonly onWarn: (disconnectAt: number) => void;
  private readonly onCancelWarn: () => void;
  private readonly onDisconnect: () => void;
  private readonly input: EventTarget;
  private readonly now: () => number;
  private holders = 0;
  private deferrals = 0;
  private warning = false;
  private disconnected = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** When the player last gave input; loading the page counts. */
  private lastInput: number;

  constructor(options: IdleWatchOptions) {
    this.timings = options.timings ?? IDLE_TIMINGS;
    this.onWarn = options.onWarn;
    this.onCancelWarn = options.onCancelWarn;
    this.onDisconnect = options.onDisconnect;
    this.input = options.input ?? window;
    this.now = options.now ?? Date.now;
    this.lastInput = this.now();
    for (const type of IDLE_INPUT_EVENTS) {
      this.input.addEventListener(type, this.activity, { capture: true, passive: true });
    }
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  get state(): IdleState {
    if (this.disconnected) return IdleState.DISCONNECTED;
    if (this.warning) return IdleState.WARNING;
    return this.active ? IdleState.WATCHING : IdleState.OFF;
  }

  /** How long since the last input, in milliseconds. */
  get idleFor(): number {
    return this.now() - this.lastInput;
  }

  /**
   * Holds the watch for one game screen; the returned function gives the
   * hold back (a second call does nothing). The sign-in screens hold none.
   */
  hold(): () => void {
    this.holders += 1;
    if (this.holders === 1) this.schedule();
    return this.once(() => {
      this.holders -= 1;
      if (this.holders === 0) this.schedule();
    });
  }

  /**
   * Defers the disconnect for an attack or a replay: no countdown and no
   * disconnect while any deferral is held. When the last is given back, a
   * player still idle is disconnected at once, so give it back while the
   * screen still holds the watch.
   */
  defer(): () => void {
    this.deferrals += 1;
    if (this.deferrals === 1) this.schedule();
    return this.once(() => {
      this.deferrals -= 1;
      if (this.deferrals === 0) this.schedule();
    });
  }

  /** Any input: the player is there. Cheap, as pointer moves call it often. */
  readonly activity = (): void => {
    if (this.disconnected) return;
    this.lastInput = this.now();
    // The timer measures again when it fires; only the countdown needs taking down now.
    if (this.warning) this.schedule();
  };

  /** Stops listening and clears the timer; the countdown is left to its owner. */
  destroy(): void {
    this.clear();
    for (const type of IDLE_INPUT_EVENTS) {
      this.input.removeEventListener(type, this.activity, { capture: true });
    }
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  private get active(): boolean {
    return !this.disconnected && this.holders > 0 && this.deferrals === 0;
  }

  // Hidden tabs throttle timers: measure again on the way back.
  private readonly onVisibility = (): void => {
    if (document.visibilityState === "visible") this.schedule();
  };

  /** Decides from the clock what is due now, and sets the timer for what is next. */
  private readonly schedule = (): void => {
    this.clear();
    if (!this.active) {
      this.setWarning(false);
      return;
    }
    const { disconnectMs, warningMs } = this.timings;
    const disconnectAt = this.lastInput + disconnectMs;
    const now = this.now();
    if (now >= disconnectAt) {
      this.disconnect();
      return;
    }
    const warnAt = disconnectAt - warningMs;
    if (now >= warnAt) {
      this.setWarning(true, disconnectAt);
      this.timer = setTimeout(this.schedule, disconnectAt - now);
    } else {
      this.setWarning(false);
      this.timer = setTimeout(this.schedule, warnAt - now);
    }
  };

  private setWarning(on: boolean, disconnectAt = 0): void {
    if (on === this.warning) return;
    this.warning = on;
    if (on) this.onWarn(disconnectAt);
    else this.onCancelWarn();
  }

  private disconnect(): void {
    this.setWarning(false);
    this.disconnected = true;
    this.destroy();
    this.onDisconnect();
  }

  private clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private once(release: () => void): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release();
    };
  }
}
