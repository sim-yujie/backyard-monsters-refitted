import type { GameNotification } from "@/api/notifications";
import { achievementLineText } from "@/game/achievements/unlockText";
import { sentText } from "@/game/mail/mailbox";
import { Panel } from "@/ui/Panel";
import { jobLine, jobLineText } from "@/ui/yard/JobNotices";
import "@/ui/styles/notifications.css";

/**
 * The notification list (#257): what the yard's catch-up finished, newest
 * first, as the server keeps it (the last 20, none older than 7 days). It
 * docks where the mailbox does.
 *
 * Each row is one notification worded as the yard's toasts were
 * (`jobLine`): one kind of job a yard answer finished, or the "While you were
 * away" line of a load; or an achievement earned ("Achievement earned: Town
 * Planner, +10 Shiny", `achievementLineText`, #204). An unread row has a dot and stays unread until it is
 * clicked; a building named in it is a button that selects it, when the
 * notification is about the yard that is open. "Mark all read" clears every
 * dot. The panel only shows and reports; `NotificationDoor` fetches and marks.
 */

export interface NotificationPanelOptions {
  /** A row was clicked: mark it read. */
  readonly onRead: (id: number) => void;
  readonly onReadAll: () => void;
  /**
   * A building in a row was clicked. Null for a notification about another
   * yard than the one open, whose buildings read as plain text.
   */
  readonly selectFor: (notification: GameNotification) => ((buildingId: number) => void) | null;
  readonly onClose?: (hadFocus: boolean) => void;
  /** Unix seconds now, for "5 min ago". */
  readonly now?: () => number;
}

/** What the list says with nothing in it. */
export const EMPTY_TEXT = "Nothing yet. Finished upgrades, builds and other jobs show up here.";
export const LOAD_FAILED_TEXT = "Your notifications could not load.";

/** A notification's plain text, as its row reads and its tooltip says it. */
export const lineText = (notification: GameNotification): string =>
  notification.kind === "achievement"
    ? achievementLineText(notification.jobs)
    : jobLineText(notification.kind, notification.jobs);

export class NotificationPanel {
  readonly element: HTMLElement;

  private readonly options: NotificationPanelOptions;
  private readonly now: () => number;
  private readonly readAll: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly rows: HTMLElement;
  private opened = false;
  private shown: GameNotification[] = [];

  constructor(options: NotificationPanelOptions) {
    this.options = options;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));

    // Not Panel's own close, which removes the element for good: the list
    // opens and closes many times over one scene.
    const panel = new Panel({ title: "Notifications", className: "notif-screen", closable: false });
    this.element = panel.element;
    this.element.hidden = true;
    this.element.setAttribute("role", "region");
    this.element.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.stopPropagation();
        this.close();
      }
    });

    this.readAll = document.createElement("button");
    this.readAll.type = "button";
    this.readAll.className = "btn btn--ghost notif-screen__read-all";
    this.readAll.textContent = "Mark all read";
    this.readAll.addEventListener("click", () => this.options.onReadAll());

    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn btn--ghost btn--icon notif-screen__close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close Notifications");
    close.addEventListener("click", () => this.close());
    panel.titlebar.append(this.readAll, close);

    this.status = document.createElement("p");
    this.status.className = "notif-status";
    this.status.setAttribute("role", "status");
    this.status.hidden = true;

    this.rows = document.createElement("ul");
    this.rows.className = "notif-list";
    this.rows.setAttribute("aria-label", "Your notifications");
    panel.setContent(this.status, this.rows);
    this.render();
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** The notifications as the panel last showed them. */
  get notifications(): readonly GameNotification[] {
    return this.shown;
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.element.hidden = false;
    this.element.querySelector<HTMLElement>(".notif-screen__close")?.focus();
  }

  close(): void {
    if (!this.opened) return;
    const hadFocus = this.element.contains(document.activeElement);
    this.opened = false;
    this.element.hidden = true;
    this.options.onClose?.(hadFocus);
  }

  /** Shows a list, newest first, as the server gave it. */
  show(notifications: readonly GameNotification[]): void {
    this.shown = [...notifications];
    this.setStatus(null);
    this.render();
  }

  /** Marks rows read in place, ahead of the server's answer: one id, or all of them. */
  markRead(id: number | "all"): void {
    this.shown = this.shown.map((one) => (id === "all" || one.id === id ? { ...one, read: true } : one));
    this.render();
  }

  /** A line over the list, such as a failed load; null clears it. */
  setStatus(text: string | null): void {
    this.status.hidden = text === null;
    this.status.textContent = text ?? "";
  }

  destroy(): void {
    this.element.remove();
  }

  private render(): void {
    this.readAll.disabled = !this.shown.some((one) => !one.read);
    if (this.shown.length === 0) {
      const empty = document.createElement("li");
      empty.className = "notif-list__empty";
      empty.textContent = EMPTY_TEXT;
      this.rows.replaceChildren(empty);
      return;
    }
    const now = this.now();
    this.rows.replaceChildren(...this.shown.map((one) => this.row(one, now)));
  }

  private row(notification: GameNotification, now: number): HTMLElement {
    const row = document.createElement("li");
    row.className = notification.read ? "notif-row" : "notif-row notif-row--unread";
    row.dataset["id"] = String(notification.id);
    row.tabIndex = 0;
    const words = lineText(notification);
    const text =
      notification.kind === "achievement"
        ? Object.assign(document.createElement("span"), { textContent: words })
        : jobLine(notification.kind, notification.jobs, this.options.selectFor(notification));
    text.classList.add("notif-row__text");

    const meta = document.createElement("span");
    meta.className = "notif-row__meta";
    meta.textContent = [sentText(notification.at, now), ...(notification.baseid === null ? [] : ["Outpost"])].join(" · ");
    if (!notification.read) {
      // The dot, in words.
      const unread = document.createElement("span");
      unread.className = "u-visually-hidden";
      unread.textContent = "Unread: ";
      row.append(unread);
    }
    row.append(text, meta);
    row.title = words;

    const read = (): void => {
      if (!notification.read) this.options.onRead(notification.id);
    };
    // A building's button selects it and, bubbling up, marks the row read too.
    row.addEventListener("click", read);
    row.addEventListener("keydown", (event) => {
      if (event.target !== row || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      read();
    });
    return row;
  }
}
