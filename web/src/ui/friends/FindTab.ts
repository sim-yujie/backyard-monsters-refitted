import { friendRefusal, SEARCH_MIN_LENGTH, type FriendsApi, type PlayerResult, type Relation } from "@/api/friends";
import type { FriendsStore } from "@/game/friends/friendsStore";
import { button, make, playerRow, section, StatusLine, type FriendsTabView } from "./rows";

/**
 * The Friends screen's **Find** tab (`docs/design/friends.md` §3.1, issue
 * #370): a username search (3 letters or more, exact name first, up to 10),
 * and under an empty search the player's alliance mates who are not friends
 * yet (§10 Q8). Each player shows how they stand to the player: **Add
 * friend**, **Accept** when they asked first (asking back accepts theirs),
 * or a plain "Request sent", "Friends", "That's you".
 *
 * Typing searches after a short pause; Enter or Search does it at once. A
 * late answer for an older search is dropped.
 */

export interface FindTabOptions {
  readonly api: FriendsApi;
  readonly store: FriendsStore;
  /** The pause after typing before a search goes, for a test. */
  readonly debounceMs?: number;
}

export const FIND_TEXT = {
  label: "Find a player",
  placeholder: "Username",
  search: "Search",
  hint: `Type at least ${SEARCH_MIN_LENGTH} letters of a username.`,
  searching: "Searching…",
  noResults: "No players with that name.",
  results: "Players",
  suggestions: "From your alliance",
  noSuggestions: "Everyone in your alliance is already your friend, or you are not in one.",
  searchFailed: "The search did not work. Try again.",
  add: "Add friend",
  accept: "Accept",
  requested: "Request sent",
  friend: "Friends",
  self: "That's you",
  sent: (name: string): string => `Friend request sent to ${name}.`,
  accepted: (name: string): string => `${name} is now your friend.`,
} as const;

const DEBOUNCE_MS = 400;

export class FindTab implements FriendsTabView {
  readonly element: HTMLElement;

  private readonly options: FindTabOptions;
  private readonly input: HTMLInputElement;
  private readonly status = new StatusLine();
  private readonly body: HTMLElement;
  private results: PlayerResult[] | null = null;
  private suggestions: PlayerResult[] | null = null;
  private query = "";
  private readonly busy = new Set<number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private destroyed = false;

  constructor(options: FindTabOptions) {
    this.options = options;
    this.element = make("div", "friends-tab friends-tab--find");

    const form = make("form", "friends-find");
    form.setAttribute("role", "search");
    const label = make("label", "u-visually-hidden", FIND_TEXT.label);
    label.htmlFor = "friends-find-input";
    this.input = make("input", "field__input friends-find__input");
    this.input.id = "friends-find-input";
    this.input.type = "search";
    this.input.placeholder = FIND_TEXT.placeholder;
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    this.input.maxLength = 40;
    this.input.addEventListener("input", () => this.typed());
    const submit = make("button", "btn btn--primary friends-find__submit", FIND_TEXT.search);
    submit.type = "submit";
    form.append(label, this.input, submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.search();
    });

