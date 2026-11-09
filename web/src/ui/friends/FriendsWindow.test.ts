// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { canHelp } from "@/game/friends/friendText";
import { fixtureApi, fixtureFriend, fixtureList } from "@/game/friends/friendsFixture";
import { FriendsStore } from "@/game/friends/friendsStore";
import { FRIENDS_WINDOW_TEXT, groupFriends, openFriendsWindow, orderFriends, type FriendsWindowOptions } from "./FriendsWindow";

/** The Friends window (owner, 9 Nov 2026, option A): a centred game window in place of the bar. */

const friend = fixtureFriend;
const helps = { help: { speedup: true, repair: false } };

const setup = async (
  friends = [friend(1), friend(2)],
  options: FriendsWindowOptions = {},
  listExtra: Parameters<typeof fixtureList>[1] = {},
) => {
  const store = new FriendsStore({ api: fixtureApi({ list: fixtureList(friends, listExtra) }).api });
  await store.refresh();
  const openFriends = vi.fn();
  const view = openFriendsWindow(document.body, { store, openFriends, ...options });
  return { store, view, openFriends };
};

const items = () => [...document.querySelectorAll<HTMLElement>(".friends-window__item")];
const names = () => items().map((item) => item.querySelector(".friends-window__name")!.textContent);
const row = (name: string) =>
  items()
    .find((item) => item.querySelector(".friends-window__name")!.textContent === name)!
    .querySelector<HTMLButtonElement>(".friends-window__row")!;
const actions = () => [...document.querySelectorAll<HTMLButtonElement>(".friends-window__action")];

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("ordering and groups", () => {
  it("puts those who can use help first, then online, then the higher level", () => {
    const list = [
      friend(1, { username: "Low", level: 3 }),
      friend(2, { username: "High", level: 40 }),
      friend(3, { username: "On", level: 5, online: "online" }),
      friend(4, { username: "Help", level: 1, ...helps }),
    ];
    expect(orderFriends(list).map((f) => f.username)).toEqual(["Help", "On", "High", "Low"]);
  });

  it("puts pinned friends before everyone, in the order they were pinned (beta 7)", () => {
    const list = [
      friend(1, { username: "Help", level: 1, ...helps }),
      friend(2, { username: "Late", level: 2, pinnedAt: 900 }),
      friend(3, { username: "On", level: 5, online: "online" }),
      friend(4, { username: "Early", level: 1, pinnedAt: 100 }),
    ];
    expect(orderFriends(list).map((f) => f.username)).toEqual(["Early", "Late", "Help", "On"]);
  });

  it("does not count a help with nothing to do", () => {
    expect(canHelp(friend(1, { help: { speedup: false, repair: false } }))).toBe(false);
    expect(canHelp(friend(1))).toBe(false);
  });

  it("splits into can help, online and everyone else, each friend once, pinned first inside a group", () => {
    const groups = groupFriends([
      friend(1, { username: "Rest", level: 9 }),
      friend(2, { username: "OnHelp", online: "online", ...helps }),
      friend(3, { username: "On", online: "online" }),
      friend(4, { username: "PinnedOn", online: "online", pinnedAt: 5 }),
      friend(5, { username: "Seen", online: "today", level: 2 }),
    ]);
    const words = (list: readonly { username: string }[]) => list.map((f) => f.username);
    expect(words(groups.help)).toEqual(["OnHelp"]);
    expect(words(groups.online)).toEqual(["PinnedOn", "On"]);
    expect(words(groups.rest)).toEqual(["Rest", "Seen"]);
  });
});

