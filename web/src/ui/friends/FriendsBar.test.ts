// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureApi, fixtureFriend, fixtureList } from "@/game/friends/friendsFixture";
import { FriendsStore } from "@/game/friends/friendsStore";
import { FriendsBar, canHelp, friendsBadge, helpNote, orderFriends, pageOf } from "./FriendsBar";

/** The friends bar (issue #371, design §3.2). */

const friend = fixtureFriend;

const setup = async (friends = [friend(1), friend(2)], options: ConstructorParameters<typeof FriendsBar>[0] = {}) => {
  const store = new FriendsStore({ api: fixtureApi({ list: fixtureList(friends) }).api });
  await store.refresh();
  const openFriends = vi.fn();
  const bar = new FriendsBar({ store, openFriends, ...options }).mount(document.body);
  return { store, bar, openFriends };
};

const slots = () => [...document.querySelectorAll<HTMLElement>(".friends-bar__slot:not(.friends-bar__slot--add)")];
const names = () => slots().map((s) => s.querySelector(".friends-bar__name")!.textContent);

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("ordering", () => {
  it("puts a wrench first, then online, then the higher level", () => {
    const list = [
      friend(1, { username: "Low", level: 3 }),
      friend(2, { username: "High", level: 40 }),
      friend(3, { username: "On", level: 5, online: "online" }),
      friend(4, { username: "Help", level: 1, help: { speedup: true, repair: false } }),
    ];
    expect(orderFriends(list).map((f) => f.username)).toEqual(["Help", "On", "High", "Low"]);
  });

  it("does not count a help with nothing to do as a wrench", () => {
    expect(canHelp(friend(1, { help: { speedup: false, repair: false } }))).toBe(false);
    expect(canHelp(friend(1))).toBe(false);
  });
});

