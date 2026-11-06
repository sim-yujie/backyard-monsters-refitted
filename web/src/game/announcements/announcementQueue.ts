import type { Announcement } from "@/api/announcements";
import type { GuideState } from "@/api/types";

/**
 * When the owner's announcements pop up (`ui/announcements/AnnouncementDialog.ts`):
 * after the own yard loads, each current one the player has not pressed
 * "Got it" on, newest first, one at a time. "Got it" is kept on the server
 * per account (`POST /bm/announcements/:id/dismiss`), so one does not come
 * back on another device; closing it any other way counts the same.
 *
 * They wait while something else has the screen: Bob's guided start (a
 * brand-new player sees them once it is over), another popup such as the
 * "What's new" cards, or Bob talking. Each shows once a visit to the page
 * even when the server could not record "Got it".
 */

/** How long after the yard loads the first one may show: "What's new" goes first. */
export const FIRST_DELAY_MS = 1_500;
/** How often a waiting one checks whether the screen is free. */
export const RETRY_MS = 1_000;
/** The pause between one closing and the next showing. */
export const GAP_MS = 400;

/** Whether Bob's guided start still has the yard. */
export const guideRunning = (state: GuideState | undefined): boolean =>
  state === "pending" || state === "active";

/** The ones to pop up, newest first: not dismissed, not shown on this page already. */
export const toShow = (
  list: readonly Announcement[],
  shown: ReadonlySet<number>,
): Announcement[] =>
  list
    .filter((item) => !item.dismissed && !shown.has(item.id))
    .sort((a, b) => Date.parse(b.shownFrom) - Date.parse(a.shownFrom) || b.id - a.id);

export interface AnnouncementQueueDeps {
  load(): Promise<readonly Announcement[]>;
  dismiss(id: number): Promise<unknown>;
  /** Opens one; calls `closed` once when it closes. Returns how to close it early. */
  show(
    item: Announcement,
    step: { index: number; total: number },
    closed: () => void,
  ): { close(): void };
  /** Whether something else has the screen now. */
  blocked(): boolean;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/** The announcements shown on this page so far, across yard visits. */
const shownOnThisPage = new Set<number>();

/** Notes ones the player saw another way (the Account menu's "News"): they do not pop up. */
export const markShownOnThisPage = (ids: readonly number[]): void => {
  for (const id of ids) shownOnThisPage.add(id);
};

/** Forgets what this page showed (tests). */
export const resetShownOnThisPage = (): void => shownOnThisPage.clear();

export class AnnouncementQueue {
  private readonly deps: AnnouncementQueueDeps;
  private readonly shown: Set<number>;
  private waiting: Announcement[] = [];
  private total = 0;
  private timer: unknown = null;
  private open: { id: number; close(): void } | null = null;
  private stopped = false;

  constructor(deps: AnnouncementQueueDeps, shown: Set<number> = shownOnThisPage) {
    this.deps = deps;
    this.shown = shown;
  }

  /** Reads the list, then shows the first when the screen is free. */
  async start(): Promise<void> {
    let list: readonly Announcement[];
    try {
      list = await this.deps.load();
    } catch {
      // No announcements this visit; the next yard visit reads them again.
      return;
    }
    if (this.stopped) return;
    this.waiting = toShow(list, this.shown);
    this.total = this.waiting.length;
    if (this.total > 0) this.later(FIRST_DELAY_MS);
  }

  /** Stops waiting and closes the one open (the yard is going). */
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
    const open = this.open;
    this.open = null;
    if (!open) return;
    // Not seen through: it shows again on the next yard visit.
    this.shown.delete(open.id);
    open.close();
  }

  private later(ms: number): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      this.next();
    }, ms);
  }

  private next(): void {
    if (this.stopped || this.open) return;
    // Seen in "News" while it waited.
    this.waiting = this.waiting.filter((waiting) => !this.shown.has(waiting.id));
    const item = this.waiting[0];
    if (!item) return;
    if (this.deps.blocked()) {
      this.later(RETRY_MS);
      return;
    }
    this.waiting.shift();
    this.shown.add(item.id);
    let closed = false;
    const view = this.deps.show(
      item,
      { index: this.total - this.waiting.length - 1, total: this.total },
      () => {
        if (closed) return;
        closed = true;
        this.open = null;
        // A yard torn down mid-way closes it: that is not "Got it".
        if (this.stopped) return;
        void this.deps.dismiss(item.id).catch(() => undefined);
        this.later(GAP_MS);
      },
    );
    if (!closed) this.open = { id: item.id, close: () => view.close() };
  }
}
