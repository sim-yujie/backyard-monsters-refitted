import { getSession } from "@/api/auth";
import type { FriendsApi } from "@/api/friends";
import { friendsStore as sharedStore, type FriendsStore } from "@/game/friends/friendsStore";
import { setFriendsOpener } from "@/game/friends/friendsView";
import type { FriendActions } from "./FriendsTab";
import { FriendsScreen, type FriendsTabId } from "./FriendsScreen";

/**
 * A screen's way into the Friends screen (issue #370): the screen, made and
 * docked the first time it opens, and the store kept fresh while the door
 * lives. It has no button of its own: the Account menu's "Friends" item opens
 * it, and so does anything else through the opener the door registers
 * (`friendsOpener`, for the bar and the Add-friend buttons).
 *
 * `onCount` hears the requests and gifts waiting, for the Account menu's count.
 */

export interface FriendsDoorOptions extends FriendActions {
  /** Where the screen docks: the scene's overlay content, looked up when it first opens. */
  readonly container: () => HTMLElement | null;
  /** Before the screen opens: the scene closes whatever else docks there. */
  readonly onOpen?: () => void;
  /** After it closes, when focus was inside it: the opener takes focus back. */
  readonly onClosedWithFocus?: () => void;
  /** The requests and gifts waiting, whenever the store changes. */
  readonly onCount?: (waiting: number) => void;
  /** The routes and the store, for a test. */
  readonly api?: FriendsApi;
  readonly store?: FriendsStore;
}

export class FriendsDoor {
  private readonly options: FriendsDoorOptions;
  private readonly store: FriendsStore;
  private screen: FriendsScreen | null = null;
  private readonly clearOpener: () => void;
  private readonly stopRefresh: () => void;
  private readonly unsubscribe: () => void;

  constructor(options: FriendsDoorOptions) {
    this.options = options;
    this.store = options.store ?? sharedStore;
    // A sign-out and in as someone else must not show the last player's friends.
    this.store.forUser(getSession()?.userId ?? null);
    this.clearOpener = setFriendsOpener((tab) => void this.open(tab));
    this.stopRefresh = this.store.start();
    this.unsubscribe = this.store.subscribe(() => options.onCount?.(this.store.waiting));
  }

  get isOpen(): boolean {
    return this.screen?.isOpen ?? false;
  }

  async open(tab?: FriendsTabId): Promise<void> {
    const screen = this.ensureScreen();
    if (!screen) return;
    this.options.onOpen?.();
    await screen.open(tab);
  }

  close(): void {
    this.screen?.close();
  }

  destroy(): void {
    this.clearOpener();
    this.stopRefresh();
    this.unsubscribe();
    this.screen?.destroy();
    this.screen = null;
  }

  private ensureScreen(): FriendsScreen | null {
    if (this.screen) return this.screen;
    const container = this.options.container();
    if (!container) return null;
    const { onVisit, onGift, api } = this.options;
    this.screen = new FriendsScreen({
      store: this.store,
      ...(api && { api }),
      ...(onVisit && { onVisit }),
      ...(onGift && { onGift }),
      onClose: (hadFocus) => {
        if (hadFocus) this.options.onClosedWithFocus?.();
      },
    }).mount(container);
    return this.screen;
  }
}