    this.body = make("div", "friends-tab__body");
    this.element.append(form, this.status.element, this.body);
  }

  get statusText(): string {
    return this.status.text;
  }

  /** The search box, for the screen to focus and a test to type into. */
  get searchInput(): HTMLInputElement {
    return this.input;
  }

  async show(): Promise<void> {
    this.render();
    // The suggestions are fetched fresh each time; a failure just leaves them out.
    try {
      const suggestions = await this.options.api.suggestions();
      if (this.destroyed) return;
      this.suggestions = suggestions;
    } catch {
      if (this.destroyed) return;
      this.suggestions = [];
    }
    this.render();
  }

  destroy(): void {
    this.destroyed = true;
    this.generation++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.element.remove();
  }

  /** Searches what the box holds now. */
  async search(): Promise<void> {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const query = this.input.value.trim();
    const generation = ++this.generation;
    this.query = query;
    if (query.length < SEARCH_MIN_LENGTH) {
      this.results = null;
      this.status.set(query.length > 0 ? FIND_TEXT.hint : null);
      this.render();
      return;
    }
    this.status.set(FIND_TEXT.searching);
    try {
      const results = await this.options.api.search(query);
      if (this.destroyed || generation !== this.generation) return;
      this.results = results;
      this.status.set(null);
    } catch (caught) {
      if (this.destroyed || generation !== this.generation) return;
      const refusal = friendRefusal(caught);
      this.status.set(refusal.reason === "unknown" ? FIND_TEXT.searchFailed : refusal.message, "error");
    }
    this.render();
  }

  private typed(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    const query = this.input.value.trim();
    if (query.length === 0) {
      this.generation++;
      this.query = "";
      this.results = null;
      this.status.set(null);
      this.render();
      return;
    }
    this.timer = setTimeout(() => void this.search(), this.options.debounceMs ?? DEBOUNCE_MS);
  }

  private render(): void {
    const parts: HTMLElement[] = [];
    if (this.results !== null && this.query.length >= SEARCH_MIN_LENGTH) {
      parts.push(section(FIND_TEXT.results, this.results.map((player) => this.row(player)), FIND_TEXT.noResults));
    } else if (this.suggestions !== null && this.suggestions.length > 0) {
      parts.push(section(FIND_TEXT.suggestions, this.suggestions.map((player) => this.row(player)), FIND_TEXT.noSuggestions));
    } else if (this.query.length === 0) {
      parts.push(make("p", "friends-section__empty", FIND_TEXT.hint));
    }
    this.body.replaceChildren(...parts);
  }

  private row(player: PlayerResult): HTMLLIElement {
    return playerRow(player, { actions: [this.action(player)] });
  }

  /** What a player's row offers, by how they stand to the player. */
  private action(player: PlayerResult): HTMLElement {
    const chip = (words: string): HTMLElement => make("span", "chip friends-row__relation", words);
    switch (player.relation) {
      case "self":
        return chip(FIND_TEXT.self);
      case "friend":
        return chip(FIND_TEXT.friend);
      case "requested":
        return chip(FIND_TEXT.requested);
      default: {
        const asked = player.relation === "asked";
        const node = button(asked ? FIND_TEXT.accept : FIND_TEXT.add, () => void this.ask(player), "primary");
        node.disabled = this.busy.has(player.userid);
        return node;
      }
    }
  }

  /** Asks the player; to one who asked first, that accepts their request (§6.1). */
  private async ask(player: PlayerResult): Promise<void> {
    if (this.busy.has(player.userid)) return;
    this.busy.add(player.userid);
    this.render();
    const asked = player.relation === "asked";
    try {
      const result = await this.options.api.request({ userid: player.userid });
      const nowFriends = asked || result.friend !== null;
      if (result.friend) this.options.store.addFriend(result.friend);
      this.setRelation(player.userid, nowFriends ? "friend" : "requested");
      this.status.set(nowFriends ? FIND_TEXT.accepted(player.username) : FIND_TEXT.sent(player.username));
      if (nowFriends) void this.options.store.refresh();
    } catch (caught) {
      const refusal = friendRefusal(caught);
      this.status.set(refusal.message, "error");
      if (refusal.reason === "alreadyFriends") this.setRelation(player.userid, "friend");
      if (refusal.reason === "alreadyRequested") this.setRelation(player.userid, "requested");
    } finally {
      this.busy.delete(player.userid);
      if (!this.destroyed) this.render();
    }
  }

  private setRelation(userid: number, relation: Relation): void {
    const update = (players: PlayerResult[] | null): PlayerResult[] | null =>
      players?.map((one) => (one.userid === userid ? { ...one, relation } : one)) ?? null;
    this.results = update(this.results);
    this.suggestions = update(this.suggestions);
  }
}
