import { FRIEND_MAX, friendsApi, type Friend, type FriendsApi, type FriendsList } from "@/api/friends";

/**
 * The player's friends, cached for the tab (`docs/design/friends.md` §8,
 * issue #370): the list, the friend ids (for the attack warning, WP10) and
 * the counts the badges show (requests waiting, gifts waiting).
 *
 * Refreshed when the Friends screen opens, when a `friend` notification
 * arrives ({@link FriendsStore.nudge}), and every few minutes while a screen
 * with the HUD runs ({@link FriendsStore.start}). Two refreshes at once share
 * one request. A failed refresh keeps what was there.
 *
 * One per tab (`friendsStore`), outside any scene, so the yard and the maps
 * read the same list; a test makes its own with a fake API.
 */

/** How often the list refreshes on its own while a screen with the HUD runs. */
export const REFRESH_MS = 3 * 60_000;

/** A nudge sooner than this after the last refresh is dropped: one notification can arrive twice. */
export const NUDGE_GAP_MS = 5_000;

export interface FriendsSnapshot {
  readonly friends: readonly Friend[];
  readonly max: number;
  readonly requestsIn: number;
  readonly giftsWaiting: number;
  readonly helpsLeft: number;
  /** False until the first refresh lands. */
  readonly loaded: boolean;
}

export interface FriendsStoreOptions {
  readonly api?: FriendsApi;
  /** Milliseconds now, for a test. */
  readonly now?: () => number;
  /** The timer, for a test. */
  readonly setInterval?: (run: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
}

const EMPTY: FriendsSnapshot = { friends: [], max: FRIEND_MAX, requestsIn: 0, giftsWaiting: 0, helpsLeft: 0, loaded: false };

export class FriendsStore {
  private readonly api: FriendsApi;
  private readonly now: () => number;
  private readonly setTimer: (run: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private state: FriendsSnapshot = EMPTY;
  private ids = new Set<number>();
  private readonly listeners = new Set<(snapshot: FriendsSnapshot) => void>();
  private inFlight: Promise<void> | null = null;
  private lastRefresh = -Infinity;
  /** How many screens asked for the timer; it runs while any does. */
  private starts = 0;
  private timer: unknown = null;
  /** Whose list this is (`forUser`); null before anyone said. */
  private owner: number | null = null;

  constructor(options: FriendsStoreOptions = {}) {
    this.api = options.api ?? friendsApi;
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setInterval ?? ((run, ms) => window.setInterval(run, ms));
    this.clearTimer = options.clearInterval ?? ((handle) => window.clearInterval(handle as number));
  }

  get snapshot(): FriendsSnapshot {
    return this.state;
  }

  get friends(): readonly Friend[] {
    return this.state.friends;
  }

  /** Requests and gifts waiting for the player: the Account menu's count. */
  get waiting(): number {
    return this.state.requestsIn + this.state.giftsWaiting;
  }

  /** Whether a player is on the list as last fetched. */
  isFriend(userid: number): boolean {
    return this.ids.has(userid);
  }

  /** Hears every change, and is told the current state at once. Returns the unsubscribe. */
  subscribe(listener: (snapshot: FriendsSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Fetches the list; a refresh already on its way is shared. */
  refresh(): Promise<void> {
    this.inFlight ??= this.fetch().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** Something friendly happened (a `friend` notification): refreshes unless it just did. */
  nudge(): void {
    if (this.inFlight || this.now() - this.lastRefresh < NUDGE_GAP_MS) return;
    void this.refresh();
  }

  /**
   * Keeps the list fresh every {@link REFRESH_MS} and fetches it now, until
   * the returned stop runs. Several screens may ask; it runs while any does.
   */
  start(): () => void {
    this.starts++;
    if (this.starts === 1) {
      this.timer = this.setTimer(() => void this.refresh(), REFRESH_MS);
      void this.refresh();
    }
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      this.starts--;
      if (this.starts === 0 && this.timer !== null) {
        this.clearTimer(this.timer);
        this.timer = null;
      }
    };
  }

  /** Takes a friend off at once, ahead of the next refresh (the player pressed Remove). */
  removeFriend(userid: number): void {
    if (!this.ids.has(userid)) return;
    this.set({ ...this.state, friends: this.state.friends.filter((friend) => friend.userid !== userid) });
  }

  /** Puts a friend on at once (the player accepted a request), ahead of the next refresh. */
  addFriend(friend: Friend): void {
    const friends = this.state.friends.filter((one) => one.userid !== friend.userid);
    this.set({ ...this.state, friends: [...friends, friend] });
  }

  /** Sets the waiting-requests count, as the Requests tab last saw it. */
  setRequestsIn(requestsIn: number): void {
    const next = Math.max(0, Math.floor(requestsIn));
    if (next !== this.state.requestsIn) this.set({ ...this.state, requestsIn: next });
  }

  /** Forgets everything. */
  reset(): void {
    this.lastRefresh = -Infinity;
    this.set(EMPTY);
  }

  /** Says who is signed in; another player than last time forgets the last one's list. */
  forUser(userid: number | null): void {
    if (userid === this.owner) return;
    this.owner = userid;
    this.reset();
  }

  private async fetch(): Promise<void> {
    let answer: FriendsList;
    try {
      answer = await this.api.list();
    } catch {
      // Kept as it was; the next refresh tries again.
      return;
    }
    this.lastRefresh = this.now();
    this.set({ ...answer, loaded: true });
  }

  private set(next: FriendsSnapshot): void {
    this.state = next;
    this.ids = new Set(next.friends.map((friend) => friend.userid));
    for (const listener of [...this.listeners]) listener(next);
  }
}

/** The tab's one store. */
export const friendsStore = new FriendsStore();