describe("the window", () => {
  it("is the game's centred modal window, titled Friends", async () => {
    await setup();
    const panel = document.querySelector<HTMLElement>(".popup-backdrop > .panel.friends-window")!;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.querySelector(".panel__title")!.textContent).toBe("Friends");
  });

  it("shows the friend count and how many are online in the head", async () => {
    await setup([friend(1, { online: "online" }), friend(2, { online: "online" }), friend(3)]);
    const total = document.querySelector<HTMLElement>(".friends-window__count--total")!;
    const online = document.querySelector<HTMLElement>(".friends-window__count--online")!;
    expect(total.textContent).toBe("3");
    expect(total.getAttribute("aria-label")).toBe("3 friends");
    expect(total.querySelector("img.game-icon--friends")).not.toBeNull();
    expect(online.textContent).toBe("2");
    expect(online.getAttribute("aria-label")).toBe("2 online");
  });

  it("lists the groups under their headings with their counts", async () => {
    await setup([
      friend(1, { username: "Ann", level: 12, ...helps }),
      friend(2, { username: "Bo", online: "online" }),
      friend(3, { username: "Cy" }),
      friend(4, { username: "Di", level: 1 }),
    ]);
    const headings = [...document.querySelectorAll(".friends-window__group")].map((h) => h.textContent);
    expect(headings).toEqual(["1Can use help", "1Online", "2Everyone else"]);
    expect(names()).toEqual(["Ann", "Bo", "Cy", "Di"]);
    expect(document.querySelector(".friends-window__group--help img.game-icon--tools")).not.toBeNull();
    // Every heading leads with its picture, so the three line up (tester, 9 Nov).
    expect(document.querySelector(".friends-window__group--rest > .friends-window__dot--off:first-child")).not.toBeNull();
  });

  it("leaves out an empty group", async () => {
    await setup([friend(1, { username: "Cy" })]);
    expect([...document.querySelectorAll(".friends-window__group")].map((h) => h.textContent)).toEqual([
      "1Everyone else",
    ]);
  });

  it("shows each row's level, online dot and painted help and gift marks, no emoji", async () => {
    await setup([
      friend(1, { username: "Ann", level: 12, online: "online", giftSentToday: false, ...helps }),
      friend(2, { username: "Bo", online: "today", giftSentToday: true }),
    ]);
    const [ann, bo] = items();
    expect(ann!.querySelector(".friends-window__level")!.textContent).toBe("Lv 12");
    expect(ann!.querySelector(".online-dot")).not.toBeNull();
    const marks = [...ann!.querySelectorAll<HTMLImageElement>(".friends-window__mark")];
    expect(marks.map((m) => m.dataset["icon"])).toEqual(["tools", "gift"]);
    expect(marks.map((m) => m.getAttribute("aria-label"))).toEqual(["Can use your help today", "No gift sent today"]);
    expect(bo!.querySelector(".online-dot")).toBeNull();
    expect(bo!.querySelector(".friends-window__mark")).toBeNull();
    expect(document.querySelector(".friends-window")!.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("marks a pinned friend with the gold frame, a pin and its tooltip", async () => {
    await setup([friend(1, { username: "Pin", pinnedAt: 10 }), friend(2, { username: "Free" })]);
    const [pinned, free] = items();
    expect(pinned!.classList.contains("friends-window__item--pinned")).toBe(true);
    expect(pinned!.querySelector(".friends-window__face")!.getAttribute("title")).toBe(FRIENDS_WINDOW_TEXT.pinned);
    const pin = pinned!.querySelector<HTMLImageElement>(".friends-window__face > .friends-window__pin")!;
    expect(pin.dataset["icon"]).toBe("pin");
    expect(pin.getAttribute("aria-label")).toBe(FRIENDS_WINDOW_TEXT.pinned);
    expect(free!.querySelector(".friends-window__pin")).toBeNull();
  });

  it("gives Add, the friend count and the requests a picture each", async () => {
    await setup([friend(1)], {}, { requestsIn: 2 });
    const icon = (selector: string) => document.querySelector<HTMLImageElement>(`${selector} img.game-icon`)!.dataset["icon"];
    expect(icon(".friends-window__count--total")).toBe("friends");
    expect(icon(".friends-window__add")).toBe("addfriend");
    expect(icon(".friends-window__requests")).toBe("mail");
  });

  it("marks the list for its scroll fades", async () => {
    await setup();
    expect(document.querySelector(".friends-window > .panel__body")!.classList.contains("scroll-fade")).toBe(true);
  });

  it("follows the store while open", async () => {
    const { store } = await setup([friend(1, { username: "Ann" })]);
    store.addFriend(friend(2, { username: "Zed", level: 99 }));
    expect(names()).toEqual(["Zed", "Ann"]);
    store.removeFriend(1);
    expect(names()).toEqual(["Zed"]);
  });

  it("says so when there are no friends, and Add still opens Find", async () => {
    const { openFriends } = await setup([]);
    expect(document.querySelector(".friends-window__empty")!.textContent).toBe(FRIENDS_WINDOW_TEXT.empty);
    document.querySelector<HTMLButtonElement>(".friends-window__add")!.click();
    expect(openFriends).toHaveBeenCalledWith("find");
    expect(document.querySelector(".friends-window")).toBeNull();
  });
});

describe("a row's actions", () => {
  it("shows Visit, Message and Send gift under the row pressed, one row at a time", async () => {
    await setup([friend(1, { username: "Ann" }), friend(2, { username: "Bo" })], {
      onVisit: vi.fn(),
      onMessage: vi.fn(),
    });
    expect(actions()).toHaveLength(0);
    row("Ann").click();
    expect(actions().map((b) => b.textContent)).toEqual(["Visit", "Message", "Send gift"]);
    expect(row("Ann").getAttribute("aria-expanded")).toBe("true");
    row("Bo").click();
    expect(actions()).toHaveLength(3);
    expect(items()[1]!.classList.contains("is-open")).toBe(true);
    expect(items()[0]!.classList.contains("is-open")).toBe(false);
    row("Bo").click();
    expect(actions()).toHaveLength(0);
  });

  it("has no Visit or Message until their hooks exist", async () => {
    await setup([friend(1, { username: "Ann" })]);
    row("Ann").click();
    expect(actions().map((b) => b.textContent)).toEqual(["Send gift"]);
  });

  it("hands the friend to onVisit and closes", async () => {
    const onVisit = vi.fn();
    await setup([friend(9, { username: "Vi" })], { onVisit });
    row("Vi").click();
    actions()[0]!.click();
    expect(onVisit).toHaveBeenCalledWith(expect.objectContaining({ userid: 9 }));
    expect(document.querySelector(".friends-window")).toBeNull();
  });

  it("hands the friend to onMessage and closes", async () => {
    const onMessage = vi.fn();
    await setup([friend(9, { username: "Vi" })], { onVisit: vi.fn(), onMessage });
    row("Vi").click();
    actions()[1]!.click();
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ userid: 9 }));
    expect(document.querySelector(".friends-window")).toBeNull();
  });

  it("Send gift opens the gift picker, and is off once a gift went today (#375)", async () => {
    await setup([friend(1, { username: "Ann" }), friend(2, { username: "Bo", giftSentToday: true })]);
    row("Bo").click();
    expect(actions()[0]!.textContent).toBe("Sent");
    expect(actions()[0]!.title).toBe("Gift sent today");
    expect(actions()[0]!.disabled).toBe(true);
    row("Ann").click();
    actions()[0]!.click();
    expect(document.querySelector(".friends-window")).toBeNull();
    expect(document.querySelector(".gift-picker")?.textContent).toContain("Ann");
  });

  it("hands the friend to onGift when given", async () => {
    const onGift = vi.fn();
    await setup([friend(3, { username: "Gi" })], { onGift });
    row("Gi").click();
    actions()[0]!.click();
    expect(onGift).toHaveBeenCalledWith(expect.objectContaining({ userid: 3 }));
  });
});

