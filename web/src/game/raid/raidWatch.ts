import { parseRaidView, type RaidView } from "@/api/raid";
import { presence } from "@/game/presence/presencePing";

/**
 * The open wild monster raid on the player's own yard, as the server last
 * said it (issue #226 WP4, `docs/design/wild-raids.md` §4.2).
 *
 * The presence ping opens a raid and every ping's answer carries it (`raid`,
 * with the server's clock), so nothing new polls. The raid routes' own answers
 * (`engage`, `prepare`, `start`) set it at once, and the finish takes it away.
 *
 * Answers can cross: a ping sent before "Prepare defences" may answer after
 * it. Within one raid, then, nothing goes backwards: once warned it stays
 * warned, the fight's time only comes earlier ("Engage now"), and a fight
 * never turns back into a warning.
 */

export interface RaidAnswer {
  readonly now?: unknown;
  readonly raid?: unknown;
}

export type RaidListener = (raid: RaidView | null) => void;

/** One raid moved on by a newer word about it, never backwards. */
const merge = (known: RaidView | null, heard: RaidView): RaidView => {
  if (!known || known.id !== heard.id) return heard;
  if (known.phase === "fighting" && heard.phase === "warning") return known;
  return {
    ...heard,
    warned: known.warned === 1 || heard.warned === 1 ? 1 : 0,
    attackAt: Math.min(known.attackAt, heard.attackAt),
  };
};

const sameRaid = (one: RaidView | null, other: RaidView | null): boolean =>
  one === other ||
  (one !== null &&
    other !== null &&
    one.id === other.id &&
    one.phase === other.phase &&
    one.warned === other.warned &&
    one.attackAt === other.attackAt);

export class RaidWatch {
  private raid: RaidView | null = null;
  /** The server's clock minus the browser's, seconds. */
  private offset = 0;
  private readonly listeners = new Set<RaidListener>();
  /** DEV: a raid pinned by hand, which answers do not change (see {@link simulate}). */
  private simulated: RaidView | null | undefined = undefined;

  constructor(private readonly now: () => number = Date.now) {}

  /** The open raid, or null. */
  get current(): RaidView | null {
    return this.raid;
  }

  /** The server's clock as the last answer set it, unix seconds. */
  serverNow(): number {
    return this.now() / 1000 + this.offset;
  }

  /** Hears a presence answer: its clock, and its raid or that there is none. */
  hear(answer: RaidAnswer): void {
    if (typeof answer.now === "number" && Number.isFinite(answer.now)) {
      this.offset = answer.now - this.now() / 1000;
    }
    if (this.simulated !== undefined) return;
    const heard = parseRaidView(answer.raid);
    this.apply(heard === null ? null : merge(this.raid, heard));
  }

  /** A raid route's own answer: the raid as it is now, or null once it is over or gone. */
  set(raid: RaidView | null): void {
    if (this.simulated !== undefined) this.simulated = raid;
    this.apply(raid === null ? null : merge(this.raid, raid));
  }

  /**
   * DEV only, for a browser check with no raid due on the server:
   * `simulate(raid)` pins one, `simulate(null)` pins none, and `simulate()`
   * goes back to what the server says.
   */
  simulate(raid?: RaidView | null): void {
    this.simulated = raid;
    if (raid !== undefined) this.apply(raid);
  }

  /** Hears every change from now on; returns the unsubscribe. */
  subscribe(listener: RaidListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private apply(next: RaidView | null): void {
    if (sameRaid(this.raid, next)) {
      this.raid = next;
      return;
    }
    this.raid = next;
    for (const listener of [...this.listeners]) listener(next);
  }
}

/** The game's one watch, fed by the presence ping. */
export const raidWatch = new RaidWatch();
presence.onAnswer((answer) => {
  if (answer !== null && typeof answer === "object") raidWatch.hear(answer as RaidAnswer);
});
