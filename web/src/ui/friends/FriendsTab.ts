import { friendRefusal, type Friend, type FriendsApi } from "@/api/friends";
import { canHelp, friendCountText, onlineText } from "@/game/friends/friendText";
import type { FriendsSnapshot, FriendsStore } from "@/game/friends/friendsStore";
import { blockButton } from "./BlockButton";
import { button, make, playerRow, section, StatusLine, type FriendsTabView, type RowBadge } from "./rows";

/**
 * The Friends screen's **Friends** tab (`docs/design/friends.md` §3, issue
 * #370): "12 of 100 friends", then a row per friend with their critter,
 * name, level and how recently they were about, online first, then highest
 * level. Each row has Remove (asked twice, it is silent and at once for
 * both); Visit, Send gift and Block show when a later package hands their
 * action in (WP5, WP8, WP9).
 *
 * The rows come from the store, which this tab refreshes when it comes
 * forward; a removal takes the row off at once.
 *
 * Issue #380, for long lists: a search box (part of a name) and three filter
 * buttons (Can help, Online, Gift not sent; pressed ones must all hold) above
 * the list; the bar's wrench and gift marks on each critter; and one-line
 * rows, with Remove and Block folded behind a "More" button.
 */

export interface FriendActions {
  /** Visit their yard (WP5). */
  readonly onVisit?: (friend: Friend) => void;
  /** Send them a gift (WP8). */
  readonly onGift?: (friend: Friend) => void;
  /** Block them (WP9). */
}

export interface FriendsTabOptions extends FriendActions {
  readonly api: FriendsApi;
  readonly store: FriendsStore;
  /** The empty list's "Find players" button: brings the Find tab forward. */
  readonly onFind: () => void;
}

export const FRIENDS_TEXT = {
  empty: "No friends yet. Find players to add in the Find tab.",
  find: "Find players",
  loading: "Loading your friends…",
  loadFailed: "Your friends could not load. Try again.",
  remove: "Remove",
  removeConfirm: (name: string): string => `Remove ${name} from your friends?`,
  removeYes: "Yes, remove",
  cancel: "Keep",
  removed: (name: string): string => `${name} is no longer your friend.`,
  visit: "Visit",
  gift: "Gift",
  giftSent: "Sent",
  giftTitle: "Send gift",
  giftSentTitle: "Gift sent today",
  block: "Block",
  more: "More",
  search: "Search friends",
  noMatch: "No friends match.",
  clear: "Clear",
  matching: (shown: number): string => `${shown} shown`,
} as const;

export type FriendFilter = "help" | "online" | "gift";

/** The filter buttons, in order. */
export const FRIEND_FILTERS: readonly { readonly id: FriendFilter; readonly label: string }[] = [
  { id: "help", label: "Can help" },
  { id: "online", label: "Online" },
  { id: "gift", label: "Gift not sent" },
];

const FILTER_TEST: Readonly<Record<FriendFilter, (friend: Friend) => boolean>> = {
  help: canHelp,
  online: (friend) => friend.online === "online",
  gift: (friend) => !friend.giftSentToday,
};

/** Whether a friend matches the search (any part of the name, any case) and every pressed filter. */
export const friendMatches = (friend: Friend, query: string, filters: ReadonlySet<FriendFilter>): boolean => {
  const wanted = query.trim().toLowerCase();
  if (wanted && !friend.username.toLowerCase().includes(wanted)) return false;
  for (const filter of filters) if (!FILTER_TEST[filter](friend)) return false;
  return true;
};

const ONLINE_ORDER: Readonly<Record<string, number>> = { online: 0, today: 1, week: 2, away: 3 };

/** Online first (then seen today, this week, away, hidden), then highest level, then by name. */
export const friendOrder = (one: Friend, other: Friend): number =>
  (ONLINE_ORDER[one.online ?? ""] ?? 4) - (ONLINE_ORDER[other.online ?? ""] ?? 4) ||
  other.level - one.level ||
  one.username.localeCompare(other.username);

