import type { Friend } from "@/api/friends";
import { canHelp } from "@/game/friends/friendText";
import { friendsStore as sharedStore, type FriendsStore } from "@/game/friends/friendsStore";
import { formatAmount } from "@/ui/format";
import { gameIcon } from "@/ui/gameIcon";
import { icon } from "@/ui/icons";
import { make } from "./rows";
import { FriendsWindow, type FriendsWindowOptions } from "./FriendsWindow";
import "./friends-button.css";

/**
 * The Friends button (owner, 9 Nov 2026, option A): one round disc beside Map
 * in the bottom-left corner of the own yard, on every screen size, in place
 * of the strip of portraits that ran along the bottom ("a bit too long and
 * intrusive"). It looks like the dock's other discs, with its word under it,
 * and pressing it opens the Friends window (`FriendsWindow.ts`) in the middle
 * of the screen.
 *
 * Its badge says whether a friend needs you: how many friends can use your
 * help today (a help-mode visit can still speed up or repair something), or,
 * when none can, the painted gift while a gift can still be sent to someone
 * today; no badge when there is nothing to do. Both come from the shared
 * friends store, which the Friends door keeps fresh (every 3 minutes).
 */

/** The badge caps at this. */
const BADGE_MAX = 99;

/** What the Friends button's badge wears. */
export interface FriendsBadge {
  readonly kind: "help" | "gift";
  /** The count shown for `help` ("3", "99+"); empty for `gift`, which shows the painted gift. */
  readonly text: string;
  /** Its words, for the tooltip and a screen reader. */
  readonly label: string;
}

/** "3 can use your help". */
export const helpNote = (count: number): string =>
  count === 1 ? "1 can use your help" : `${formatAmount(count)} can use your help`;

/**
 * The badge: how many friends can use a hand today, or, when none can, a
 * gift while one can still be sent; null when there is nothing to do.
 */
export const friendsBadge = (friends: readonly Friend[]): FriendsBadge | null => {
  const helpable = friends.filter(canHelp).length;
  if (helpable > 0) {
    return { kind: "help", text: helpable > BADGE_MAX ? `${BADGE_MAX}+` : String(helpable), label: helpNote(helpable) };
  }
  if (friends.some((friend) => !friend.giftSentToday)) return { kind: "gift", text: "", label: "A gift can be sent" };
  return null;
};

export interface FriendsButtonOptions extends Omit<FriendsWindowOptions, "onClose"> {
  /** Where the window opens: the overlay's modal layer. The page by default. */
  readonly modal?: HTMLElement;
}

export class FriendsButton {
  readonly element: HTMLButtonElement;

  private readonly options: FriendsButtonOptions;
  private readonly store: FriendsStore;
  private readonly badge = make("span", "yard-dock__badge friends-button__badge");
  private readonly unsubscribe: () => void;
  private window: FriendsWindow | null = null;

  constructor(options: FriendsButtonOptions = {}) {
    this.options = options;
    this.store = options.store ?? sharedStore;
    this.element = make("button", "yard-dock__button yard-dock__button--friends friends-button");
    this.element.type = "button";
    this.element.dataset["dock"] = "friends";
    this.element.setAttribute("aria-haspopup", "dialog");
    this.element.setAttribute("aria-expanded", "false");
    const disc = make("span", "yard-dock__disc");
    this.badge.hidden = true;
    disc.append(icon("friends", 29), this.badge);
    this.element.append(disc, make("span", "yard-dock__label", "Friends"));
    this.element.addEventListener("click", () => (this.window ? this.close() : this.open()));
    this.unsubscribe = this.store.subscribe(() => this.renderBadge());
  }

  mount(parent: HTMLElement): this {
    parent.append(this.element);
    return this;
  }

  /** Opens the Friends window; it is shown once only. */
  open(): FriendsWindow {
    if (this.window) return this.window;
    const { modal, ...options } = this.options;
    const opened = new FriendsWindow({
      ...options,
      store: this.store,
      onClose: () => {
        if (this.window === opened) this.window = null;
        this.element.setAttribute("aria-expanded", "false");
      },
    });
    this.window = opened;
    this.element.setAttribute("aria-expanded", "true");
    opened.mount(modal ?? document.body);
    return opened;
  }

  close(): void {
    this.window?.close();
  }

  destroy(): void {
    this.unsubscribe();
    this.close();
    this.element.remove();
  }

  private renderBadge(): void {
    const badge = friendsBadge(this.store.friends);
    this.badge.hidden = badge === null;
    this.badge.classList.toggle("friends-button__badge--gift", badge?.kind === "gift");
    if (badge?.kind === "gift") this.badge.replaceChildren(gameIcon("gift", { size: 16, decorative: true }));
    else this.badge.textContent = badge?.text ?? "";
    this.element.title = badge ? `Friends: ${badge.label}` : "Friends";
    this.element.setAttribute("aria-label", badge ? `Friends. ${badge.label}` : "Friends");
  }
}
