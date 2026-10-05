import type { AchievementUnlock } from "@/api/types";

/**
 * The unlock pop-up's queue (`docs/design/achievements.md` §10.2, issue #204,
 * WP6): the achievements earned and paid but not yet shown, as the yard
 * answers, the owner's load and a takeover carry them (§9.3).
 *
 * One per tab, outside any yard, because a takeover's answer arrives on the
 * map and is shown on the yard that opens next, and because every answer
 * carries an unlock until `seen` lands: an id is taken in once, and later
 * copies are dropped. A reload starts it afresh; the server then sends only
 * what was never marked seen.
 *
 * The backfill's unlocks (a player's first read) come out as one summary card;
 * every other unlock is a card of its own, oldest first. Shown ids wait here
 * for `seen` until the server confirms them.
 */

/** One card: one live unlock, or the backfill's together. */
export interface UnlockCard {
  /** Oldest first. */
  readonly unlocks: readonly AchievementUnlock[];
  /** The backfill's summary of several. */
  readonly summary: boolean;
  /** The Shiny they paid together. */
  readonly shiny: number;
}

/** An answer's entry, if it is one: the field is the server's, so it is checked. */
const unlockOf = (value: unknown): AchievementUnlock | null => {
  if (typeof value !== "object" || value === null) return null;
  const { id, name, shiny, backfill } = value as Record<string, unknown>;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return null;
  return {
    id,
    name: typeof name === "string" && name !== "" ? name : `Achievement ${id}`,
    shiny: typeof shiny === "number" && Number.isFinite(shiny) && shiny > 0 ? shiny : 0,
    ...(backfill === true && { backfill: true as const }),
  };
};

export class UnlockInbox {
  private waiting: AchievementUnlock[] = [];
  /** Every id taken in since the start: queued, shown or confirmed. */
  private readonly known = new Set<number>();
  /** Shown, and `seen` not yet confirmed by the server. */
  private readonly unconfirmed = new Set<number>();
  private readonly listeners = new Set<() => void>();

  /**
   * Takes in an answer's `achievements`. Absent (rewards off, nothing new) is
   * nothing; ids already taken in are dropped.
   *
   * @returns Whether anything new was queued.
   */
  add(achievements: unknown): boolean {
    if (!Array.isArray(achievements)) return false;
    let added = false;
    for (const value of achievements) {
      const unlock = unlockOf(value);
      if (!unlock || this.known.has(unlock.id)) continue;
      this.known.add(unlock.id);
      this.waiting.push(unlock);
      added = true;
    }
    if (added) for (const listener of [...this.listeners]) listener();
    return added;
  }

  /** How many unlocks wait to be shown. */
  get size(): number {
    return this.waiting.length;
  }

  /**
   * Takes the next card off the queue: every backfilled unlock waiting, as
   * one, ahead of the rest (the backfill is the oldest); else the oldest
   * live unlock. Null when nothing waits.
   */
  next(): UnlockCard | null {
    const backfill = this.waiting.filter((unlock) => unlock.backfill);
    const unlocks = backfill.length > 0 ? backfill : this.waiting.slice(0, 1);
    if (unlocks.length === 0) return null;
    this.waiting = this.waiting.filter((unlock) => !unlocks.includes(unlock));
    return {
      unlocks,
      summary: unlocks.length > 1,
      shiny: unlocks.reduce((sum, unlock) => sum + unlock.shiny, 0),
    };
  }

  /** A card went up: its ids wait for `seen`. */
  shown(card: UnlockCard): void {
    for (const unlock of card.unlocks) this.unconfirmed.add(unlock.id);
  }

  /** The shown ids `seen` has not confirmed yet, oldest first. */
  toConfirm(): number[] {
    return [...this.unconfirmed];
  }

  /** `seen` answered for these (or refused them for good): they are done with. */
  confirmed(ids: readonly number[]): void {
    for (const id of ids) this.unconfirmed.delete(id);
  }

  /** Calls `listener` when something new is queued. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Forgets everything; for tests. */
  reset(): void {
    this.waiting = [];
    this.known.clear();
    this.unconfirmed.clear();
    this.listeners.clear();
  }
}

/** The tab's one queue. */
export const unlockInbox = new UnlockInbox();
