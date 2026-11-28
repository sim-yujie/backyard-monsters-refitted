/**
 * The door to the battle workers for the attacks a player can start at will
 * (patch 9.1, owner's option A on card repeat-busy-91, 26 Nov 2026): Repeat
 * attack, a wild monster raid's start, a Trojan Horse's spring and a friend's
 * baiter test. It replaces the old slot, which a Repeat held through its
 * whole save (database work included) and which polled every 50 ms, so the
 * luckiest waiter barged in and the rest were turned away "busy" after 5 s.
 *
 * - **A first-come queue with places.** Whoever cannot go in at once waits in
 *   line; {@link ReplayGate.place} says where (1 = next), which the Repeat's
 *   working bar shows.
 * - **When the door opens.** The head of the line goes in when a battle
 *   worker is free now (nothing queued for the workers, a seat free) and
 *   fewer than `maxAdmitted` are inside. Inside, a Repeat does its database
 *   work holding no worker; its battles queue for a worker like any other
 *   (`replayPool.ts`), so a worker is held only for a battle. `maxAdmitted`
 *   bounds how many can pile their battles onto the workers at once.
 * - **Hard limits.** At most `maxWaiting` wait; one more is turned away at
 *   once. A waiter not let in within its own `waitMs` is turned away. Both
 *   are the old "busy" refusal, so a pile-up never grows without end.
 * - **The log line.** Every refusal and every wait (anyone who did not go
 *   straight in) is logged as one `replay-queue` event with running totals
 *   (`log`), so live logs can count them.
 */

export type GateKind = "repeat" | "raid" | "trojan" | "wave" | "baiter" | "test";

/** How a wait ended. */
export type GateOutcome = "served" | "refused" | "gone";

/** One `replay-queue` log line. */
export interface GateLog {
  readonly kind: GateKind;
  readonly outcome: GateOutcome;
  /**
   * `full`: the line was at its limit on arrival; `timeout`: waited `waitMs`;
   * `battle`: let in, then turned away busy before anything was spent
   * because its first battle could not be fought in time (Repeat's plan check).
   */
  readonly why?: "full" | "timeout" | "battle";
  readonly waitedMs: number;
  /** The place on arrival (1 = next); 0 when turned away on arrival. */
  readonly place: number;
  readonly waiting: number;
  readonly admitted: number;
  readonly totals: GateTotals;
}

export interface GateTotals {
  /** Went straight in. */
  readonly straight: number;
  /** Waited, then went in. */
  readonly waited: number;
  /** Turned away (`busy`). */
  readonly refused: number;
  /** Left the line (the player closed the game). */
  readonly gone: number;
}

export interface GateOptions {
  /** Inside at once, at most. */
  readonly maxAdmitted: number;
  /** In line at once, at most. */
  readonly maxWaiting: number;
  /** A battle asked for now would start at once. */
  readonly workerFree: () => boolean;
  readonly log?: (line: GateLog) => void;
}

export interface EnterOptions {
  readonly kind: GateKind;
  /** The longest this one waits in line. */
  readonly waitMs: number;
  /** The player, so {@link ReplayGate.place} can find them. */
  readonly who?: number;
  /** Aborted: the player left; the place is given up. */
  readonly signal?: AbortSignal;
}

interface Waiter {
  readonly kind: GateKind;
  readonly who: number | undefined;
  readonly since: number;
  readonly place: number;
  readonly grant: (release: () => void) => void;
  readonly refuse: (why: "timeout" | "gone") => void;
  timer: ReturnType<typeof setTimeout> | null;
  stopListening: () => void;
}

export class ReplayGate {
  private readonly line: Waiter[] = [];
  private inside = 0;
  private counts = { straight: 0, waited: 0, refused: 0, gone: 0 };

  constructor(private readonly opts: GateOptions) {}

  /** In line now. */
  get waiting(): number {
    return this.line.length;
  }

  /** Inside now. */
  get admitted(): number {
    return this.inside;
  }

  get totals(): GateTotals {
    return { ...this.counts };
  }

  /** The player's place in line (1 = next), or null when they are not in it. */
  place(who: number): number | null {
    const at = this.line.findIndex((waiter) => waiter.who === who);
    return at < 0 ? null : at + 1;
  }

  /**
   * Waits for a turn.
   *
   * @returns The release, to call once the attack is done (idempotent), or
   *   null when turned away: the line was full, the wait ran out, or the
   *   player left.
   */
  enter({ kind, waitMs, who, signal }: EnterOptions): Promise<(() => void) | null> {
    if (signal?.aborted) return Promise.resolve(null);
    if (this.line.length === 0 && this.canAdmit()) {
      this.counts.straight++;
      return Promise.resolve(this.admit());
    }
    if (this.line.length >= this.opts.maxWaiting) {
      this.counts.refused++;
      this.write({ kind, outcome: "refused", why: "full", waitedMs: 0, place: 0 });
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      const since = Date.now();
      const waiter: Waiter = {
        kind,
        who,
        since,
        place: this.line.length + 1,
        grant: (release) => {
          this.counts.waited++;
          this.write({ kind, outcome: "served", waitedMs: Date.now() - since, place: waiter.place });
          resolve(release);
        },
        refuse: (why) => {
          if (why === "gone") this.counts.gone++;
          else this.counts.refused++;
          this.write({
            kind,
            outcome: why === "gone" ? "gone" : "refused",
            ...(why === "timeout" && { why }),
            waitedMs: Date.now() - since,
            place: waiter.place,
          });
          resolve(null);
        },
        timer: null,
        stopListening: () => {},
      };
      waiter.timer = setTimeout(() => this.leave(waiter, "timeout"), waitMs);
      if (signal) {
        const onAbort = () => this.leave(waiter, "gone");
        signal.addEventListener("abort", onAbort, { once: true });
        waiter.stopListening = () => signal.removeEventListener("abort", onAbort);
      }
      this.line.push(waiter);
      // Someone may go in already (the head, when this one made no difference).
      this.pump();
    });
  }

  /**
   * One let in that was turned away busy afterwards, before anything was
   * spent (Repeat's plan check ran past its deadline): counted and logged as
   * a refusal like the line's own.
   */
  refusedInside(kind: GateKind): void {
    this.counts.refused++;
    this.write({ kind, outcome: "refused", why: "battle", waitedMs: 0, place: 0 });
  }

  /** Lets in whoever can go now: call when a worker or a turn frees up. */
  pump(): void {
    while (this.line.length > 0 && this.canAdmit()) {
      const waiter = this.line.shift()!;
      this.stop(waiter);
      waiter.grant(this.admit());
    }
  }

  private canAdmit(): boolean {
    return this.inside < this.opts.maxAdmitted && this.opts.workerFree();
  }

  private admit(): () => void {
    this.inside++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inside--;
      this.pump();
    };
  }

  private leave(waiter: Waiter, why: "timeout" | "gone"): void {
    const at = this.line.indexOf(waiter);
    if (at < 0) return;
    this.line.splice(at, 1);
    this.stop(waiter);
    waiter.refuse(why);
  }

  private stop(waiter: Waiter): void {
    if (waiter.timer) clearTimeout(waiter.timer);
    waiter.timer = null;
    waiter.stopListening();
  }

  private write(line: Omit<GateLog, "waiting" | "admitted" | "totals">): void {
    this.opts.log?.({ ...line, waiting: this.line.length, admitted: this.inside, totals: this.totals });
  }
}
