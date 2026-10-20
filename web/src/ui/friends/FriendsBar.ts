import type { Friend } from "@/api/friends";
import { avatarOf, avatarUrl } from "@/game/avatars";
import { canHelp } from "@/game/friends/friendText";
import { friendsStore as sharedStore, type FriendsStore } from "@/game/friends/friendsStore";
import { friendsOpener } from "@/game/friends/friendsView";
import { openGiftPicker } from "./GiftPicker";
import { make } from "./rows";
import "./friends-bar.css";

/**
 * The friends bar (issue #371, `docs/design/friends.md` §3.2): a strip of
 * friend portraits along the bottom of the player's own yard. A "+" first
 * slot opens the Friends screen, arrows page through the rest, and a portrait
 * opens a small card: Visit, Send gift, Friends list. On a phone the strip
 * hides behind a Friends round button and slides up when pressed.
 *
 * It reads the shared friends store (kept fresh by the Friends door) and only
 * reports what was picked.
 */

/** Portraits shown at once until the strip's width is known. */
const DEFAULT_PAGE_SIZE = 5;

/** A portrait slot's width including its gap, in px (`friends-bar.css`). */
const SLOT_PX = 68;
/** The strip has a gap between slots but none after the last, so n slots are n * SLOT_PX - this wide. */
const SLOT_GAP_PX = 4;
/** An arrow button plus the gap beside it. */
const ARROW_PX = 32;

export { canHelp };

const onlineRank = (friend: Friend): number => (friend.online === "online" ? 1 : 0);

/** Wrench first, then online, then highest level, then name. Does not change the list given. */
export const orderFriends = (friends: readonly Friend[]): Friend[] =>
  [...friends].sort(
    (a, b) =>
      Number(canHelp(b)) - Number(canHelp(a)) ||
      onlineRank(b) - onlineRank(a) ||
      b.level - a.level ||
      a.username.localeCompare(b.username),
  );

/** One page of a list; the page asked for is kept inside the range. */
export const pageOf = <T>(items: readonly T[], page: number, size: number): { items: T[]; page: number; pages: number } => {
  const per = Math.max(1, size);
  const pages = Math.max(1, Math.ceil(items.length / per));
  const at = Math.min(Math.max(0, page), pages - 1);
  return { items: items.slice(at * per, at * per + per), page: at, pages };
};

type FriendsTabName = "friends" | "gifts";

const GIFT_SENT = "Gift sent today";

export interface FriendsBarOptions {
  /** Takes the player to this friend's yard. Without it the card has no Visit. */
  readonly onVisit?: (friend: Friend) => void;
  /** The store, for a test. */
  readonly store?: FriendsStore;
  /** Opens the Friends screen; the shared opener by default. */
  readonly openFriends?: (tab?: FriendsTabName) => void;
  /** Sends this friend a gift; the gift picker (#375) by default. */
  readonly onGift?: (friend: Friend) => void;
}

export class FriendsBar {
  readonly element: HTMLElement;

  private readonly options: FriendsBarOptions;
  private readonly store: FriendsStore;
  private readonly strip = make("div", "friends-bar__strip");
  private readonly toggle = make("button", "friends-bar__toggle", "Friends");
  private readonly prev = make("button", "friends-bar__arrow", "‹");
  private readonly next = make("button", "friends-bar__arrow", "›");
  private card: HTMLElement | null = null;
  private page = 0;
  private pageSize = DEFAULT_PAGE_SIZE;
  private readonly unsubscribe: () => void;
  private resize: ResizeObserver | null = null;

  constructor(options: FriendsBarOptions = {}) {
    this.options = options;
    this.store = options.store ?? sharedStore;
    this.element = make("div", "friends-bar");
    this.element.setAttribute("role", "region");
    this.element.setAttribute("aria-label", "Friends");
    this.toggle.type = "button";
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.addEventListener("click", () => this.setOpen(!this.element.classList.contains("is-open")));
    const arrows = [
      [this.prev, "Previous friends", -1],
      [this.next, "More friends", 1],
    ] as const;
    for (const [arrow, label, step] of arrows) {
      arrow.type = "button";
      arrow.setAttribute("aria-label", label);
      arrow.addEventListener("click", () => {
        this.page += step;
        this.render();
      });
    }
    this.element.append(this.toggle, this.prev, this.strip, this.next);
    if (typeof ResizeObserver !== "undefined") {
      this.resize = new ResizeObserver(() => this.fit());
      this.resize.observe(this.strip);
    }
    window.addEventListener("resize", this.onWindowResize);
    this.unsubscribe = this.store.subscribe(() => (this.element.isConnected ? this.fit() : this.render()));
    this.render();
  }

  mount(parent: HTMLElement): this {
    parent.append(this.element);
    this.fit();
    return this;
  }

  destroy(): void {
    this.unsubscribe();
    this.resize?.disconnect();
    window.removeEventListener("resize", this.onWindowResize);
    this.element.remove();
  }

  /** On a phone, the Friends button slides the strip up or away. */
  setOpen(open: boolean): void {
    this.element.classList.toggle("is-open", open);
    this.toggle.setAttribute("aria-expanded", String(open));
  }

  private readonly onWindowResize = (): void => this.fit();

