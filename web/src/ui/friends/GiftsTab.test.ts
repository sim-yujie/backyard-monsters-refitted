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
  collectsLeft: 5,
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
    expect(tab.element.textContent).toContain(GIFTS_TEXT.left(5));
    expect(store.snapshot.giftsWaiting).toBe(2);
    expect(buttonIn(row(tab, 1), GIFTS_TEXT.sendBack).disabled).toBe(false);
    expect(buttonIn(row(tab, 2), GIFTS_TEXT.sentBack).disabled).toBe(true);
  });

  it("says so when none are waiting, and Collect all is off", async () => {
    const { tab } = setup({ gifts: { gifts: [], collectsLeft: 5, wishes: [] } });
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

  it("shows the saved wishes pressed and starred", async () => {
    const { tab } = setup({ gifts: { ...twoGifts, wishes: ["r2", "r4"] } });
    await tab.show();
    expect(tab.element.querySelector(".gift-wishes__title")?.textContent).toBe(GIFTS_TEXT.wishes);
    expect(pressed(tab)).toEqual(["r2", "r4"]);
    expect(toggle(tab, "r2").querySelector(".gift-wish__star")?.textContent).toBe("★");
    expect(toggle(tab, "r1").querySelector(".gift-wish__star")).toBeNull();
    // The title's star is the stars' gold one (its own span).
    expect(tab.element.querySelector(".gift-wishes__title .gift-wishes__star")?.textContent).toBe("★");
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

  it("saves each change at once, and turns the last one off at 3", async () => {
    const { tab, calls } = setup();
    await tab.show();
    toggle(tab, "r3").click();
    toggle(tab, "r1").click();
    await settle();
    expect(pressed(tab)).toEqual(["r1", "r3"]);
    toggle(tab, "r4").click();
    await settle();
    expect(pressed(tab)).toEqual(["r1", "r3", "r4"]);
    expect(toggle(tab, "r2").disabled).toBe(true);
    toggle(tab, "r3").click();
    await settle();
    expect(pressed(tab)).toEqual(["r1", "r4"]);
    expect(toggle(tab, "r2").disabled).toBe(false);
    expect(calls.filter(([method]) => method === "setWishes").map(([, wishes]) => wishes)).toEqual([
      ["r3"],
      ["r1", "r3"],
      ["r1", "r3", "r4"],
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

  it("is a different colour when on, with no inset ring, and the star on the top-right corner", () => {
    const off = rule(".gift-wish");
    const on = css.split("\n.gift-wish--on,\n.gift-wish--on:hover:not(:disabled) {")[1]?.split("}")[0] ?? "";
    expect(off).toMatch(/background: var\(--colour-surface-sunken\);/);
    expect(on).toMatch(/background: radial-gradient\([^;]*var\(--colour-medal-gold\)/);
    expect(on).not.toMatch(/inset/);
    expect(rule(".gift-wish__star")).toMatch(/position: absolute;/);
    expect(rule(".gift-wish__star")).toMatch(/top: -\d+px;/);
    expect(rule(".gift-wish__star")).toMatch(/right: -\d+px;/);
  });
});
