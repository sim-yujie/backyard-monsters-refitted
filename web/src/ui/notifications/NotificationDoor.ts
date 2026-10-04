import { notificationsApi, type GameNotification, type NotificationsApi } from "@/api/notifications";
import type { CompletedJob } from "@/api/types";
import { NotificationBell } from "./NotificationBell";
import { LOAD_FAILED_TEXT, NotificationPanel } from "./NotificationPanel";

/**
 * The own yard's way into its notification list (#257): the bell, the list
 * behind it (made the first time it opens), and the count on the bell.
 *
 * The count comes from the server with every yard answer and the yard's load
 * (`notifications`, read by the scene through `setSaveCount`), so the bell
 * never polls. Opening the list, marking one read and Mark all read each bring
 * the server's own count back too; the next answer with a different count
 * than the last takes over again, as the mailbox's door does.
 *
 * Shown only in the player's own yard: the yard scene makes one when no
 * foreign yard is open, and nothing else does.
 */

export interface NotificationDoorOptions {
  /** Where the list docks: the scene's overlay content. */
  readonly container: HTMLElement;
  /** Before the list opens: the scene closes whatever else docks there. */
  readonly onOpen?: () => void;
  /** The open yard: an outpost's `baseid`, or null for the main yard. */
  readonly currentYard: () => string | null;
  /** Selects a building in the open yard, as a job toast's button did. */
  readonly selectBuilding: (buildingId: number) => void;
  /** The routes, for a test. */
  readonly api?: NotificationsApi;
  /** Unix seconds now, for a test. */
  readonly now?: () => number;
}

export class NotificationDoor {
  readonly bell: NotificationBell;

  private readonly options: NotificationDoorOptions;
  private readonly api: NotificationsApi;
  private panel: NotificationPanel | null = null;
  private saveCount: number | null = null;
  private destroyed = false;
  /** Bumped by every fetch, so an answer that arrives late is dropped. */
  private generation = 0;

  constructor(options: NotificationDoorOptions) {
    this.options = options;
    this.api = options.api ?? notificationsApi;
    this.bell = new NotificationBell(() => this.toggle());
  }

  get isOpen(): boolean {
    return this.panel?.isOpen ?? false;
  }

  /** The list as it was last shown, for a test. */
  get shown(): readonly GameNotification[] {
    return this.panel?.notifications ?? [];
  }

  /** The count the latest yard answer carried; a new one takes over. */
  setSaveCount(count: number | undefined): void {
    if (typeof count !== "number" || !Number.isFinite(count)) return;
    const next = Math.max(0, Math.floor(count));
    if (next === this.saveCount) return;
    this.saveCount = next;
    this.bell.setCount(next);
  }

  /**
   * What the catch-up finished in a yard answer. The server wrote it into the
   * list (all but hatches, `liveBatches` on the server), so an open list
   * fetches again to show it.
   */
  jobsFinished(completed: readonly CompletedJob[]): void {
    if (this.isOpen && completed.some((job) => job.kind !== "hatch")) void this.refresh();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else void this.open();
  }

  async open(): Promise<void> {
    if (this.destroyed) return;
    this.options.onOpen?.();
    this.ensurePanel().open();
    await this.refresh();
  }

  close(): void {
    this.panel?.close();
  }

  destroy(): void {
    this.destroyed = true;
    this.panel?.destroy();
    this.panel = null;
    this.bell.destroy();
  }

  private ensurePanel(): NotificationPanel {
    this.panel ??= new NotificationPanel({
      onRead: (id) => void this.markRead(id),
      onReadAll: () => void this.markRead("all"),
      selectFor: (notification) => {
        if (notification.baseid !== this.options.currentYard()) return null;
        return (buildingId) => {
          // The building's panel docks where the list does.
          this.close();
          this.options.selectBuilding(buildingId);
        };
      },
      onClose: (hadFocus) => {
        if (hadFocus) this.bell.element.focus();
      },
      ...(this.options.now ? { now: this.options.now } : {}),
    }).mount(this.options.container);
    return this.panel;
  }

  private async refresh(): Promise<void> {
    const panel = this.panel;
    if (!panel) return;
    const generation = ++this.generation;
    try {
      const { notifications, unread } = await this.api.list();
      if (this.destroyed || generation !== this.generation) return;
      panel.show(notifications);
      this.bell.setCount(unread);
    } catch {
      if (this.destroyed || generation !== this.generation) return;
      panel.setStatus(LOAD_FAILED_TEXT);
    }
  }

  private async markRead(id: number | "all"): Promise<void> {
    const panel = this.panel;
    if (!panel) return;
    panel.markRead(id);
    // A fetch already on its way would show the row unread again.
    ++this.generation;
    try {
      const unread = id === "all" ? await this.api.readAll() : await this.api.read(id);
      if (!this.destroyed) this.bell.setCount(unread);
    } catch {
      // The dot stays off; the next open fetches the server's own state.
    }
  }
}
