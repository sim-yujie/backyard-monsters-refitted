// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/http";
import { fixtureApi, fixturePlayer } from "@/game/friends/friendsFixture";
import { FriendsStore } from "@/game/friends/friendsStore";
import { FIND_TEXT, FindTab } from "./FindTab";

/** The Find tab (issue #370): username search, alliance suggestions, Add friend. */

const refused = (reason: string): ApiError =>
  new ApiError("refused", { status: 409, details: { message: "refused", status: 409, data: { reason } } });

const setup = (answers: Parameters<typeof fixtureApi>[0] = {}) => {
  const { api, calls } = fixtureApi({
    search: [
      fixturePlayer(1, "none", { username: "Bob" }),
      fixturePlayer(2, "asked", { username: "Bobby" }),
      fixturePlayer(3, "requested", { username: "Bobcat" }),
      fixturePlayer(4, "friend", { username: "Bobo" }),
      fixturePlayer(5, "self", { username: "Bobster" }),
    ],
    suggestions: [fixturePlayer(9, "none", { username: "Mate" })],
    ...answers,
  });
  const store = new FriendsStore({ api });
  const tab = new FindTab({ api, store, debounceMs: 10 });
  document.body.append(tab.element);
  return { tab, store, calls };
};

const type = (tab: FindTab, text: string): void => {
  tab.searchInput.value = text;
  tab.searchInput.dispatchEvent(new Event("input"));
};

const row = (tab: FindTab, userid: number): Element | null => tab.element.querySelector(`[data-userid="${userid}"]`);

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("FindTab", () => {
  it("shows alliance mates under an empty search", async () => {
    const { tab, calls } = setup();
    await tab.show();
    expect(calls).toContainEqual(["suggestions"]);
    expect(tab.element.querySelector(".friends-section__title")?.textContent).toBe(FIND_TEXT.suggestions);
    expect(row(tab, 9)?.textContent).toContain(FIND_TEXT.add);
  });

  it("asks for 3 letters before searching", async () => {
    const { tab, calls } = setup({ suggestions: [] });
    await tab.show();
    expect(tab.element.textContent).toContain(FIND_TEXT.hint);
    tab.searchInput.value = "Bo";
    await tab.search();
    expect(calls.some(([method]) => method === "search")).toBe(false);
    expect(tab.statusText).toBe(FIND_TEXT.hint);
  });

  it("searches after a pause in typing, once, and shows each relation", async () => {
    vi.useFakeTimers();
    const { tab, calls } = setup();
    type(tab, "Bo");
    type(tab, "Bob");
    await vi.advanceTimersByTimeAsync(20);
    expect(calls.filter(([method]) => method === "search")).toEqual([["search", "Bob"]]);
    expect(row(tab, 1)?.textContent).toContain(FIND_TEXT.add);
    expect(row(tab, 2)?.textContent).toContain(FIND_TEXT.accept);
    expect(row(tab, 3)?.textContent).toContain(FIND_TEXT.requested);
    expect(row(tab, 4)?.textContent).toContain(FIND_TEXT.friend);
    expect(row(tab, 5)?.textContent).toContain(FIND_TEXT.self);
    expect(row(tab, 3)?.querySelector("button")).toBeNull();
  });

  it("says when no one has that name", async () => {
    const { tab } = setup({ search: [] });
    tab.searchInput.value = "Zzzz";
    await tab.search();
    expect(tab.element.textContent).toContain(FIND_TEXT.noResults);
  });

  it("adds a friend: the row turns to Request sent", async () => {
    const { tab, calls } = setup();
    tab.searchInput.value = "Bob";
    await tab.search();
    row(tab, 1)?.querySelector("button")?.click();
    await settle();
    expect(calls).toContainEqual(["request", { userid: 1 }]);
    expect(row(tab, 1)?.textContent).toContain(FIND_TEXT.requested);
    expect(tab.statusText).toBe(FIND_TEXT.sent("Bob"));
  });

  it("accepts a player who asked first by asking back", async () => {
    const { tab, calls } = setup();
    tab.searchInput.value = "Bob";
    await tab.search();
    row(tab, 2)?.querySelector("button")?.click();
    await settle();
    expect(calls).toContainEqual(["request", { userid: 2 }]);
    expect(row(tab, 2)?.textContent).toContain(FIND_TEXT.friend);
    expect(calls.some(([method]) => method === "list")).toBe(true);
  });

  it("says why a request was refused", async () => {
    const { tab } = setup({ request: refused("requestsOff") });
    tab.searchInput.value = "Bob";
    await tab.search();
    row(tab, 1)?.querySelector("button")?.click();
    await settle();
    expect(tab.statusText).toBe("This player isn't taking friend requests.");
    expect(row(tab, 1)?.textContent).toContain(FIND_TEXT.add);
  });

  it("drops an older search's late answer", async () => {
    let release: (value: ReturnType<typeof fixturePlayer>[]) => void = () => {};
    const { api } = fixtureApi();
    const slow = new Promise<ReturnType<typeof fixturePlayer>[]>((resolve) => (release = resolve));
    api.search = vi.fn((query: string) => (query === "Old" ? slow : Promise.resolve([fixturePlayer(7, "none")])));
    const tab = new FindTab({ api, store: new FriendsStore({ api }), debounceMs: 10 });
    tab.searchInput.value = "Old";
    const first = tab.search();
    tab.searchInput.value = "New";
    await tab.search();
    release([fixturePlayer(6, "none")]);
    await first;
    expect(row(tab, 7)).not.toBeNull();
    expect(row(tab, 6)).toBeNull();
  });
});