describe("paging", () => {
  it("keeps the page inside the range", () => {
    const items = [1, 2, 3, 4, 5];
    expect(pageOf(items, 0, 2)).toEqual({ items: [1, 2], page: 0, pages: 3 });
    expect(pageOf(items, 9, 2)).toEqual({ items: [5], page: 2, pages: 3 });
    expect(pageOf(items, -1, 2).page).toBe(0);
    expect(pageOf([], 0, 2)).toEqual({ items: [], page: 0, pages: 1 });
  });

  it("shows arrows only when there is more than a page, and pages with them", async () => {
    const many = Array.from({ length: 7 }, (_, i) => friend(i + 1, { level: 100 - i, username: `P${i + 1}` }));
    await setup(many);
    const [prev, next] = document.querySelectorAll<HTMLButtonElement>(".friends-bar__arrow");
    expect(names()).toEqual(["P1", "P2", "P3", "P4", "P5"]);
    expect(prev!.disabled).toBe(true);
    next!.click();
    expect(names()).toEqual(["P6", "P7"]);
    expect(next!.disabled).toBe(true);
  });

  it("sizes the page from the room there is, not from the strip's current width", async () => {
    // A strip sized by its contents, squeezed by a bar that is `room` wide at most.
    let room = 1000;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("friends-bar__strip") ? Math.min(this.children.length * 68 - 4, room) : 0;
    });
    const many = Array.from({ length: 10 }, (_, i) => friend(i + 1, { level: 100 - i, username: `P${i + 1}` }));
    const { bar } = await setup([], {});
    expect(names()).toEqual([]);
    const store = new FriendsStore({ api: fixtureApi({ list: fixtureList(many) }).api });
    bar.destroy();
    await store.refresh();
    new FriendsBar({ store, openFriends: vi.fn() }).mount(document.body);
    expect(names()).toHaveLength(10);
    room = 400;
    window.dispatchEvent(new Event("resize"));
    expect(names()).toHaveLength(4);
    room = 1000;
    window.dispatchEvent(new Event("resize"));
    expect(names()).toHaveLength(10);
    vi.restoreAllMocks();
  });

  it("pages 100 friends in a narrow space even when the strip grows to fit them all", async () => {
    // The desktop bug: the strip grew to every portrait (about 6,900px) and ran under the dock's buttons.
    const parentWidth = 1280;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("friends-bar__strip")) return this.children.length * 68 - 4;
      return this === document.body ? parentWidth : 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      const strip = this.querySelector<HTMLElement>(".friends-bar__strip");
      return this.classList.contains("friends-bar") && strip ? strip.clientWidth + 18 : 0;
    });
    const many = Array.from({ length: 100 }, (_, i) => friend(i + 1, { level: 200 - i, username: `P${i + 1}` }));
    const store = new FriendsStore({ api: fixtureApi({ list: fixtureList(many) }).api });
    await store.refresh();
    const bar = new FriendsBar({ store, openFriends: vi.fn() });
    bar.element.style.left = "140px";
    bar.element.style.right = "500px";
    bar.mount(document.body);
    // 1280 - 140 - 500 - 18 = 622px of strip: the "+", the arrows and 7 portraits.
    expect(names()).toEqual(["P1", "P2", "P3", "P4", "P5", "P6", "P7"]);
    const [prev, next] = document.querySelectorAll<HTMLButtonElement>(".friends-bar__arrow");
    expect(prev!.hidden || next!.hidden).toBe(false);
    next!.click();
    expect(names()[0]).toBe("P8");
    for (let i = 0; i < 20; i++) next!.click();
    expect(names()).toEqual(["P99", "P100"]);
    expect(next!.disabled).toBe(true);
    // The short last page shrinks the strip, which measures again: it must stay on that page.
    window.dispatchEvent(new Event("resize"));
    expect(names()).toEqual(["P99", "P100"]);
    expect(document.querySelector<HTMLElement>(".friends-bar__strip")!.style.width).toBe(`${8 * 68 - 4}px`);
    vi.restoreAllMocks();
  });

  it("shows 1 or 5 friends with no arrows when they fit", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("friends-bar__strip")) return this.children.length * 68 - 4;
      return this === document.body ? 1600 : 0;
    });
    for (const count of [1, 5]) {
      const list = Array.from({ length: count }, (_, i) => friend(i + 1));
      const store = new FriendsStore({ api: fixtureApi({ list: fixtureList(list) }).api });
      await store.refresh();
      const bar = new FriendsBar({ store, openFriends: vi.fn() });
      bar.element.style.left = "140px";
      bar.element.style.right = "500px";
      bar.mount(document.body);
      expect(names()).toHaveLength(count);
      expect([...document.querySelectorAll<HTMLElement>(".friends-bar__arrow")].every((a) => a.hidden)).toBe(true);
      bar.destroy();
    }
    vi.restoreAllMocks();
  });

  it("hides the arrows for a short list", async () => {
    await setup();
    expect([...document.querySelectorAll<HTMLElement>(".friends-bar__arrow")].every((a) => a.hidden)).toBe(true);
  });
});

describe("portraits", () => {
  it("shows name, level, online dot and the two badges from the list data", async () => {
    await setup([
      friend(1, { username: "Ann", level: 12, online: "online", giftSentToday: false, help: { speedup: true, repair: false } }),
      friend(2, { username: "Bo", online: "today", giftSentToday: true }),
    ]);
    const [ann, bo] = slots();
    expect(ann!.querySelector(".friends-bar__level")!.textContent).toBe("Lv 12");
    expect(ann!.querySelector(".friends-bar__dot")).not.toBeNull();
    expect(ann!.querySelector(".friends-bar__badge--wrench")).not.toBeNull();
    expect(ann!.querySelector(".friends-bar__badge--gift")).not.toBeNull();
    expect(bo!.querySelector(".friends-bar__dot")).toBeNull();
    expect(bo!.querySelector(".friends-bar__badge")).toBeNull();
  });

  it("updates when the store changes", async () => {
    const { store } = await setup([friend(1, { username: "Ann" })]);
    store.addFriend(friend(2, { username: "Zed", level: 99 }));
    expect(names()).toEqual(["Zed", "Ann"]);
    store.removeFriend(1);
    expect(names()).toEqual(["Zed"]);
  });
});

describe("empty state and the plus slot", () => {
  it("offers Add friends when there are none, and opens the Friends tab", async () => {
    const { openFriends } = await setup([]);
    const add = document.querySelector<HTMLButtonElement>(".friends-bar__slot--add")!;
    expect(add.textContent).toContain("Add friends");
    add.click();
    expect(openFriends).toHaveBeenCalledWith("friends");
  });
});

