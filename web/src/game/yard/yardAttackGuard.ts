import { ApiError } from "@/api/http";
import type { YardAttack, YardAttackWatch } from "@/game/presence/yardAttack";

/**
 * Locks the player's own yard while it is attacked, and reloads it after
 * (#275, `game/presence/yardAttack.ts`).
 *
 * Two things lock it: the presence answer saying the main yard is under
 * attack (with the attacker's name), and the server refusing one of the
 * yard's own requests, or its load, for `underAttack`. A refusal asks the
 * server at once, so the name follows within a second when it is the main
 * yard. An outpost's attack is not in the presence answer: its yard stays
 * locked with no name, and tries loading again every
 * {@link RETRY_RELOAD_MS} until the load goes through.
 *
 * When the answer says the attack is over the yard reloads, which shows the
 * damage the attack's save wrote; the report reaches Mail on its own.
 */

/** How long a yard locked by a refusal alone waits before it tries loading again. */
export const RETRY_RELOAD_MS = 15_000;

/** What the lock looks like; `UnderAttackLock` on screen. */
export interface AttackLockView {
  /** Shows the lock, or updates it: `by` and `ends` null while the server has not said. */
  show(by: string | null, ends: number | null): void;
  hide(): void;
}

/** Whether a failed own-yard load was refused because the yard is under attack (`baseUnderAttackErr`, a 409). */
export const isUnderAttackRefusal = (caught: unknown): boolean =>
  caught instanceof ApiError && caught.serverStatus === 409;

export interface YardAttackGuardOptions {
  readonly watch: Pick<YardAttackWatch, "current" | "subscribe" | "check">;
  readonly view: AttackLockView;
  /** Opens the yard afresh: the attack is over, or a locked yard tries again. */
  readonly reload: () => void;
  readonly retryMs?: number;
}

export class YardAttackGuard {
  private readonly watch: YardAttackGuardOptions["watch"];
  private readonly view: AttackLockView;
  private readonly reload: () => void;
  private readonly retryMs: number;
  private readonly unsubscribe: () => void;
  private lockedNow = false;
  private retry: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(options: YardAttackGuardOptions) {
    this.watch = options.watch;
    this.view = options.view;
    this.reload = options.reload;
    this.retryMs = options.retryMs ?? RETRY_RELOAD_MS;
    this.unsubscribe = this.watch.subscribe(this.onChange);
    const attack = this.watch.current;
    if (attack) this.lock(attack);
  }

  /** Whether the yard is locked. */
  get locked(): boolean {
    return this.lockedNow;
  }

  /** A yard request, or the load, was refused for `underAttack`. */
  refused(): void {
    if (this.destroyed) return;
    const attack = this.watch.current;
    if (attack) this.lock(attack);
    else this.lock(null);
    this.watch.check();
    this.retry ??= setInterval(() => {
      // Only while the answers know of no attack: one they know of ends by itself.
      if (!this.watch.current) this.finish();
    }, this.retryMs);
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe();
    this.stopRetry();
    this.view.hide();
  }

  private readonly onChange = (attack: YardAttack | null): void => {
    if (this.destroyed) return;
    if (attack) this.lock(attack);
    else if (this.lockedNow) this.finish();
  };

  private lock(attack: YardAttack | null): void {
    this.lockedNow = true;
    this.view.show(attack?.by ?? null, attack?.ends ?? null);
  }

  /** The attack is over: down with the lock, and up with the yard as it is now. */
  private finish(): void {
    this.lockedNow = false;
    this.stopRetry();
    this.view.hide();
    this.reload();
  }

  private stopRetry(): void {
    if (this.retry !== null) clearInterval(this.retry);
    this.retry = null;
  }
}