  /**
   * The strip is sized by its contents, so its current width says nothing about the room there is.
   * Show everyone, let the bar's max width squeeze the strip, and read how much room was left.
   */
  private fit(): void {
    if (!this.element.isConnected) return;
    const total = this.store.friends.length;
    const before = this.pageSize;
    // Showing everyone resets the page, and a short last page shrinks the strip and lands here again,
    // so keep the first friend shown on the page it falls on.
    const first = this.page * before;
    this.pageSize = Math.max(1, total);
    this.render();
    if (this.strip.clientWidth <= 0) {
      this.pageSize = before;
      this.page = Math.floor(first / before);
      this.render();
      return;
    }
    const room = Math.min(this.strip.clientWidth, this.roomBetweenEdges());
    // One slot is the "+"; the arrows take room too once there is more than one page.
    const fits = (width: number): number => Math.max(1, Math.floor((width + SLOT_GAP_PX) / SLOT_PX) - 1);
    this.pageSize = fits(room) >= total ? Math.max(1, total) : fits(room - 2 * ARROW_PX);
    this.page = Math.floor(first / this.pageSize);
    this.render();
  }

  /**
   * The strip's room from the bar's `left` and `right` edges in its parent, less the bar's own padding
   * and border. Should the CSS ever stop squeezing the strip, the bar still pages instead of running
   * under the dock's buttons. Unlimited when the edges are not set.
   */
  private roomBetweenEdges(): number {
    const style = getComputedStyle(this.element);
    const left = parseFloat(style.left);
    const right = parseFloat(style.right);
    const parentWidth = this.element.parentElement?.clientWidth ?? 0;
    if (!Number.isFinite(left) || !Number.isFinite(right) || parentWidth <= 0) return Infinity;
    const chrome = this.element.offsetWidth - this.strip.clientWidth;
    return parentWidth - left - right - Math.max(0, chrome);
  }

  private openFriends(tab: FriendsTabName): void {
    this.closeCard();
    (this.options.openFriends ?? friendsOpener())?.(tab);
  }

  private closeCard(): void {
    this.card?.remove();
    this.card = null;
  }

  private render(): void {
    const ordered = orderFriends(this.store.friends);
    const view = pageOf(ordered, this.page, this.pageSize);
    this.page = view.page;
    this.closeCard();
    this.strip.replaceChildren(this.plusSlot(ordered.length === 0), ...view.items.map((f) => this.portrait(f)));
    // A full page wide while paging, so a short last page does not move the arrows.
    this.strip.style.width = view.pages > 1 ? `${(this.pageSize + 1) * SLOT_PX - SLOT_GAP_PX}px` : "";
    this.prev.hidden = view.pages <= 1;
    this.next.hidden = view.pages <= 1;
    this.prev.disabled = view.page === 0;
    this.next.disabled = view.page >= view.pages - 1;
  }

  private plusSlot(empty: boolean): HTMLElement {
    const slot = make("button", "friends-bar__slot friends-bar__slot--add");
    slot.type = "button";
    slot.append(make("span", "friends-bar__plus", "+"), make("span", "friends-bar__name", empty ? "Add friends" : "Add"));
    slot.addEventListener("click", () => this.openFriends("friends"));
    return slot;
  }

  private portrait(friend: Friend): HTMLElement {
    const slot = make("button", "friends-bar__slot");
    slot.type = "button";
    slot.dataset.userid = String(friend.userid);
    const face = make("span", "friends-bar__face");
    const img = make("img", "friends-bar__img");
    img.src = avatarUrl(avatarOf(friend.pic, friend.userid), "small");
    img.alt = "";
    face.append(img);
    if (friend.online === "online") face.append(make("span", "friends-bar__dot"));
    if (canHelp(friend)) face.append(badge("wrench", "Can help today"));
    if (!friend.giftSentToday) face.append(badge("gift", "No gift sent today"));
    slot.append(face, make("span", "friends-bar__name", friend.username), make("span", "friends-bar__level", `Lv ${friend.level}`));
    slot.addEventListener("click", () => this.showCard(friend));
    return slot;
  }

  private showCard(friend: Friend): void {
    const again = this.card?.dataset.userid === String(friend.userid);
    this.closeCard();
    if (again) return;
    const card = make("div", "friends-bar__card");
    card.dataset.userid = String(friend.userid);
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", friend.username);
    card.append(make("div", "friends-bar__card-title", `${friend.username}, level ${friend.level}`));
    const add = (label: string, run: () => void, disabled = false): void => {
      const b = make("button", "friends-bar__card-button", label);
      b.type = "button";
      b.disabled = disabled;
      b.addEventListener("click", run);
      card.append(b);
    };
    const { onVisit } = this.options;
    if (onVisit) {
      add("Visit", () => {
        this.closeCard();
        onVisit(friend);
      });
    }
    add(
      friend.giftSentToday ? GIFT_SENT : "Send gift",
      () => {
        this.closeCard();
        if (this.options.onGift) this.options.onGift(friend);
        else openGiftPicker(friend, this.element.parentElement, { store: this.store });
      },
      friend.giftSentToday,
    );
    add("Friends list", () => this.openFriends("friends"));
    this.card = card;
    this.element.append(card);
  }
}

const badge = (kind: "wrench" | "gift", title: string): HTMLElement => {
  const b = make("span", `friends-bar__badge friends-bar__badge--${kind}`, kind === "wrench" ? "🔧" : "🎁");
  b.title = title;
  b.setAttribute("aria-label", title);
  return b;
};