describe("the card", () => {
  it("has Send gift and Friends list, and no Visit until a visit hook exists", async () => {
    const onGift = vi.fn();
    await setup([friend(1), friend(2)], { onGift });
    slots()[0]!.click();
    const labels = () => [...document.querySelectorAll(".friends-bar__card-button")].map((b) => b.textContent);
    expect(labels()).toEqual(["Send gift", "Friends list"]);
    (document.querySelectorAll(".friends-bar__card-button")[0] as HTMLElement).click();
    expect(onGift).toHaveBeenCalledWith(expect.objectContaining({ userid: 1 }));
    expect(document.querySelector(".friends-bar__card")).toBeNull();
  });

  it("Send gift opens the gift picker, and is off once a gift went today (#375)", async () => {
    await setup([friend(1, { username: "Ann" }), friend(2, { username: "Bo", giftSentToday: true })]);
    const card = () => [...document.querySelectorAll<HTMLButtonElement>(".friends-bar__card-button")];
    slots().find((s) => s.textContent?.includes("Bo"))!.click();
    expect(card()[0]!.textContent).toBe("Gift sent today");
    expect(card()[0]!.disabled).toBe(true);
    slots().find((s) => s.textContent?.includes("Ann"))!.click();
    card()[0]!.click();
    expect(document.querySelector(".gift-picker")?.textContent).toContain("Ann");
  });

  it("hands the friend to onVisit", async () => {
    const onVisit = vi.fn();
    await setup([friend(9, { username: "Vi" })], { onVisit });
    slots()[0]!.click();
    (document.querySelector(".friends-bar__card-button") as HTMLElement).click();
    expect(onVisit).toHaveBeenCalledWith(expect.objectContaining({ userid: 9 }));
  });

  it("closes on a second press of the same portrait", async () => {
    await setup();
    slots()[0]!.click();
    slots()[0]!.click();
    expect(document.querySelector(".friends-bar__card")).toBeNull();
  });
});

describe("destroy", () => {
  it("removes the bar and stops listening", async () => {
    const { bar, store } = await setup();
    bar.destroy();
    expect(document.querySelector(".friends-bar")).toBeNull();
    expect(() => store.addFriend(friend(5))).not.toThrow();
  });
});

describe("the phone's Friends button (#381)", () => {
  const helps = { help: { speedup: true, repair: false } };

  it("counts the friends that can use a hand, else shows a gift while one can be sent", () => {
    expect(friendsBadge([friend(1, helps), friend(2, helps), friend(3)])).toEqual({
      text: "2",
      kind: "help",
      label: "2 can use your help",
    });
    expect(friendsBadge([friend(1, { giftSentToday: true }), friend(2)])).toEqual({
      text: "🎁",
      kind: "gift",
      label: "A gift can be sent",
    });
    expect(friendsBadge([friend(1, { giftSentToday: true })])).toBeNull();
    expect(friendsBadge([])).toBeNull();
    expect(helpNote(1)).toBe("1 can use your help");
  });

  it("wears the badge and the sheet's note, and follows the store", async () => {
    const { store } = await setup([friend(1, helps), friend(2, { giftSentToday: true })]);
    const badge = document.querySelector<HTMLElement>(".friends-bar__count")!;
    const note = document.querySelector(".friends-bar__note")!;
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe("1");
    expect(note.textContent).toBe("1 can use your help");
    expect(document.querySelector(".friends-bar__toggle")?.getAttribute("aria-label")).toBe(
      "Friends. 1 can use your help",
    );

    store.addFriend(friend(3, helps));
    expect(badge.textContent).toBe("2");
  });

  it("opens and shuts the sheet from the button, its close and Esc", async () => {
    await setup();
    const bar = document.querySelector<HTMLElement>(".friends-bar")!;
    const toggle = document.querySelector<HTMLElement>(".friends-bar__toggle")!;

    toggle.click();
    expect(bar.classList.contains("is-open")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    document.querySelector<HTMLElement>(".friends-bar__close")!.click();
    expect(bar.classList.contains("is-open")).toBe(false);

    toggle.click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(bar.classList.contains("is-open")).toBe(false);
  });
});
