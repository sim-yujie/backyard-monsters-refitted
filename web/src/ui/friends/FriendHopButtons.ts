import { classicLook } from "@/game/classicLook";
import type { HopDirection, HopView } from "@/game/friends/friendHop";
import { gameIcon, gameIconUrl, type GameIconName } from "@/ui/gameIcon";
import { dockButton } from "@/ui/yard/YardDock";
import { followMapColumn } from "./FriendsButton";
import { make } from "./rows";
import "./friend-hop.css";

/**
 * Prev and Next on a friend's yard (beta 8; players on Discord, owner's
 * grilling 18 Nov 2026): two dock discs beside Map, where Friends sits on the
 * own yard, that step to the friend before or after in the Friends window's
 * order without going home (`game/friends/friendHop.ts` keeps the run).
 *
 * The owner's first choice was arrows on the visit bar; at 390px wide the bar
 * had no room for them (the name shrank to three letters and Next ran past
 * the frame), so they take the agreed fallback, the dock, on every screen.
 *
 * - An arrow at an end of the list is there but greyed out; with one friend
 *   both are.
 * - Next's badge: how many friends after this one can still use your help
 *   today, the Friends button's amber count.
 * - Both grey out while Help all runs, and after a press until the yard goes.
 */

export const FRIEND_HOP_TEXT = {
  group: "Other friends",
  prev: "Prev",
  next: "Next",
  prevTitle: (name: string): string => `Previous friend: ${name}`,
  nextTitle: (name: string): string => `Next friend: ${name}`,
  first: "This is the first friend in your list",
  last: "This is the last friend in your list",
  ahead: (count: number): string =>
    count === 1 ? "1 more friend can use your help" : `${count} more friends can use your help`,
} as const;

/** The badge caps at this. */
const BADGE_MAX = 99;

/**
 * The painted arrows (owner, 18 Nov 2026: painted, not line icons;
 * `ui/gameIcon.ts`), golden in Modern and in the softer Classic paint, chosen
 * by the look the game loaded with.
 */
export const hopArt = (direction: HopDirection, classic: boolean = classicLook()): GameIconName =>
  `friend${direction === 1 ? "next" : "prev"}${classic ? "classic" : ""}` as GameIconName;

/**
 * The arrow's size on the disc, in CSS px: the dock's own painted pictures
 * (`.yard-dock__picture`, `yard-hud.css`: 45, 40 or 38 px), as Friends and
 * Monsters beside it.
 */
export const HOP_ART_PX = 45;

/** Files past the usual 64 px that these four ship, for 45 px on a 3x phone (135 px). */
export const HOP_ART_LARGE_SIDES = [96, 128] as const;

const hopPicture = (direction: HopDirection): HTMLImageElement => {
  const name = hopArt(direction);
  const image = gameIcon(name, { size: 32, decorative: true, className: "yard-dock__picture friend-hop__art" });
  const url64 = gameIconUrl(name, 64);
  image.srcset = [
    image.srcset,
    ...HOP_ART_LARGE_SIDES.map((side) => `${url64.replace(/-64\.webp$/, `-${side}.webp`)} ${side}w`),
  ].join(", ");
  image.sizes = `${HOP_ART_PX}px`;
  return image;
};

export interface FriendHopOptions {
  /** Previous (-1) or Next (1); false when it did not go. */
  readonly onHop: (direction: HopDirection) => boolean;
}

export class FriendHopButtons {
  readonly element: HTMLElement;

  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly badge = make("span", "yard-dock__badge friend-hop__badge");
  private view: HopView | null = null;
  private busy = false;
  /** A disc was pressed and the yard is on its way: no second press. */
  private going = false;
  private stopFollowing: () => void = () => {};

  constructor(private readonly options: FriendHopOptions) {
    this.element = make("div", "friend-hop");
    this.element.setAttribute("role", "group");
    this.element.setAttribute("aria-label", FRIEND_HOP_TEXT.group);
    this.prev = this.disc(-1);
    this.next = this.disc(1);
    this.badge.hidden = true;
    this.next.querySelector(".yard-dock__disc")?.append(this.badge);
    this.element.append(this.prev, this.next);
    this.render();
  }

  /** Puts the discs beside Map in the overlay `layer`. */
  mount(layer: HTMLElement): this {
    layer.append(this.element);
    this.stopFollowing = followMapColumn(layer, this.element, "--friend-hop-right");
    return this;
  }

  /** Where each disc goes and Next's count; null hides both (the friends list not in yet). */
  setView(view: HopView | null): void {
    this.view = view;
    this.render();
  }

  /** Help all is running: both wait. */
  setBusy(busy: boolean): void {
    this.busy = busy;
    this.render();
  }

  destroy(): void {
    this.stopFollowing();
    this.element.remove();
  }

  private disc(direction: HopDirection): HTMLButtonElement {
    const name = direction === 1 ? "next" : "prev";
    const { element } = dockButton(
      `friend-${name}`,
      FRIEND_HOP_TEXT[name],
      hopPicture(direction),
      () => {
        if (this.going || this.busy || element.disabled) return;
        this.going = true;
        this.render();
        if (this.options.onHop(direction)) return;
        this.going = false;
        this.render();
      },
    );
    element.classList.add("friend-hop__button", `friend-hop__button--${name}`);
    return element;
  }

  private render(): void {
    const view = this.view;
    this.element.hidden = view === null;
    const still = this.busy || this.going;
    this.prev.disabled = still || !view?.prev;
    this.next.disabled = still || !view?.next;
    this.prev.title = view?.prev
      ? FRIEND_HOP_TEXT.prevTitle(view.prev.username)
      : FRIEND_HOP_TEXT.first;
    const ahead = view?.next ? view.ahead : 0;
    const nextTitle = view?.next
      ? FRIEND_HOP_TEXT.nextTitle(view.next.username)
      : FRIEND_HOP_TEXT.last;
    this.next.title = ahead > 0 ? `${nextTitle}. ${FRIEND_HOP_TEXT.ahead(ahead)}` : nextTitle;
    // The word under the disc names it; the label says where it goes.
    this.prev.setAttribute("aria-label", this.prev.title);
    this.next.setAttribute("aria-label", this.next.title);
    this.badge.textContent = ahead > BADGE_MAX ? `${BADGE_MAX}+` : String(ahead);
    this.badge.hidden = ahead === 0;
  }
}
