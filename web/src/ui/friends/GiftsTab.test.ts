// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/http";
import { fixtureApi, fixtureGift, fixtureList } from "@/game/friends/friendsFixture";
import { FriendsStore } from "@/game/friends/friendsStore";
import { setPlayerPool } from "@/game/friends/friendsView";
import { GIFTS_TEXT, GiftsTab, lapseText, overflowOf } from "./GiftsTab";

/** The Gifts tab (issue #375): the gifts waiting, Collect, Collect all with the short-storage warning, Send one back. */

const NOW = 1_760_000_000;
const DAY = 24 * 60 * 60;

const refused = (reason: string): ApiError =>
  new ApiError("refused", { status: 409, details: { message: "refused", status: 409, data: { reason } } });

const twoGifts = {
  gifts: [
    fixtureGift(1, 7, { username: "Bob", resource: "r1" as const, amount: 300, expiresAt: NOW + 3 * DAY }),
    fixtureGift(2, 8, { username: "Cat", resource: "r4" as const, amount: 500, canSendBack: false }),
  ],
  collectsLeft: 5,
};

let clearPool: (() => void) | null = null;

const setup = (answers: Parameters<typeof fixtureApi>[0] = {}, onSendBack = vi.fn()) => {
  const { api, calls } = fixtureApi({ gifts: twoGifts, list: fixtureList([], { giftsWaiting: 9 }), ...answers });
  const store = new FriendsStore({ api });
  const tab = new GiftsTab({ api, store, now: () => NOW, onSendBack });
  document.body.append(tab.element);
  return { tab, store, calls, onSendBack };
};

const row = (tab: GiftsTab, giftid: number): Element | null => tab.element.querySelector(`[data-giftid="${giftid}"]`);

const buttonIn = (parent: Element | null, label: string): HTMLButtonElement => {
  const found = [...(parent?.querySelectorAll("button") ?? [])].find((node) => node.textContent === label);
  if (!found) throw new Error(`no ${label} button`);
  return found as HTMLButtonElement;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  clearPool?.();
  clearPool = null;
  document.body.replaceChildren();
});

describe("the list", () => {
  it("shows each gift with its sender, amount and time left, and the count in the store", async () => {
    const { tab, store } = setup();
    await tab.show();
    expect(row(tab, 1)?.textContent).toContain("Bob");
    expect(row(tab, 1)?.textContent).toContain("300");
    expect(row(tab, 1)?.textContent).toContain("3 days left");
    expect(tab.element.textContent).toContain(GIFTS_TEXT.left(5));
    expect(store.snapshot.giftsWaiting).toBe(2);
    expect(buttonIn(row(tab, 1), GIFTS_TEXT.sendBack).disabled).toBe(false);
    expect(buttonIn(row(tab, 2), GIFTS_TEXT.sentBack).disabled).toBe(true);
  });

  it("says so when none are waiting, and Collect all is off", async () => {
    const { tab } = setup({ gifts: { gifts: [], collectsLeft: 5 } });
    await tab.show();
    expect(tab.element.textContent).toContain(GIFTS_TEXT.none);
    expect(buttonIn(tab.element, GIFTS_TEXT.collectAll).disabled).toBe(true);
  });

  it("turns Collect off once today's collects are used", async () => {
    const { tab } = setup({ gifts: { ...twoGifts, collectsLeft: 0 } });
    await tab.show();
    expect(buttonIn(row(tab, 1), GIFTS_TEXT.collect).disabled).toBe(true);
    expect(buttonIn(tab.element, GIFTS_TEXT.collectAll).disabled).toBe(true);
    expect(tab.element.textContent).toContain(GIFTS_TEXT.left(0));
  });

  it("says when loading failed", async () => {
    const { tab } = setup({ gifts: new Error("down") });
    await tab.show();
    expect(tab.statusText).toBe(GIFTS_TEXT.loadFailed);
  });
});

