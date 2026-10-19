// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "@/api/http";
import { fixtureApi, fixtureFriend, fixtureList, fixtureRequest } from "@/game/friends/friendsFixture";
import { FriendsStore } from "@/game/friends/friendsStore";
import { REQUESTS_TEXT, RequestsTab } from "./RequestsTab";

/** The Requests tab (issue #370): waiting for you with Accept/Decline, sent with Cancel. */

const NOW = 1_760_000_000;

const refused = (reason: string): ApiError =>
  new ApiError("refused", { status: 409, details: { message: "refused", status: 409, data: { reason } } });

const setup = (answers: Parameters<typeof fixtureApi>[0] = {}) => {
  const { api, calls } = fixtureApi({
    requests: {
      incoming: [
        fixtureRequest(10, 7, { username: "Bob", level: 6, createdAt: NOW - 7_200 }),
        fixtureRequest(11, 8, { username: "Cat" }),
      ],
      outgoing: [fixtureRequest(12, 9, { username: "Dee", createdAt: NOW - 30 })],
    },
    list: fixtureList([], { requestsIn: 5 }),
    ...answers,
  });
  const store = new FriendsStore({ api });
  const tab = new RequestsTab({ api, store, now: () => NOW });
  document.body.append(tab.element);
  return { tab, store, calls };
};

const row = (tab: RequestsTab, userid: number): Element | null => tab.element.querySelector(`[data-userid="${userid}"]`);

const press = (parent: Element | null, label: string): void => {
  const found = [...(parent?.querySelectorAll("button") ?? [])].find((node) => node.textContent === label);
  if (!found) throw new Error(`no ${label} button`);
  found.click();
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  document.body.replaceChildren();
});

describe("RequestsTab", () => {
  it("lists requests both ways, with when they were sent", async () => {
    const { tab, store } = setup();
    await tab.show();
    const titles = [...tab.element.querySelectorAll(".friends-section__title")].map((node) => node.textContent);
    expect(titles).toEqual([REQUESTS_TEXT.incoming, REQUESTS_TEXT.outgoing]);
    expect(row(tab, 7)?.textContent).toContain("Level 6");
    expect(row(tab, 7)?.textContent).toContain("Asked 2 h ago");
    expect(row(tab, 9)?.textContent).toContain("Asked just now");
    // The tab's own count wins over the list's.
    expect(store.snapshot.requestsIn).toBe(2);
  });

  it("says so when nothing waits either way", async () => {
    const { tab } = setup({ requests: { incoming: [], outgoing: [] } });
    await tab.show();
    expect(tab.element.textContent).toContain(REQUESTS_TEXT.noIncoming);
    expect(tab.element.textContent).toContain(REQUESTS_TEXT.noOutgoing);
  });

  it("accepts: the row goes, the friend joins the list, the count drops", async () => {
    const { tab, store, calls } = setup({
      answer: fixtureFriend(7, { username: "Bob" }),
      // The server's own count after the accept.
      list: fixtureList([fixtureFriend(7, { username: "Bob" })], { requestsIn: 1 }),
    });
    await tab.show();
    press(row(tab, 7), REQUESTS_TEXT.accept);
    await settle();
    expect(calls).toContainEqual(["answer", 10, true]);
    expect(row(tab, 7)).toBeNull();
    expect(store.snapshot.requestsIn).toBe(1);
    expect(tab.statusText).toBe(REQUESTS_TEXT.accepted("Bob"));
    expect(store.isFriend(7)).toBe(true);
    // And the list is fetched again for their level and online line.
    expect(calls.some(([method]) => method === "list")).toBe(true);
  });

  it("declines silently and cancels a sent one", async () => {
    const { tab, calls } = setup();
    await tab.show();
    press(row(tab, 8), REQUESTS_TEXT.decline);
    await settle();
    expect(calls).toContainEqual(["answer", 11, false]);
    expect(row(tab, 8)).toBeNull();
    press(row(tab, 9), REQUESTS_TEXT.cancel);
    await settle();
    expect(calls).toContainEqual(["cancel", 12]);
    expect(row(tab, 9)).toBeNull();
    expect(tab.statusText).toBe(REQUESTS_TEXT.cancelled("Dee"));
  });

  it("says why an answer was refused; a request no longer waiting leaves", async () => {
    const limit = setup({ answer: refused("friendLimit") });
    await limit.tab.show();
    press(row(limit.tab, 7), REQUESTS_TEXT.accept);
    await settle();
    expect(limit.tab.statusText).toBe("You already have the most friends you can have.");
    expect(row(limit.tab, 7)).not.toBeNull();
    limit.tab.destroy();

    const gone = setup({ cancel: refused("noSuchRequest") });
    await gone.tab.show();
    press(row(gone.tab, 9), REQUESTS_TEXT.cancel);
    await settle();
    expect(gone.tab.statusText).toBe("That request is no longer waiting for an answer.");
    expect(row(gone.tab, 9)).toBeNull();
  });

  it("says when the requests could not load", async () => {
    const { tab } = setup({ requests: new Error("down") });
    await tab.show();
    expect(tab.statusText).toBe(REQUESTS_TEXT.loadFailed);
  });
});
