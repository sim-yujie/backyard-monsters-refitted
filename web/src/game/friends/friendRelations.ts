import { friendsApi, type Friend, type FriendsApi, type Relation } from "@/api/friends";
import { friendsStore, type FriendsStore } from "./friendsStore";

/**
 * How another player stands to the player, for the Add-friend buttons outside
 * the Friends screen (`docs/design/friends.md` §3.1, issue #378): the map
 * popups and the mailbox. Friends come from the {@link FriendsStore}; the
 * requests waiting either way are fetched here, on a button's first showing,
 * and kept a short while so a map full of popups asks once.
 *
 * A press updates it at once, so a popup opened again agrees with the last.
 */

/** How long the fetched requests stand before a button fetches them again. */
export const RELATIONS_TTL_MS = 15_000;

export interface FriendRelationsOptions {
  readonly api?: FriendsApi;
  readonly store?: FriendsStore;
  /** Milliseconds now, for a test. */
  readonly now?: () => number;
}

export class FriendRelations {
  private readonly api: FriendsApi;
  private readonly store: FriendsStore;
  private readonly now: () => number;
  /** Players the player asked, still waiting. */
  private outgoing = new Set<number>();
  /** Players who asked the player, still waiting. */
  private incoming = new Set<number>();
  private fetchedAt = -Infinity;
  private inFlight: Promise<void> | null = null;

  constructor(options: FriendRelationsOptions = {}) {
    this.api = options.api ?? friendsApi;
    this.store = options.store ?? friendsStore;
    this.now = options.now ?? (() => Date.now());
    // The store forgets on sign-out or another player; so does this.
    this.store.subscribe((snapshot) => {
      if (!snapshot.loaded) this.clear();
    });
  }

  /** What is known now, without asking; `friend` is a hint the caller has (a map cell's flag). */
  relationOf(userid: number, friend = false): Relation {
    if (friend || this.store.isFriend(userid)) return "friend";
    if (this.outgoing.has(userid)) return "requested";
    if (this.incoming.has(userid)) return "asked";
    return "none";
  }

  /** Fetches the waiting requests unless that was done lately; a failure keeps what was known. */
  load(): Promise<void> {
    if (this.now() - this.fetchedAt < RELATIONS_TTL_MS) return Promise.resolve();
    this.inFlight ??= this.fetch().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** The player just asked them. */
  noteRequested(userid: number): void {
    this.outgoing.add(userid);
  }

  /** They are friends now (asking back accepted theirs); the store hears it too. */
  noteFriend(userid: number, friend: Friend | null): void {
    this.outgoing.delete(userid);
    this.incoming.delete(userid);
    if (friend) this.store.addFriend(friend);
    void this.store.refresh();
  }

  /** Forgets the requests; the next button asks again. */
  clear(): void {
    this.outgoing = new Set();
    this.incoming = new Set();
    this.fetchedAt = -Infinity;
  }

  private async fetch(): Promise<void> {
    try {
      const { incoming, outgoing } = await this.api.requests();
      const waiting = (list: typeof incoming): Set<number> =>
        new Set(list.filter((one) => one.status === "pending").map((one) => one.userid));
      this.incoming = waiting(incoming);
      this.outgoing = waiting(outgoing);
      this.fetchedAt = this.now();
    } catch {
      // Kept as it was; the next button tries again.
    }
  }
}

/** The tab's one, beside {@link friendsStore}. */
export const friendRelations = new FriendRelations();
