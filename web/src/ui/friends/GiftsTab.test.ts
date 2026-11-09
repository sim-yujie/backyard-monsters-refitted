// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GiftResource } from "@/api/friends";
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
  collectsLeft: 10,
  wishes: [] as GiftResource[],
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
    expect(tab.element.textContent).toContain("10 left today");
    expect(store.snapshot.giftsWaiting).toBe(2);
    expect(buttonIn(row(tab, 1), GIFTS_TEXT.sendBack).disabled).toBe(false);
    expect(buttonIn(row(tab, 2), GIFTS_TEXT.sentBack).disabled).toBe(true);
  });

  it("says so when none are waiting, and Collect all is off", async () => {
    const { tab } = setup({ gifts: { gifts: [], collectsLeft: 10, wishes: [] } });
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
    // Collected is a gain: green with a plus (owner, 28 Oct).
    expect(tab.statusText).toBe("Collected · Twigs 300 gained");
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
    expect(tab.statusText).toBe("Collected · Twigs 100 gained");
  });

  it("Collect all collects what today allows and fetches the list again", async () => {
    const { tab, calls } = setup({ collect: { collected: 2, resources: { r1: 300, r4: 500 }, collectsLeft: 3, giftsWaiting: 0 } });
    await tab.show();
    buttonIn(tab.element, GIFTS_TEXT.collectAll).click();
    await settle();
    expect(calls).toContainEqual(["collect", "all"]);
    expect(calls.filter(([method]) => method === "gifts")).toHaveLength(2);
    expect(tab.statusText).toBe("Collected · Twigs 300 gained Goo 500 gained");
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

describe("deleting (owner, 9 Nov 2026)", () => {
  const discOf = (giftid: number): HTMLButtonElement => {
    const found = document.querySelector(`[data-giftid="${giftid}"]`)?.querySelector<HTMLButtonElement>("button.gift-delete");
    if (!found) throw new Error(`no delete disc on gift ${giftid}`);
    return found;
  };

  it("each gift has the painted delete disc, named for a screen reader", async () => {
    const { tab } = setup();
    await tab.show();
    const disc = discOf(1);
    expect(disc.getAttribute("aria-label")).toBe("Delete gift: Bob");
    expect(disc.textContent).toBe("");
    expect(disc.querySelector(".gift-delete__disc")).not.toBeNull();
  });

  it("asks first; Cancel puts the row back and deletes nothing", async () => {
    const { tab, calls } = setup();
    await tab.show();
    discOf(1).click();
    expect(row(tab, 1)?.classList.contains("friends-row--confirm")).toBe(true);
    expect(row(tab, 1)?.textContent).toContain(GIFTS_TEXT.deleteAsk);
    // The amount stays in view while asking.
    expect(row(tab, 1)?.textContent).toContain("300");
    buttonIn(row(tab, 1), GIFTS_TEXT.cancel).click();
    expect(row(tab, 1)?.classList.contains("friends-row--confirm")).toBe(false);
    expect(calls.some(([method]) => method === "deleteGifts")).toBe(false);
  });

  it("deletes one gift: it goes, the count follows, and collects left stay", async () => {
    const refresh = vi.fn();
    clearPool = setPlayerPool({ read: () => null, refresh });
    const { tab, store, calls } = setup({ deleteGifts: { deleted: 1, collectsLeft: 10, giftsWaiting: 1 } });
    await tab.show();
    discOf(1).click();
    buttonIn(row(tab, 1), GIFTS_TEXT.delete).click();
    await settle();
    expect(calls).toContainEqual(["deleteGifts", 1]);
    expect(row(tab, 1)).toBeNull();
    expect(row(tab, 2)).not.toBeNull();
    expect(store.snapshot.giftsWaiting).toBe(1);
    expect(tab.statusText).toBe(GIFTS_TEXT.deleted(1));
    expect(tab.element.textContent).toContain("10 left today");
    // Nothing was given, so the pool is not refreshed.
    expect(refresh).not.toHaveBeenCalled();
  });

  it("Delete all shows with 2 or more, asks, then empties the list", async () => {
    const { tab, store, calls } = setup({ deleteGifts: { deleted: 2, collectsLeft: 10, giftsWaiting: 0 } });
    await tab.show();
    // A destructive plate: red in both looks, not the friendly green or gold.
    expect(buttonIn(tab.element, GIFTS_TEXT.deleteAll).classList.contains("btn--danger")).toBe(true);
    buttonIn(tab.element, GIFTS_TEXT.deleteAll).click();
    expect(tab.element.textContent).toContain(GIFTS_TEXT.deleteAllAsk(2));
    expect(calls.some(([method]) => method === "deleteGifts")).toBe(false);
    const yes = [...tab.element.querySelectorAll<HTMLButtonElement>(".gifts-summary .btn--danger")];
    expect(yes.map((node) => node.textContent)).toEqual([GIFTS_TEXT.deleteAll]);
    yes[0]!.click();
    await settle();
    expect(calls).toContainEqual(["deleteGifts", "all"]);
    expect(tab.element.textContent).toContain(GIFTS_TEXT.none);
    expect(store.snapshot.giftsWaiting).toBe(0);
    expect(tab.statusText).toBe(GIFTS_TEXT.deleted(2));
  });

  it("Delete all hides with one gift waiting", async () => {
    const { tab } = setup({ gifts: { ...twoGifts, gifts: twoGifts.gifts.slice(0, 1) } });
    await tab.show();
    expect(() => buttonIn(tab.element, GIFTS_TEXT.deleteAll)).toThrow();
    expect(discOf(1)).toBeTruthy();
  });

  it("drops a gift the server no longer has", async () => {
    const { tab } = setup({ deleteGifts: refused("noSuchGift") });
    await tab.show();
    discOf(2).click();
    buttonIn(row(tab, 2), GIFTS_TEXT.delete).click();
    await settle();
    expect(row(tab, 2)).toBeNull();
    expect(tab.statusText).toBe("That gift is no longer waiting.");
  });

  it("a delete keeps the collects left the server says, and Collect stays on", async () => {
    const { tab } = setup({ deleteGifts: { deleted: 1, collectsLeft: 4, giftsWaiting: 1 } });
    await tab.show();
    discOf(1).click();
    buttonIn(row(tab, 1), GIFTS_TEXT.delete).click();
    await settle();
    expect(tab.element.textContent).toContain("4 left today");
    expect(buttonIn(row(tab, 2), GIFTS_TEXT.collect).disabled).toBe(false);
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

describe("my wishes (#391)", () => {
  const toggle = (tab: GiftsTab, resource: string): HTMLButtonElement =>
    tab.element.querySelector(`.gift-wish[data-resource="${resource}"]`) as HTMLButtonElement;
  const pressed = (tab: GiftsTab): string[] =>
    [...tab.element.querySelectorAll<HTMLElement>('.gift-wish[aria-pressed="true"]')].map((node) => node.dataset["resource"]!);

  const rank = (tab: GiftsTab, resource: string): string | null =>
    toggle(tab, resource).querySelector(".wish-mark__rank")?.textContent ?? null;
  const hint = (tab: GiftsTab): string | null | undefined => tab.element.querySelector(".gift-wishes__hint")?.textContent;

  it("shows the saved wishes pressed, each with the painted marker and its rank, in the saved order", async () => {
    const { tab } = setup({ gifts: { ...twoGifts, wishes: ["r4", "r2"] } });
    await tab.show();
    expect(tab.element.querySelector(".gift-wishes__title")?.textContent).toBe(GIFTS_TEXT.wishes);
    expect(tab.element.querySelector(".gift-wishes__title .wish-mark")).not.toBeNull();
    expect(pressed(tab)).toEqual(["r2", "r4"]);
    expect(rank(tab, "r4")).toBe("1");
    expect(rank(tab, "r2")).toBe("2");
    expect(rank(tab, "r1")).toBeNull();
    expect(toggle(tab, "r4").getAttribute("aria-label")).toBe("Goo (wish 1)");
    expect(hint(tab)).toBe("Goo > Pebbles");
    expect(tab.element.textContent).not.toContain("★");
  });

  it("says \"only\" when one resource is wished, and how to start when none is", async () => {
    const { tab } = setup({ gifts: { ...twoGifts, wishes: ["r1"] } });
    await tab.show();
    expect(hint(tab)).toBe("Twigs only");
    expect(tab.element.querySelector(".gift-wishes__hint--only")).not.toBeNull();
    toggle(tab, "r1").click();
    await settle();
    expect(hint(tab)).toBe(GIFTS_TEXT.wishesHint);
    expect(tab.element.querySelector(".gift-wishes__hint--only")).toBeNull();
  });

  it("draws each toggle as its own square tile, not the skin's wide button plate", async () => {
    const { tab } = setup({ gifts: { ...twoGifts, wishes: ["r2"] } });
    await tab.show();
    for (const resource of ["r1", "r2", "r3", "r4"]) {
      const one = toggle(tab, resource);
      expect(one.classList.contains("btn")).toBe(false);
      expect(one.classList.contains("btn--outline")).toBe(false);
      expect(one.querySelector(".res-icon")).not.toBeNull();
    }
    expect(toggle(tab, "r2").classList.contains("gift-wish--on")).toBe(true);
    expect(toggle(tab, "r1").classList.contains("gift-wish--on")).toBe(false);
  });

  it("ranks wishes in the order tapped, saves each change at once, and turns the last one off at 3", async () => {
    const { tab, calls } = setup();
    await tab.show();
    toggle(tab, "r3").click();
    toggle(tab, "r1").click();
    await settle();
    expect(pressed(tab)).toEqual(["r1", "r3"]);
    expect([rank(tab, "r3"), rank(tab, "r1")]).toEqual(["1", "2"]);
    toggle(tab, "r4").click();
    await settle();
    expect(pressed(tab)).toEqual(["r1", "r3", "r4"]);
    expect(toggle(tab, "r2").disabled).toBe(true);
    // Taking out the first moves the others up.
    toggle(tab, "r3").click();
    await settle();
    expect(pressed(tab)).toEqual(["r1", "r4"]);
    expect([rank(tab, "r1"), rank(tab, "r4")]).toEqual(["1", "2"]);
    expect(toggle(tab, "r2").disabled).toBe(false);
    expect(calls.filter(([method]) => method === "setWishes").map(([, wishes]) => wishes)).toEqual([
      ["r3"],
      ["r3", "r1"],
      ["r3", "r1", "r4"],
      ["r1", "r4"],
    ]);
  });

  it("puts the saved wishes back and says so when saving fails", async () => {
    const { tab } = setup({ gifts: { ...twoGifts, wishes: ["r2"] }, setWishes: new Error("offline") });
    await tab.show();
    toggle(tab, "r1").click();
    expect(pressed(tab)).toEqual(["r1", "r2"]);
    await settle();
    expect(pressed(tab)).toEqual(["r2"]);
    expect(tab.statusText).toBe(GIFTS_TEXT.wishesFailed);
  });
});

describe("the wish tiles' look", () => {
  // jsdom applies no stylesheet: the rules are read from the CSS text.
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "friends.css"), "utf8").replace(/\r\n/g, "\n");
  const rule = (selector: string): string => css.split(`\n${selector} {`)[1]?.split("}")[0] ?? "";

  it("is a 44 px square with the icon in the middle", () => {
    expect(rule(".gift-wish")).toMatch(/box-sizing: border-box;/);
    expect(rule(".gift-wish")).toMatch(/width: 44px;/);
    expect(rule(".gift-wish")).toMatch(/height: 44px;/);
    expect(rule(".gift-wish")).toMatch(/place-items: center;/);
    expect(rule(".gift-wish")).not.toMatch(/border-image/);
    expect(rule(".gift-wish > .res-icon")).toMatch(/width: 32px;/);
  });

  it("is a different colour when on, with no inset ring, and the marker on the top-right corner", () => {
    const off = rule(".gift-wish");
    const on = css.split("\n.gift-wish--on,\n.gift-wish--on:hover:not(:disabled) {")[1]?.split("}")[0] ?? "";
    expect(off).toMatch(/background: var\(--colour-surface-sunken\);/);
    expect(on).toMatch(/background: radial-gradient\([^;]*var\(--colour-medal-gold\)/);
    expect(on).not.toMatch(/inset/);
    expect(rule(".gift-wish__mark")).toMatch(/position: absolute;/);
    expect(rule(".gift-wish__mark")).toMatch(/top: -\d+px;/);
    expect(rule(".gift-wish__mark")).toMatch(/right: -\d+px;/);
  });
});
