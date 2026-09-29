import { formatAmount } from "@/ui/format";
import { icon } from "@/ui/icons";
import "@/ui/styles/mail.css";

/**
 * The Mail button (#193): an envelope with the unread count on it, which
 * opens the mailbox screen.
 *
 * It lives on two screens in their own dress: on the yard it is one of the
 * dock's round buttons, beside Monsters (`YardDock.placeBesideMonsters`); on
 * the Map Room 2 map it is a tool button at the head of the tool row. The
 * button only shows and reports; the scene opens the screen and says what the
 * count is.
 */

export type MailButtonStyle = "dock" | "tool";

export interface MailButtonOptions {
  readonly style: MailButtonStyle;
  readonly onOpen: () => void;
}

/** "3 unread messages", the badge's words. */
export const unreadText = (count: number): string =>
  count === 1 ? "1 unread message" : `${formatAmount(count)} unread messages`;

/** The badge caps at this, so it stays one small disc. */
const BADGE_MAX = 99;

export class MailButton {
  readonly element: HTMLButtonElement;

  private readonly badge: HTMLElement;
  private count = 0;

  constructor(options: MailButtonOptions) {
    this.element = document.createElement("button");
    this.element.type = "button";
    this.badge = document.createElement("span");
    this.badge.hidden = true;

    const label = document.createElement("span");
    label.textContent = "Mail";

    if (options.style === "dock") {
      this.element.className = "yard-dock__button yard-dock__button--mail";
      this.element.dataset["dock"] = "mail";
      const disc = document.createElement("span");
      disc.className = "yard-dock__disc";
      this.badge.className = "yard-dock__badge mail-badge";
      disc.append(icon("mail", 29), this.badge);
      label.className = "yard-dock__label";
      this.element.append(disc, label);
    } else {
      this.element.className = "mr2-tool mail-tool";
      this.badge.className = "mail-badge mail-badge--tool";
      label.className = "mr2-tool__label";
      this.element.append(icon("mail", 20, "map-icon"), label, this.badge);
    }
    this.element.addEventListener("click", () => options.onOpen());
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
    const words = this.count > 0 ? `Mail. ${unreadText(this.count)}` : "Mail";
    this.element.setAttribute("aria-label", words);
    this.element.title = this.count > 0 ? `Mail: ${unreadText(this.count)}` : "Mail: your messages and notices";
  }

  destroy(): void {
    this.element.remove();
  }
}
