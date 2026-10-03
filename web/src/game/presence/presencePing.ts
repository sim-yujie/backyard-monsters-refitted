import { getAuthToken } from "@/api/http";
import { sendPresence } from "@/api/presence";

/**
 * Keeping the player "online" while they sit in the game (bot neighbours WP9,
 * #242; `docs/design/bot-neighbours.md` §8).
 *
 * The server reads a player as online while their `last-seen` key is under
 * 60 seconds old, and refuses attacks on their main yard for that time
 * (`baseModeAttack.ts`). Flash refreshed it with a 30-second poll; the web
 * client only refreshed it on a yard load, so an idle web player read as
 * offline after a minute and could be attacked while they watched.
 *
 * Every 30 seconds, then, while some screen holds the ping and the tab is
 * visible. Half the server's 60-second window, so one lost ping still leaves
 * the player online; a hidden tab stops pinging, and the player reads as away
 * a minute later, as the design wants. Coming back to the tab pings at once
 * when the last ping is 30 seconds old or more.
 *
 * Screens hold it rather than start it: every screen past sign-in takes a
 * hold on entry and gives it back on exit (`app/presenceScene.ts`), so it
 * runs only in the game, and moving between screens neither doubles the ping
 * nor sends an extra one.
 */

/** How often the ping goes while the tab is visible. */
export const PRESENCE_INTERVAL_MS = 30_000;

export interface PresencePingOptions {
  /** Sends one ping; a failure is ignored, and the next goes on time. */
  readonly ping: () => Promise<unknown>;
  /** Whether anyone is signed in; nothing is sent while not. */
  readonly signedIn: () => boolean;
  /** Milliseconds, for the tests; `Date.now` by default. */
  readonly now?: () => number;
}

export class PresencePing {
  private readonly ping: () => Promise<unknown>;
  private readonly signedIn: () => boolean;
  private readonly now: () => number;
  private holders = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** When the last ping went, or never. */
  private lastPing = Number.NEGATIVE_INFINITY;

  constructor(options: PresencePingOptions) {
    this.ping = options.ping;
    this.signedIn = options.signedIn;
    this.now = options.now ?? Date.now;
  }

  /** Whether some screen holds the ping. */
  get running(): boolean {
    return this.holders > 0;
  }

  /**
   * Holds the ping for one screen; the returned function gives the hold back
   * (a second call does nothing). Pings at once when the last ping is 30
   * seconds old or more.
   */
  hold(): () => void {
    this.holders += 1;
    if (this.holders === 1) {
      document.addEventListener("visibilitychange", this.onVisibility);
      this.schedule();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holders -= 1;
      if (this.holders > 0) return;
      document.removeEventListener("visibilitychange", this.onVisibility);
      this.clear();
    };
  }

  private readonly onVisibility = (): void => this.schedule();

  /** Sets the next ping for 30 seconds after the last, or none while hidden. */
  private schedule(): void {
    this.clear();
    if (this.holders === 0 || document.visibilityState === "hidden") return;
    this.timer = setTimeout(this.fire, Math.max(0, this.lastPing + PRESENCE_INTERVAL_MS - this.now()));
  }

  private readonly fire = (): void => {
    this.timer = null;
    if (this.holders === 0 || document.visibilityState === "hidden") return;
    if (this.signedIn()) {
      this.lastPing = this.now();
      this.ping().catch(() => {});
    }
    // From now, not from the last ping: signed out, there is none to count from.
    this.timer = setTimeout(this.fire, PRESENCE_INTERVAL_MS);
  };

  private clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** The game's one presence ping. */
export const presence = new PresencePing({
  ping: sendPresence,
  signedIn: () => getAuthToken() !== null,
});
