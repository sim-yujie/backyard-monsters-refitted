// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/http";
import { fixtureApi, fixtureFriend, fixtureList } from "@/game/friends/friendsFixture";
import { FriendsStore } from "@/game/friends/friendsStore";
import { FRIENDS_TEXT, FriendsTab, friendOrder } from "./FriendsTab";

/** The Friends tab (issue #370): the list, Remove, and the later packages' hooks. */

const refused = (reason: string): ApiError =>
  new ApiError("refused", { status: 409, details: { message: "refused", status: 409, data: { reason } } });

const setup = (options: { list?: Parameters<typeof fixtureApi>[0]; hooks?: boolean } = {}) => {
  const { api, calls } = fixtureApi({
    list: fixtureList(
      [
        fixtureFriend(1, { username: "Ann", level: 3, online: "away" }),
        fixtureFriend(2, { username: "Bob", level: 9, online: "online" }),
        fixtureFriend(3, { username: "Cat", level: 12, online: null }),
      ],
      { max: 100 },
    ),
    ...options.list,
  });
  const store = new FriendsStore({ api });
  const onFind = vi.fn();
  const onVisit = vi.fn();
  const onGift = vi.fn();
  const onBlock = vi.fn();
  const tab = new FriendsTab({ api, store, onFind, ...(options.hooks && { onVisit, onGift, onBlock }) });
  document.body.append(tab.element);
  return { tab, store, calls, onFind, onVisit, onGift, onBlock };
};

const names = (root: HTMLElement): string[] =>
  [...root.querySelectorAll(".friends-row__name")].map((node) => node.textContent ?? "");

const buttonIn = (row: Element | null | undefined, label: string): HTMLButtonElement => {
  const found = [...(row?.querySelectorAll("button") ?? [])].find((node) => node.textContent === label);
  if (!found) throw new Error(`no ${label} button`);
  return found;
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  document.body.replaceChildren();
});

describe("FriendsTab", () => {
  it("shows the count and the friends, online first then highest level", async () => {
    const { tab } = setup();
    await tab.show();
    expect(tab.element.querySelector(".friends-summary")?.textContent).toBe("3 of 100 friends");
    expect(names(tab.element)).toEqual(["Bob", "Ann", "Cat"]);
    const bob = tab.element.querySelector('[data-userid="2"]');
    expect(bob?.textContent).toContain("Level 9");
    expect(bob?.textContent).toContain("Online");
    expect(bob?.querySelector(".friends-online--online")).not.toBeNull();
    // A friend who hides it shows no line at all.
    expect(tab.element.querySelector('[data-userid="3"] .friends-online')).toBeNull();
  });

  it("orders by online, then level, then name", () => {
    const a = fixtureFriend(1, { username: "A", level: 2, online: "week" });
    const b = fixtureFriend(2, { username: "B", level: 8, online: "week" });
    const c = fixtureFriend(3, { username: "C", level: 1, online: "today" });
    expect([a, b, c].sort(friendOrder).map((one) => one.username)).toEqual(["C", "B", "A"]);
  });

  it("offers Find when there are no friends yet", async () => {
    const { tab, onFind } = setup({ list: { list: fixtureList([]) } });
    await tab.show();
    expect(tab.element.textContent).toContain(FRIENDS_TEXT.empty);
    buttonIn(tab.element, FRIENDS_TEXT.find).click();
    expect(onFind).toHaveBeenCalled();
  });

  it("says when the list could not load", async () => {
    const { tab } = setup({ list: { list: new Error("down") } });
    await tab.show();
    expect(tab.statusText).toBe(FRIENDS_TEXT.loadFailed);
  });

  it("asks before removing, then removes at once", async () => {
    const { tab, store, calls } = setup();
    await tab.show();
    buttonIn(tab.element.querySelector('[data-userid="1"]'), FRIENDS_TEXT.remove).click();
    const confirm = tab.element.querySelector('[data-userid="1"]');
    expect(confirm?.textContent).toContain(FRIENDS_TEXT.removeConfirm("Ann"));
    buttonIn(confirm, FRIENDS_TEXT.cancel).click();
    expect(tab.element.querySelector('[data-userid="1"]')?.textContent).not.toContain("Remove Ann");

    buttonIn(tab.element.querySelector('[data-userid="1"]'), FRIENDS_TEXT.remove).click();
    buttonIn(tab.element.querySelector('[data-userid="1"]'), FRIENDS_TEXT.removeYes).click();
    await settle();
    expect(calls).toContainEqual(["remove", 1]);
    expect(store.isFriend(1)).toBe(false);
    expect(names(tab.element)).toEqual(["Bob", "Cat"]);
    expect(tab.statusText).toBe(FRIENDS_TEXT.removed("Ann"));
  });

  it("says why a removal was refused, and keeps the row", async () => {
    const { tab, store } = setup({ list: { remove: refused("notFriends") } });
    await tab.show();
    buttonIn(tab.element.querySelector('[data-userid="2"]'), FRIENDS_TEXT.remove).click();
    buttonIn(tab.element.querySelector('[data-userid="2"]'), FRIENDS_TEXT.removeYes).click();
    await settle();
    expect(tab.statusText).toBe("You are not friends with this player any more.");
    expect(store.isFriend(2)).toBe(true);
  });

  it("shows Visit, Send gift and Block only when their packages hand them in", async () => {
    const bare = setup();
    await bare.tab.show();
    expect(bare.tab.element.textContent).not.toContain(FRIENDS_TEXT.visit);
    bare.tab.destroy();

    const { tab, onVisit, onGift, onBlock } = setup({
      hooks: true,
      list: { list: fixtureList([fixtureFriend(4, { username: "Dee", giftSentToday: true }), fixtureFriend(5)]) },
    });
    await tab.show();
    const dee = tab.element.querySelector('[data-userid="4"]');
    buttonIn(dee, FRIENDS_TEXT.visit).click();
    expect(onVisit).toHaveBeenCalledWith(expect.objectContaining({ userid: 4 }));
    expect(buttonIn(dee, FRIENDS_TEXT.giftSent).disabled).toBe(true);
    buttonIn(tab.element.querySelector('[data-userid="5"]'), FRIENDS_TEXT.gift).click();
    expect(onGift).toHaveBeenCalledWith(expect.objectContaining({ userid: 5 }));
    buttonIn(dee, FRIENDS_TEXT.block).click();
    expect(onBlock).toHaveBeenCalledWith(expect.objectContaining({ userid: 4 }));
  });
});
