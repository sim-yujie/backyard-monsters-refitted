import type { CompletedJob } from "@/api/types";

/**
 * The Monsters button's cyan "finished jobs" count (#192; the owner's call,
 * 2026-09-30): the monster jobs that finished since the player last opened
 * the Monsters screen, the ones that finished while they were away included.
 *
 * Nothing on the Monsters side waits to be collected: an unlock, a training
 * or a research applies itself when it ends. So the count says "new since
 * you looked", and opening the screen clears it. Hatches are left out: a
 * busy hatchery finishes one every few seconds, and the amber badge already
 * says when hatched monsters are stuck waiting for room.
 *
 * It lives for the tab, not the yard screen: leaving for the map and coming
 * back keeps it, a reload starts again from what the load's catch-up says
 * finished while away. Nothing is stored.
 */

/** The `completed` kinds that count. */
export const MONSTERS_JOB_KINDS: ReadonlySet<string> = new Set(["unlock", "train", "research"]);

/** How many of one answer's finished jobs count. */
export const monstersJobsIn = (completed: readonly CompletedJob[]): number =>
  completed.filter((job) => MONSTERS_JOB_KINDS.has(job.kind)).length;

/** "1 monster job finished", the badge's tooltip. */
export const finishedText = (count: number): string =>
  count === 1 ? "1 monster job finished" : `${count} monster jobs finished`;

type Listener = (count: number) => void;

/** The tab's count. One per tab: {@link finishedMonstersJobs}. */
export class FinishedMonstersJobs {
  private count = 0;
  private readonly listeners = new Set<Listener>();

  get value(): number {
    return this.count;
  }

  /** Adds what an answer finished; nothing that does not count changes it. */
  add(completed: readonly CompletedJob[]): void {
    const more = monstersJobsIn(completed);
    if (more === 0) return;
    this.count += more;
    this.emit();
  }

  /** The player opened the Monsters screen. */
  clear(): void {
    if (this.count === 0) return;
    this.count = 0;
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.count);
  }
}

/** The tab's one count. */
export const finishedMonstersJobs = new FinishedMonstersJobs();