export class FriendsTab implements FriendsTabView {
  readonly element: HTMLElement;

  private readonly options: FriendsTabOptions;
  private readonly summary: HTMLElement;
  private readonly tools: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly filterButtons = new Map<FriendFilter, HTMLButtonElement>();
  private readonly status = new StatusLine();
  private readonly body: HTMLElement;
  private readonly unsubscribe: () => void;
  /** The friend whose Remove is waiting for "Yes, remove". */
  private confirming: number | null = null;
  /** The friend whose More is open, showing Remove and Block. */
  private opened: number | null = null;
  private query = "";
  private readonly filters = new Set<FriendFilter>();
  private busy = new Set<number>();
  private snapshot: FriendsSnapshot | null = null;

  constructor(options: FriendsTabOptions) {
    this.options = options;
    this.element = make("div", "friends-tab friends-tab--friends");
    this.summary = make("p", "friends-summary");
    this.body = make("div", "friends-tab__body");
    this.tools = make("div", "friends-tools");
    const searchBox = make("div", "friends-tools__search");
    searchBox.setAttribute("role", "search");
    const label = make("label", "u-visually-hidden", FRIENDS_TEXT.search);
    label.htmlFor = "friends-list-search";
    this.search = make("input", "field__input friends-tools__input");
    this.search.id = "friends-list-search";
    this.search.type = "search";
    this.search.placeholder = FRIENDS_TEXT.search;
    this.search.autocomplete = "off";
    this.search.spellcheck = false;
    this.search.maxLength = 40;
    this.search.addEventListener("input", () => {
      this.query = this.search.value;
      this.opened = null;
      this.render();
    });
    searchBox.append(label, this.search);
    const filterRow = make("div", "friends-tools__filters");
    for (const { id, label: words } of FRIEND_FILTERS) {
      const chip = make("button", "friends-filter", words);
      chip.type = "button";
      chip.dataset["filter"] = id;
      chip.setAttribute("aria-pressed", "false");
      chip.addEventListener("click", () => {
        if (this.filters.has(id)) this.filters.delete(id);
        else this.filters.add(id);
        this.opened = null;
        this.render();
      });
      this.filterButtons.set(id, chip);
      filterRow.append(chip);
    }
    this.tools.append(searchBox, filterRow);
    this.tools.hidden = true;
    this.element.append(this.summary, this.tools, this.status.element, this.body);
    this.unsubscribe = options.store.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.render();
    });
  }

  /** The status line's words, for a test. */
  get statusText(): string {
    return this.status.text;
  }

  async show(): Promise<void> {
    this.confirming = null;
    this.opened = null;
    if (!this.snapshot?.loaded) this.status.set(FRIENDS_TEXT.loading);
    await this.options.store.refresh();
    if (!this.options.store.snapshot.loaded) this.status.set(FRIENDS_TEXT.loadFailed, "error");
    else if (this.status.text === FRIENDS_TEXT.loading) this.status.set(null);
  }

  destroy(): void {
    this.unsubscribe();
    this.element.remove();
  }

  private render(): void {
    const snapshot = this.snapshot;
    if (!snapshot?.loaded) {
      this.summary.textContent = "";
      this.tools.hidden = true;
      this.body.replaceChildren();
      return;
    }
    this.summary.textContent = friendCountText(snapshot.friends.length, snapshot.max);
    this.tools.hidden = snapshot.friends.length === 0;
    if (snapshot.friends.length === 0) {
      const empty = make("div", "friends-empty");
      empty.append(
        make("p", "friends-empty__text", FRIENDS_TEXT.empty),
        button(FRIENDS_TEXT.find, () => this.options.onFind(), "primary"),
      );
      this.body.replaceChildren(empty);
      return;
    }
    for (const { id, label } of FRIEND_FILTERS) {
      const chip = this.filterButtons.get(id);
      if (!chip) continue;
      chip.textContent = `${label} (${snapshot.friends.filter(FILTER_TEST[id]).length})`;
      chip.setAttribute("aria-pressed", String(this.filters.has(id)));
    }
    const shown = snapshot.friends.filter((friend) => friendMatches(friend, this.query, this.filters)).sort(friendOrder);
    const narrowed = this.query.trim() !== "" || this.filters.size > 0;
    if (narrowed && shown.length === 0) {
      const none = make("div", "friends-empty");
      none.append(make("p", "friends-empty__text", FRIENDS_TEXT.noMatch), button(FRIENDS_TEXT.clear, () => this.clearSearch()));
      this.body.replaceChildren(none);
      return;
    }
    const title = narrowed ? FRIENDS_TEXT.matching(shown.length) : "Your friends";
    this.body.replaceChildren(section(title, shown.map((friend) => this.row(friend)), FRIENDS_TEXT.empty));
  }

  private clearSearch(): void {
    this.query = "";
    this.search.value = "";
    this.filters.clear();
    this.render();
  }

  private row(friend: Friend): HTMLLIElement {
    const online = onlineText(friend.online);
    const busy = this.busy.has(friend.userid);
    if (this.confirming === friend.userid) {
      const yes = button(FRIENDS_TEXT.removeYes, () => void this.remove(friend), "danger");
      const no = button(FRIENDS_TEXT.cancel, () => {
        this.confirming = null;
        this.opened = null;
        this.render();
      });
      yes.disabled = busy;
      const row = playerRow(friend, { note: FRIENDS_TEXT.removeConfirm(friend.username), actions: [yes, no] });
      row.classList.add("friends-row--confirm");
      return row;
    }
    const actions: HTMLElement[] = [];
    const { onVisit, onGift } = this.options;
    if (onVisit) actions.push(button(FRIENDS_TEXT.visit, () => onVisit(friend), "primary"));
    if (onGift) {
      const gift = button(friend.giftSentToday ? FRIENDS_TEXT.giftSent : FRIENDS_TEXT.gift, () => onGift(friend));
      gift.disabled = friend.giftSentToday;
      gift.title = friend.giftSentToday ? FRIENDS_TEXT.giftSentTitle : FRIENDS_TEXT.giftTitle;
      actions.push(gift);
    }
    const remove = button(FRIENDS_TEXT.remove, () => {
      this.confirming = friend.userid;
      this.render();
    }, "ghost");
    remove.disabled = busy;
    const opened = this.opened === friend.userid;
    const more = button("⋯", () => {
      this.opened = opened ? null : friend.userid;
      this.render();
    }, "ghost");
    more.classList.add("friends-row__more");
    more.title = FRIENDS_TEXT.more;
    more.setAttribute("aria-label", FRIENDS_TEXT.more);
    more.setAttribute("aria-expanded", String(opened));
    actions.push(more);
    if (opened) {
      actions.push(
        remove,
        blockButton({
          userid: friend.userid,
          username: friend.username,
          block: (userid) => this.options.api.block(userid),
          onBlocked: () => void this.options.store.refresh(),
          onError: (message) => this.status.set(message, "error"),
        }),
      );
    }
    const badges: RowBadge[] = [];
    if (canHelp(friend)) badges.push("wrench");
    if (!friend.giftSentToday) badges.push("gift");
    const row = playerRow(friend, {
      ...(online && { note: online, noteClass: `friends-online friends-online--${friend.online}` }),
      actions,
      badges,
    });
    row.classList.toggle("friends-row--open", opened);
    return row;
  }

  private async remove(friend: Friend): Promise<void> {
    if (this.busy.has(friend.userid)) return;
    this.busy.add(friend.userid);
    this.render();
    try {
      await this.options.api.remove(friend.userid);
      this.confirming = null;
      this.opened = null;
      this.status.set(FRIENDS_TEXT.removed(friend.username));
      this.options.store.removeFriend(friend.userid);
    } catch (caught) {
      this.status.set(friendRefusal(caught).message, "error");
    } finally {
      this.busy.delete(friend.userid);
      this.render();
    }
  }
}
