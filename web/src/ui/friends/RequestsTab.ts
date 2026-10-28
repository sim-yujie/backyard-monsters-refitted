import { friendRefusal, type FriendRequest, type FriendsApi } from "@/api/friends";
import type { FriendsStore } from "@/game/friends/friendsStore";
import { sentText } from "@/game/mail/mailbox";
import { button, make, playerRow, section, StatusLine, type FriendsTabView } from "./rows";

/**
 * The Friends screen's **Requests** tab (`docs/design/friends.md` §3.1,
 * issue #370): **Waiting for you**, each with Accept and Decline, then
 * **Sent**, each with Cancel. A decline is silent: the request just leaves
 * the sender's Sent list. Fetched fresh each time the tab comes forward; an
 * answer takes the row off at once and tells the store, so the counts follow.
 */

export interface RequestsTabOptions {
  readonly api: FriendsApi;
  readonly store: FriendsStore;
  /** Unix seconds now, for "2 h ago". */
  readonly now?: () => number;
}

export const REQUESTS_TEXT = {
  incoming: "Waiting for you",
  outgoing: "Sent",
  noIncoming: "No one is waiting for an answer.",
  noOutgoing: "You have no requests waiting. Find players in the Find tab.",
  loading: "Loading requests…",
  loadFailed: "Your requests could not load. Try again.",
  accept: "Accept",
  decline: "Decline",
  cancel: "Cancel",
  accepted: (name: string): string => `Now friends with ${name}`,
  declined: (name: string): string => `Request from ${name} declined.`,
  cancelled: (name: string): string => `Request to ${name} cancelled.`,
  asked: (when: string): string => `Asked ${when}`,
} as const;

export class RequestsTab implements FriendsTabView {
  readonly element: HTMLElement;

  private readonly options: RequestsTabOptions;
  private readonly now: () => number;
  private readonly status = new StatusLine();
  private readonly body: HTMLElement;
  private incoming: FriendRequest[] = [];
  private outgoing: FriendRequest[] = [];
  private loaded = false;
  private readonly busy = new Set<number>();
  /** Bumped by every fetch, so a late answer is dropped. */
  private generation = 0;
  private destroyed = false;

  constructor(options: RequestsTabOptions) {
    this.options = options;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.element = make("div", "friends-tab friends-tab--requests");
    this.body = make("div", "friends-tab__body");
    this.element.append(this.status.element, this.body);
  }

  get statusText(): string {
    return this.status.text;
  }

  async show(): Promise<void> {
    const generation = ++this.generation;
    if (!this.loaded) this.status.set(REQUESTS_TEXT.loading);
    try {
      const { incoming, outgoing } = await this.options.api.requests();
      if (this.destroyed || generation !== this.generation) return;
      this.incoming = [...incoming];
      this.outgoing = [...outgoing];
      this.loaded = true;
      if (this.status.text === REQUESTS_TEXT.loading) this.status.set(null);
      this.options.store.setRequestsIn(this.incoming.length);
      this.render();
    } catch {
      if (this.destroyed || generation !== this.generation) return;
      this.status.set(REQUESTS_TEXT.loadFailed, "error");
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.generation++;
    this.element.remove();
  }

  private render(): void {
    if (!this.loaded) return;
    const now = this.now();
    const note = (request: FriendRequest): { note?: string } =>
      request.createdAt === null ? {} : { note: REQUESTS_TEXT.asked(sentText(request.createdAt, now)) };
    const incoming = this.incoming.map((request) => {
      const busy = this.busy.has(request.id);
      const accept = button(REQUESTS_TEXT.accept, () => void this.answer(request, true), "primary");
      const decline = button(REQUESTS_TEXT.decline, () => void this.answer(request, false), "ghost");
      accept.disabled = decline.disabled = busy;
      return playerRow(request, { ...note(request), actions: [accept, decline] });
    });
    const outgoing = this.outgoing.map((request) => {
      const cancel = button(REQUESTS_TEXT.cancel, () => void this.cancel(request), "ghost");
      cancel.disabled = this.busy.has(request.id);
      return playerRow(request, { ...note(request), actions: [cancel] });
    });
    this.body.replaceChildren(
      section(REQUESTS_TEXT.incoming, incoming, REQUESTS_TEXT.noIncoming),
      section(REQUESTS_TEXT.outgoing, outgoing, REQUESTS_TEXT.noOutgoing),
    );
  }

  private async answer(request: FriendRequest, accept: boolean): Promise<void> {
    await this.act(request, async () => {
      const friend = await this.options.api.answer(request.id, accept);
      this.incoming = this.incoming.filter((one) => one.id !== request.id);
      this.options.store.setRequestsIn(this.incoming.length);
      if (accept) {
        if (friend) this.options.store.addFriend(friend);
        // The list's own answer has their level, online and since.
        void this.options.store.refresh();
      }
      this.status.set(accept ? REQUESTS_TEXT.accepted(request.username) : REQUESTS_TEXT.declined(request.username));
    });
  }

  private async cancel(request: FriendRequest): Promise<void> {
    await this.act(request, async () => {
      await this.options.api.cancel(request.id);
      this.outgoing = this.outgoing.filter((one) => one.id !== request.id);
      this.status.set(REQUESTS_TEXT.cancelled(request.username));
    });
  }

  /** Runs one button's call with its row's buttons off; a refusal is said, and a gone request leaves. */
  private async act(request: FriendRequest, run: () => Promise<void>): Promise<void> {
    if (this.busy.has(request.id)) return;
    this.busy.add(request.id);
    this.render();
    try {
      await run();
    } catch (caught) {
      const refusal = friendRefusal(caught);
      this.status.set(refusal.message, "error");
      if (refusal.reason === "noSuchRequest") {
        // Answered, cancelled or lapsed meanwhile: it is not waiting any more.
        this.incoming = this.incoming.filter((one) => one.id !== request.id);
        this.outgoing = this.outgoing.filter((one) => one.id !== request.id);
        this.options.store.setRequestsIn(this.incoming.length);
      }
    } finally {
      this.busy.delete(request.id);
      if (!this.destroyed) this.render();
    }
  }
}
