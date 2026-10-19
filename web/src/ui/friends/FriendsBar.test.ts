// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureApi, fixtureFriend, fixtureList } from "@/game/friends/friendsFixture";
import { FriendsStore } from "@/game/friends/friendsStore";
import { FriendsBar, canHelp, orderFriends, pageOf } from "./FriendsBar";

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
