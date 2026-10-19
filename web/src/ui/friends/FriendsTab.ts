import { friendRefusal, type Friend, type FriendsApi } from "@/api/friends";
import { friendCountText, onlineText } from "@/game/friends/friendText";
import type { FriendsSnapshot, FriendsStore } from "@/game/friends/friendsStore";
import { button, make, playerRow, section, StatusLine, type FriendsTabView } from "./rows";

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
 */

export interface FriendActions {
  /** Visit their yard (WP5). */
  readonly onVisit?: (friend: Friend) => void;
  /** Send them a gift (WP8). */
  readonly onGift?: (friend: Friend) => void;
  /** Block them (WP9). */
  readonly onBlock?: (friend: Friend) => void;
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
  gift: "Send gift",
  giftSent: "Gift sent today",
  block: "Block",
} as const;

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
  private readonly status = new StatusLine();
  private readonly body: HTMLElement;
  private readonly unsubscribe: () => void;
  /** The friend whose Remove is waiting for "Yes, remove". */
  private confirming: number | null = null;
  private busy = new Set<number>();
  private snapshot: FriendsSnapshot | null = null;

  constructor(options: FriendsTabOptions) {
    this.options = options;
    this.element = make("div", "friends-tab friends-tab--friends");
    this.summary = make("p", "friends-summary");
    this.body = make("div", "friends-tab__body");
    this.element.append(this.summary, this.status.element, this.body);
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
      this.body.replaceChildren();
      return;
    }
    this.summary.textContent = friendCountText(snapshot.friends.length, snapshot.max);
    if (snapshot.friends.length === 0) {
      const empty = make("div", "friends-empty");
      empty.append(
        make("p", "friends-empty__text", FRIENDS_TEXT.empty),
        button(FRIENDS_TEXT.find, () => this.options.onFind(), "primary"),
      );
      this.body.replaceChildren(empty);
      return;
    }
    const rows = [...snapshot.friends].sort(friendOrder).map((friend) => this.row(friend));
    this.body.replaceChildren(section("Your friends", rows, FRIENDS_TEXT.empty));
  }

  private row(friend: Friend): HTMLLIElement {
    const online = onlineText(friend.online);
    const busy = this.busy.has(friend.userid);
    if (this.confirming === friend.userid) {
      const yes = button(FRIENDS_TEXT.removeYes, () => void this.remove(friend), "danger");
      const no = button(FRIENDS_TEXT.cancel, () => {
        this.confirming = null;
        this.render();
      });
      yes.disabled = busy;
      const row = playerRow(friend, { note: FRIENDS_TEXT.removeConfirm(friend.username), actions: [yes, no] });
      row.classList.add("friends-row--confirm");
      return row;
    }
    const actions: HTMLElement[] = [];
    const { onVisit, onGift, onBlock } = this.options;
    if (onVisit) actions.push(button(FRIENDS_TEXT.visit, () => onVisit(friend), "primary"));
    if (onGift) {
      const gift = button(friend.giftSentToday ? FRIENDS_TEXT.giftSent : FRIENDS_TEXT.gift, () => onGift(friend));
      gift.disabled = friend.giftSentToday;
      actions.push(gift);
    }
    const remove = button(FRIENDS_TEXT.remove, () => {
      this.confirming = friend.userid;
      this.render();
    }, "ghost");
    remove.disabled = busy;
    actions.push(remove);
    if (onBlock) actions.push(button(FRIENDS_TEXT.block, () => onBlock(friend), "ghost"));
    return playerRow(friend, {
      ...(online && { note: online, noteClass: `friends-online friends-online--${friend.online}` }),
      actions,
    });
  }

  private async remove(friend: Friend): Promise<void> {
    if (this.busy.has(friend.userid)) return;
    this.busy.add(friend.userid);
    this.render();
    try {
      await this.options.api.remove(friend.userid);
      this.confirming = null;
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
