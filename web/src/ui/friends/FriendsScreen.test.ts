// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureApi, fixtureFriend, fixtureList } from "@/game/friends/friendsFixture";
import { FriendsStore } from "@/game/friends/friendsStore";
import { friendsOpener, setFriendsOpener } from "@/game/friends/friendsView";
import { FriendsDoor } from "./FriendsDoor";
import { FRIENDS_TABS, FriendsScreen } from "./FriendsScreen";

/** The Friends screen and its door (issue #370). */

const setup = () => {
  const { api, calls } = fixtureApi({ list: fixtureList([fixtureFriend(1, { username: "Ann" })], { requestsIn: 3 }) });
  const store = new FriendsStore({ api, setInterval: () => 0, clearInterval: () => {} });
  const onClose = vi.fn();
  const screen = new FriendsScreen({ api, store, onClose }).mount(document.body);
  return { screen, store, calls, onClose };
};

const tabButton = (screen: FriendsScreen, id: string): HTMLButtonElement =>
  screen.element.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)!;

afterEach(() => {
  document.body.replaceChildren();
  setFriendsOpener(null);
});

describe("FriendsScreen", () => {
  it("has the Friends, Requests, Gifts and Find tabs, in that order", () => {
    const { screen } = setup();
    const labels = [...screen.element.querySelectorAll(".friends-tabs__label")].map((node) => node.textContent);
    expect(labels).toEqual(["Friends", "Requests", "Gifts", "Find"]);
    expect(FRIENDS_TABS.map((tab) => tab.id)).toEqual(["friends", "requests", "gifts", "find"]);
    expect(screen.element.hidden).toBe(true);
  });

  it("opens on Friends, fetching the list", async () => {
    const { screen, calls } = setup();
    await screen.open();
    expect(screen.isOpen).toBe(true);
    expect(screen.activeTab).toBe("friends");
    expect(tabButton(screen, "friends").getAttribute("aria-selected")).toBe("true");
    expect(calls).toContainEqual(["list"]);
    expect(screen.element.textContent).toContain("Ann");
  });

  it("shows the requests waiting on the Requests tab", async () => {
    const { screen, store } = setup();
    await store.refresh();
    const count = tabButton(screen, "requests").querySelector(".friends-tabs__count") as HTMLElement;
    expect(count.textContent).toBe("3");
    expect(count.hidden).toBe(false);
    store.setRequestsIn(0);
    expect(count.hidden).toBe(true);
  });

  it("shows the gifts waiting on the Gifts tab (#375)", () => {
    const { screen, store } = setup();
    const count = tabButton(screen, "gifts").querySelector(".friends-tabs__count") as HTMLElement;
    store.setGiftsWaiting(4);
    expect(count.textContent).toBe("4");
    store.setGiftsWaiting(0);
    expect(count.hidden).toBe(true);
  });

  it("switches tabs by click and by arrow keys, fetching each fresh", async () => {
    const { screen, calls } = setup();
    await screen.open();
    tabButton(screen, "requests").click();
    expect(screen.activeTab).toBe("requests");
    expect(calls).toContainEqual(["requests"]);
    tabButton(screen, "requests").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(screen.activeTab).toBe("gifts");
    expect(calls).toContainEqual(["gifts"]);
    tabButton(screen, "gifts").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(screen.activeTab).toBe("find");
    expect(calls).toContainEqual(["suggestions"]);
    tabButton(screen, "find").dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(screen.activeTab).toBe("friends");
  });

  it("closes with Escape and the close button, and says whether focus was inside", async () => {
    const { screen, onClose } = setup();
    await screen.open();
    screen.element.querySelector<HTMLButtonElement>(".friends-screen__close")!.focus();
    screen.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(screen.isOpen).toBe(false);
    expect(screen.element.hidden).toBe(true);
    expect(onClose).toHaveBeenCalledWith(true);
    await screen.open("find");
    screen.element.querySelector<HTMLButtonElement>(".friends-screen__close")!.click();
    expect(screen.isOpen).toBe(false);
  });

  it("goes to Find from the empty list's button", async () => {
    const { api } = fixtureApi();
    const screen = new FriendsScreen({ api, store: new FriendsStore({ api }) }).mount(document.body);
    await screen.open();
    [...screen.element.querySelectorAll("button")].find((node) => node.textContent === "Find players")!.click();
    expect(screen.activeTab).toBe("find");
  });
});

describe("FriendsDoor", () => {
  it("docks the screen on first open, registers the opener and reports the count", async () => {
    const { api } = fixtureApi({ list: fixtureList([], { requestsIn: 2, giftsWaiting: 1 }) });
    const store = new FriendsStore({ api, setInterval: () => 0, clearInterval: () => {} });
    const container = document.createElement("div");
    document.body.append(container);
    const onOpen = vi.fn();
    const counts: number[] = [];
    const door = new FriendsDoor({ container: () => container, api, store, onOpen, onCount: (n) => counts.push(n) });
    expect(container.childElementCount).toBe(0);
    await store.refresh();
    expect(counts.at(-1)).toBe(3);

    friendsOpener()?.("requests");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onOpen).toHaveBeenCalled();
    expect(door.isOpen).toBe(true);
    expect(container.querySelector(".friends-screen")?.getAttribute("data-tab")).toBe("requests");

    door.destroy();
    expect(friendsOpener()).toBeNull();
    expect(container.childElementCount).toBe(0);
  });
});
