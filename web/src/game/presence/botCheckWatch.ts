import type { BotCheckAnswer, BotCheckChallenge } from "@/api/botCheck";

/**
 * The in-game check's clock and state (#273).
 *
 * The server asks for a check when it sees bot-like play
 * (`server/src/services/user/botPatterns.ts`), and while one waits the
 * player counts as away and can be attacked. The client learns of it from
 * `checkPending` on the presence ping's answer (every 30 seconds) and on every
 * real action's answer (`api/http.ts` `onAnswer`), then asks for the check
 * and shows it. A right tap clears it; a wrong one gets a new check; too many
 * wrong ones get a short wait, and the next check after it.
 *
 * Only on game screens: every screen past sign-in holds the watch, as it
 * holds the presence ping. It takes priority over the "Still there?" and
 * "Stay protected?" prompts (`App.ts`): a tap on "Stay protected" protects
 * nothing while a check waits.
 */

/** What the card shows. */
export type BotCheckView =
  | {
      readonly kind: "challenge";
      readonly challenge: BotCheckChallenge;
      /** The last tap was wrong: this is a new check. */
      readonly retry: boolean;
    }
  /** Too many wrong answers: the next check at `until`, a {@link BotCheckWatchOptions.now} time. */
  | { readonly kind: "wait"; readonly until: number };

/** How long after a failed request the watch asks again. */
export const RETRY_MS = 15_000;

export interface BotCheckWatchOptions {
  /** Asks the server for the check waiting. */
  readonly fetch: () => Promise<BotCheckAnswer>;
  /** Sends one tap. */
  readonly answer: (challenge: string, option: string) => Promise<BotCheckAnswer>;
  readonly onShow: (view: BotCheckView) => void;
  /** Solved, cleared, or nothing on screen to show it on. */
  readonly onHide: () => void;
  /** Who is signed in; a new account forgets the old one's check. */
  readonly account?: () => string | null;
  /** Milliseconds; `Date.now` by default. */
  readonly now?: () => number;
}

export class BotCheckWatch {
  private readonly fetchCheck: () => Promise<BotCheckAnswer>;
  private readonly sendAnswer: (challenge: string, option: string) => Promise<BotCheckAnswer>;
  private readonly onShow: (view: BotCheckView) => void;
  private readonly onHide: () => void;
  private readonly account: () => string | null;
  private readonly now: () => number;
  private pending = false;
  private pendingAccount: string | null = null;
  private view: BotCheckView | null = null;
  private holders = 0;
  private stopped = false;
  private shown = false;
  /** A request is out: the check's fetch, or a tap. */
  private busy = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: BotCheckWatchOptions) {
    this.fetchCheck = options.fetch;
    this.sendAnswer = options.answer;
    this.onShow = options.onShow;
    this.onHide = options.onHide;
    this.account = options.account ?? (() => null);
    this.now = options.now ?? Date.now;
  }

  /** Whether the card is up. */
  get showing(): boolean {
    return this.shown;
  }

  /** Whether a check waits, as far as the client knows. */
  get waiting(): boolean {
    return this.pending;
  }

  /**
   * Hears `checkPending` from any answer: true, a check waits; false, none
   * does. Answers that do not say leave it as it is.
   */
  hear(checkPending: boolean): void {
    const forgot = this.forgetOtherAccount();
    if (checkPending === this.pending && !forgot) return;
    this.pending = checkPending;
    if (!checkPending) this.view = null;
    this.update();
  }

  /** Holds the watch for one game screen; the returned function gives it back. */
  hold(): () => void {
    this.holders += 1;
    if (this.holders === 1) this.update();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holders -= 1;
      if (this.holders === 0) this.update();
    };
  }

  /**
   * One tap on an option. A failure is the caller's to show; the check stays
   * as it was.
   */
  async choose(option: string): Promise<void> {
    const view = this.view;
    if (view?.kind !== "challenge" || this.busy) return;
    this.busy = true;
    try {
      this.apply(await this.sendAnswer(view.challenge.id, option), true);
    } finally {
      this.busy = false;
    }
  }

  /** For good: the idle disconnect. */
  stop(): void {
    this.stopped = true;
    this.update();
  }

  /** Forgets a check heard for another account; says whether there was one to forget. */
  private forgetOtherAccount(): boolean {
    if (this.account() === this.pendingAccount) return false;
    this.pendingAccount = this.account();
    const had = this.pending || this.view !== null;
    this.pending = false;
    this.view = null;
    return had;
  }

  /** Takes in a check route's answer. */
  private apply(answer: BotCheckAnswer, tapped: boolean): void {
    if (answer.checkPending === false) {
      this.pending = false;
      this.view = null;
    } else if (answer.challenge) {
      this.pending = true;
      this.view = { kind: "challenge", challenge: answer.challenge, retry: tapped };
    } else if (typeof answer.cooldownUntil === "number") {
      this.pending = true;
      const offsetMs = typeof answer.now === "number" ? answer.now * 1000 - this.now() : 0;
      this.view = { kind: "wait", until: answer.cooldownUntil * 1000 - offsetMs };
    }
    this.pendingAccount = this.account();
    this.update();
  }

  /** Asks for the check, once, when one waits and there is a screen to show it on. */
  private load(): void {
    if (this.busy) return;
    this.busy = true;
    this.fetchCheck()
      .then(
        (answer) => {
          this.busy = false;
          this.apply(answer, false);
        },
        () => {
          this.busy = false;
          this.later(RETRY_MS);
        },
      )
      .catch(() => {});
  }

  private later(ms: number): void {
    this.clear();
    this.timer = setTimeout(() => {
      this.timer = null;
      // The wait is over, or a request failed: ask again.
      if (this.view?.kind === "wait") this.view = null;
      this.update();
    }, Math.max(0, ms));
  }

  private readonly update = (): void => {
    const live = this.pending && this.holders > 0 && !this.stopped;
    if (!live) {
      this.clear();
      this.setShown(null);
      return;
    }
    if (this.view === null) {
      this.load();
      return;
    }
    if (this.view.kind === "wait") this.later(this.view.until - this.now());
    else this.clear();
    this.setShown(this.view);
  };

  private setShown(view: BotCheckView | null): void {
    if (view === null) {
      if (!this.shown) return;
      this.shown = false;
      this.onHide();
      return;
    }
    this.shown = true;
    this.onShow(view);
  }

  private clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
