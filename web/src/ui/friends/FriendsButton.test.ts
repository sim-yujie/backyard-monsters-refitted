// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureApi, fixtureFriend, fixtureList } from "@/game/friends/friendsFixture";
import { FriendsStore } from "@/game/friends/friendsStore";
import { FRIENDS_BUTTON_GAP, FriendsButton, friendsBadge, friendsButtonLeft, helpNote, type FriendsButtonOptions } from "./FriendsButton";

/** The round Friends button beside Map (owner, 9 Nov 2026, option A), on every screen size. */

const friend = fixtureFriend;
const helps = { help: { speedup: true, repair: false } };

const setup = async (friends = [friend(1), friend(2)], options: FriendsButtonOptions = {}) => {
  const store = new FriendsStore({ api: fixtureApi({ list: fixtureList(friends) }).api });
  await store.refresh();
  const modal = document.createElement("div");
  modal.className = "overlay__layer--modal";
  document.body.append(modal);
  const button = new FriendsButton({ store, modal, openFriends: vi.fn(), ...options }).mount(document.body);
  return { store, button, modal };
};

const badge = () => document.querySelector<HTMLElement>(".friends-button__badge")!;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("the badge", () => {
  it("counts the friends that can use a hand, else shows a gift while one can be sent", () => {
    expect(friendsBadge([friend(1, helps), friend(2, helps), friend(3)])).toEqual({
      kind: "help",
      text: "2",
      label: "2 can use your help",
    });
    expect(friendsBadge([friend(1, { giftSentToday: true }), friend(2)])).toEqual({
      kind: "gift",
      text: "",
      label: "A gift can be sent",
    });
    expect(friendsBadge([friend(1, { giftSentToday: true })])).toBeNull();
    expect(friendsBadge([])).toBeNull();
    expect(helpNote(1)).toBe("1 can use your help");
    const many = Array.from({ length: 120 }, (_, i) => friend(i + 1, helps));
    expect(friendsBadge(many)?.text).toBe("99+");
  });

  it("wears the count, its words, and follows the store", async () => {
    const { store } = await setup([friend(1, helps), friend(2, { giftSentToday: true })]);
    expect(badge().hidden).toBe(false);
    expect(badge().textContent).toBe("1");
    const button = document.querySelector<HTMLElement>(".friends-button")!;
    expect(button.getAttribute("aria-label")).toBe("Friends. 1 can use your help");
    store.addFriend(friend(3, helps));
    expect(badge().textContent).toBe("2");
  });

  it("wears the painted gift, not an emoji, when only a gift is due; nothing when nothing is", async () => {
    const { store } = await setup([friend(1), friend(2, { giftSentToday: true })]);
    expect(badge().hidden).toBe(false);
    expect(badge().classList.contains("friends-button__badge--gift")).toBe(true);
    expect(badge().querySelector<HTMLImageElement>("img.game-icon")?.dataset["icon"]).toBe("gift");
    expect(badge().textContent).toBe("");
    store.removeFriend(1);
    expect(badge().hidden).toBe(true);
    expect(document.querySelector(".friends-button")!.getAttribute("aria-label")).toBe("Friends");
  });
});

describe("the button", () => {
  it("is a dock disc with its painted picture and word, like Monsters", async () => {
    await setup();
    const button = document.querySelector<HTMLButtonElement>("button.yard-dock__button.friends-button")!;
    expect(button.querySelector(".yard-dock__disc > svg")).toBeNull();
    expect(button.querySelector<HTMLImageElement>(".yard-dock__disc > img.yard-dock__picture")!.src).toContain("ui/icons/friends-64.webp");
    expect(button.querySelector(".yard-dock__label")!.textContent).toBe("Friends");
    expect(button.dataset["dock"]).toBe("friends");
  });

  it("opens the Friends window in the modal layer, and a second press closes it", async () => {
    const { modal } = await setup();
    const button = document.querySelector<HTMLButtonElement>(".friends-button")!;
    button.click();
    expect(modal.querySelector(".popup-backdrop > .friends-window")).not.toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    button.click();
    expect(modal.querySelector(".friends-window")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens once only, and can open again after the window closed itself", async () => {
    const { button, modal } = await setup();
    const first = button.open();
    expect(button.open()).toBe(first);
    expect(modal.querySelectorAll(".friends-window")).toHaveLength(1);
    first.close();
    expect(document.querySelector(".friends-button")!.getAttribute("aria-expanded")).toBe("false");
    button.open();
    expect(modal.querySelectorAll(".friends-window")).toHaveLength(1);
  });

  it("passes the visit hook through to the window's rows", async () => {
    const onVisit = vi.fn();
    const { button } = await setup([friend(7, { username: "Vi" })], { onVisit });
    button.open();
    document.querySelector<HTMLButtonElement>(".friends-window__row")!.click();
    document.querySelector<HTMLButtonElement>(".friends-window__action")!.click();
    expect(onVisit).toHaveBeenCalledWith(expect.objectContaining({ userid: 7 }));
  });

  it("loses its focus ring when a window it opened by mouse closes", async () => {
    const { modal } = await setup();
    const button = document.querySelector<HTMLButtonElement>(".friends-button")!;
    button.focus();
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(modal.querySelector(".friends-window")).not.toBeNull();
    modal.querySelector<HTMLButtonElement>('.friends-window .btn[aria-label^="Close"]')!.click();
    await Promise.resolve();
    expect(document.activeElement).not.toBe(button);
  });

  it("keeps its focus when the window was opened from the keyboard", async () => {
    const { modal } = await setup();
    const button = document.querySelector<HTMLButtonElement>(".friends-button")!;
    button.focus();
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    modal.querySelector<HTMLButtonElement>('.friends-window .btn[aria-label^="Close"]')!.click();
    await Promise.resolve();
    expect(document.activeElement).toBe(button);
  });
});

describe("its place", () => {
  const box = (left: number, width: number): DOMRect => new DOMRect(left, 0, width, 40);

  it("starts the gap's width past the corner button's box, word included", () => {
    expect(friendsButtonLeft(box(0, 800), box(24, 68))).toBe(24 + 68 + FRIENDS_BUTTON_GAP);
    expect(friendsButtonLeft(box(10, 800), box(34, 75.4))).toBe(Math.round(34 + 75.4 - 10 + FRIENDS_BUTTON_GAP));
  });

  it("leaves the CSS place while the corner button is not on screen", () => {
    expect(friendsButtonLeft(box(0, 800), null)).toBeNull();
    expect(friendsButtonLeft(box(0, 800), box(0, 0))).toBeNull();
  });
});

describe("destroy", () => {
  it("removes the button, closes the window and stops listening", async () => {
    const { button, store } = await setup();
    button.open();
    button.destroy();
    expect(document.querySelector(".friends-button")).toBeNull();
    expect(document.querySelector(".friends-window")).toBeNull();
    expect(() => store.addFriend(friend(5))).not.toThrow();
  });
});
