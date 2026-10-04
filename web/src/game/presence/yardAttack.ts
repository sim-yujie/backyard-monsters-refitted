import { presence } from "./presencePing";

/**
 * Whether someone is attacking the player's main yard right now (#275).
 *
 * A player whose yard screen is open but who has made no real game action
 * for ten minutes can be attacked (#271). The server then refuses every yard
 * action until the attack ends (`isAttackActive`, a 409 `underAttack`), so the
 * yard screen shows a banner naming the attacker, locks itself, and reloads
 * to show the damage once the attack is over.
 *
 * The presence ping's answer says so (`attack`, the server's
 * `PresenceAnswer`), every 30 seconds, so nothing new polls in the ordinary
 * case. While an attack runs the watch asks every
 * {@link ATTACK_RECHECK_MS} instead, so the yard comes back soon after the
 * attacker finishes; and a yard request refused for `underAttack` asks at
 * once (`check`), so the banner does not wait for the next ping.
 */

/** How often the watch asks while an attack runs. */
export const ATTACK_RECHECK_MS = 10_000;

export interface YardAttack {
  /** The attacker's name. */
  readonly by: string;
  /** When the attack runs out at the latest, server unix seconds. */
  readonly ends: number;
}

/** What a presence answer says about it. */
export interface YardAttackAnswer {
  readonly now?: number;
  readonly attack?: { readonly by?: unknown; readonly ends?: unknown } | null;
}

export type YardAttackListener = (attack: YardAttack | null) => void;

export interface YardAttackWatchOptions {
  /** Asks the server now: a presence ping, whose answer comes back to {@link YardAttackWatch.hear}. */
  readonly check: () => void;
  readonly recheckMs?: number;
  /** Milliseconds; `Date.now` by default. */
  readonly now?: () => number;
}

export class YardAttackWatch {
  private readonly checkNow: () => void;
  private readonly recheckMs: number;
  private readonly now: () => number;
  private readonly listeners = new Set<YardAttackListener>();
  private attack: YardAttack | null = null;
  /** The server's clock minus the browser's, seconds. */
  private offset = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** DEV: an attack set by hand, which answers do not change (see {@link simulate}). */
  private simulated: YardAttack | null | undefined = undefined;

  constructor(options: YardAttackWatchOptions) {
    this.checkNow = options.check;
    this.recheckMs = options.recheckMs ?? ATTACK_RECHECK_MS;
    this.now = options.now ?? Date.now;
  }

  /** The attack running now, as the last answer said; null when none. */
  get current(): YardAttack | null {
    return this.attack;
  }

  /** The server's clock as the last answer set it, unix seconds. */
  serverNow(): number {
    return this.now() / 1000 + this.offset;
  }

  /** Hears a presence answer. */
  hear(answer: YardAttackAnswer): void {
    if (typeof answer.now === "number" && Number.isFinite(answer.now)) {
      this.offset = answer.now - this.now() / 1000;
    }
    if (this.simulated !== undefined) return;
    const raw = answer.attack;
    const next: YardAttack | null =
      raw && typeof raw.ends === "number"
        ? { by: typeof raw.by === "string" && raw.by ? raw.by : "another player", ends: raw.ends }
        : null;
    this.set(next);
  }

  /**
   * DEV only, for a browser check without a real attack: `simulate({ by, ends })`
   * pins an attack, `simulate(null)` pins none, and `simulate()` goes back to
   * what the server says (the next answer).
   */
  simulate(attack?: YardAttack | null): void {
    this.simulated = attack;
    if (attack !== undefined) this.set(attack);
  }

  private set(next: YardAttack | null): void {
    const changed = (next === null) !== (this.attack === null) || (next !== null && next.by !== this.attack?.by);
    this.attack = next;
    this.setRechecking(next !== null);
    if (changed) for (const listener of [...this.listeners]) listener(next);
  }

  /** Asks the server now: a yard request was refused for `underAttack`. */
  check(): void {
    this.checkNow();
  }

  /** Hears every change from now on; returns the unsubscribe. */
  subscribe(listener: YardAttackListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setRechecking(on: boolean): void {
    if (on && this.timer === null) this.timer = setInterval(() => this.checkNow(), this.recheckMs);
    if (!on && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

/** The game's one watch, fed by the presence ping. */
export const yardAttack = new YardAttackWatch({ check: () => presence.pingNow() });
presence.onAnswer((answer) => {
  if (answer !== null && typeof answer === "object") yardAttack.hear(answer as YardAttackAnswer);
});
