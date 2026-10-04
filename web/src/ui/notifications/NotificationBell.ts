import { formatAmount } from "@/ui/format";
import { icon } from "@/ui/icons";
import "@/ui/styles/notifications.css";

/**
 * The bell (#257): one of the own yard's round dock buttons, beside Mail, with
 * the unread notification count on it. It opens the notification list. The
 * button only shows and reports; `NotificationDoor` opens the list and says
 * what the count is.
 */

/** "3 unread notifications", the badge's words. */
export const unreadNotificationsText = (count: number): string =>
  count === 1 ? "1 unread notification" : `${formatAmount(count)} unread notifications`;

/** The badge caps at this, so it stays one small disc. */
const BADGE_MAX = 99;

export class NotificationBell {
  readonly element: HTMLButtonElement;

  private readonly badge: HTMLElement;
  private count = 0;

  constructor(onOpen: () => void) {
    this.element = document.createElement("button");
    this.element.type = "button";
    this.element.className = "yard-dock__button yard-dock__button--bell";
    this.element.dataset["dock"] = "bell";

    const disc = document.createElement("span");
    disc.className = "yard-dock__disc";
    this.badge = document.createElement("span");
    this.badge.className = "yard-dock__badge notif-badge";
    this.badge.hidden = true;
    disc.append(icon("bell", 29), this.badge);

    const label = document.createElement("span");
    label.className = "yard-dock__label";
    label.textContent = "Alerts";

    this.element.append(disc, label);
    this.element.addEventListener("click", () => onOpen());
    this.setCount(0);
  }

  get unread(): number {
    return this.count;
  }

  /** The unread count on the badge; none shows at 0. */
  setCount(count: number): void {
    this.count = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
    this.badge.hidden = this.count === 0;
    this.badge.textContent = this.count > BADGE_MAX ? `${BADGE_MAX}+` : String(this.count);
    const words = this.count > 0 ? `Notifications. ${unreadNotificationsText(this.count)}` : "Notifications";
    this.element.setAttribute("aria-label", words);
    this.element.title =
      this.count > 0 ? `Notifications: ${unreadNotificationsText(this.count)}` : "Notifications: what finished in your yard";
  }

  destroy(): void {
    this.element.remove();
  }
}