describe("collecting", () => {
  it("collects one gift, takes it off, refreshes the pool and says what landed", async () => {
    const refresh = vi.fn();
    clearPool = setPlayerPool({ read: () => null, refresh });
    const { tab, store, calls } = setup({ collect: { collected: 1, resources: { r1: 300 }, collectsLeft: 4, giftsWaiting: 1 } });
    await tab.show();
    buttonIn(row(tab, 1), GIFTS_TEXT.collect).click();
    await settle();
    expect(calls).toContainEqual(["collect", 1]);
    expect(row(tab, 1)).toBeNull();
    expect(tab.statusText).toBe("Collected 300 Twigs.");
    expect(store.snapshot.giftsWaiting).toBe(1);
    expect(refresh).toHaveBeenCalledOnce();
    expect(tab.element.textContent).toContain(GIFTS_TEXT.left(4));
  });

  it("warns first when storage is short, and collects on the second press", async () => {
    clearPool = setPlayerPool({
      read: () => ({ resources: { r1: 9_900 }, caps: { r1: 10_000, r2: 10_000, r3: 10_000, r4: 10_000 } }),
      refresh: vi.fn(),
    });
    const { tab, calls } = setup({ collect: { collected: 1, resources: { r1: 100 }, collectsLeft: 4, giftsWaiting: 1 } });
    await tab.show();
    buttonIn(row(tab, 1), GIFTS_TEXT.collect).click();
    await settle();
    expect(calls.some(([method]) => method === "collect")).toBe(false);
    expect(tab.statusText).toBe(GIFTS_TEXT.short({ r1: 200 }));
    buttonIn(row(tab, 1), GIFTS_TEXT.collectAnyway).click();
    await settle();
    expect(calls).toContainEqual(["collect", 1]);
    expect(tab.statusText).toBe("Collected 100 Twigs.");
  });

  it("Collect all collects what today allows and fetches the list again", async () => {
    const { tab, calls } = setup({ collect: { collected: 2, resources: { r1: 300, r4: 500 }, collectsLeft: 3, giftsWaiting: 0 } });
    await tab.show();
    buttonIn(tab.element, GIFTS_TEXT.collectAll).click();
    await settle();
    expect(calls).toContainEqual(["collect", "all"]);
    expect(calls.filter(([method]) => method === "gifts")).toHaveLength(2);
    expect(tab.statusText).toBe("Collected 300 Twigs and 500 Goo.");
  });

  it("says the daily limit and turns Collect off", async () => {
    const { tab } = setup({ collect: refused("collectLimit") });
    await tab.show();
    buttonIn(row(tab, 1), GIFTS_TEXT.collect).click();
    await settle();
    expect(tab.statusText).toContain("as many gifts as you can today");
    expect(buttonIn(row(tab, 1), GIFTS_TEXT.collect).disabled).toBe(true);
  });

  it("drops a gift that is no longer waiting", async () => {
    const { tab } = setup({ collect: refused("noSuchGift") });
    await tab.show();
    buttonIn(row(tab, 2), GIFTS_TEXT.collect).click();
    await settle();
    expect(row(tab, 2)).toBeNull();
    expect(tab.statusText).toBe("That gift is no longer waiting.");
  });

  it("says the player's own yard is under attack", async () => {
    const { tab } = setup({ collect: refused("underAttack") });
    await tab.show();
    buttonIn(row(tab, 1), GIFTS_TEXT.collect).click();
    await settle();
    expect(tab.statusText).toBe(GIFTS_TEXT.underAttack);
  });
});

describe("sending one back", () => {
  it("opens the picker for the sender and turns their buttons off once sent", async () => {
    const { tab, onSendBack } = setup();
    await tab.show();
    buttonIn(row(tab, 1), GIFTS_TEXT.sendBack).click();
    expect(onSendBack).toHaveBeenCalledWith({ userid: 7, username: "Bob" }, expect.any(Function));
    onSendBack.mock.calls[0]![1]();
    expect(buttonIn(row(tab, 1), GIFTS_TEXT.sentBack).disabled).toBe(true);
  });
});

describe("helpers", () => {
  it("says the time left", () => {
    expect(lapseText(NOW + 6 * DAY + 5, NOW)).toBe("6 days left");
    expect(lapseText(NOW + DAY + 5, NOW)).toBe("1 day left");
    expect(lapseText(NOW + 5 * 3600 + 5, NOW)).toBe("5 h left");
    expect(lapseText(NOW + 60, NOW)).toBe("Less than an hour left");
  });

  it("works out what would not fit", () => {
    const pool = { resources: { r1: 9_000, r2: 0 }, caps: { r1: 10_000, r2: 10_000, r3: 10_000, r4: 10_000 } };
    expect(overflowOf({ r1: 1_500, r2: 500 }, pool)).toEqual({ r1: 500 });
    expect(overflowOf({ r1: 1_500 }, null)).toEqual({});
    expect(overflowOf({ r1: 1_500 }, { resources: {}, caps: null })).toEqual({});
  });
});