describe("the foot", () => {
  it("All friends opens the Friends screen and closes the window", async () => {
    const { openFriends } = await setup();
    const all = document.querySelector<HTMLButtonElement>(".friends-window__all")!;
    expect(all.textContent).toBe("All friends ›");
    all.click();
    expect(openFriends).toHaveBeenCalledWith("friends");
    expect(document.querySelector(".friends-window")).toBeNull();
  });

  it("shows the requests waiting, which open the Requests tab; none, no button", async () => {
    const { openFriends } = await setup([friend(1)], {}, { requestsIn: 2 });
    const requests = document.querySelector<HTMLButtonElement>(".friends-window__requests")!;
    expect(requests.hidden).toBe(false);
    expect(requests.textContent).toBe("2");
    expect(requests.getAttribute("aria-label")).toBe("2 friend requests waiting");
    requests.click();
    expect(openFriends).toHaveBeenCalledWith("requests");

    await setup([friend(1)]);
    expect(document.querySelector<HTMLButtonElement>(".friends-window__requests")!.hidden).toBe(true);
  });
});

describe("closing", () => {
  it("closes on Escape and on its close disc, and tells onClose", async () => {
    const onClose = vi.fn();
    await setup(undefined, { onClose });
    document
      .querySelector(".popup-backdrop")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".friends-window")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);

    await setup();
    document.querySelector<HTMLButtonElement>(".friends-window .panel__titlebar button[aria-label='Close']")!.click();
    expect(document.querySelector(".friends-window")).toBeNull();
  });

  it("closes on a click outside, and stops following the store", async () => {
    const { store } = await setup();
    const backdrop = document.querySelector<HTMLElement>(".popup-backdrop")!;
    backdrop.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(document.querySelector(".friends-window")).toBeNull();
    expect(() => store.addFriend(friend(5))).not.toThrow();
    expect(document.querySelector(".friends-window__item")).toBeNull();
  });
});
