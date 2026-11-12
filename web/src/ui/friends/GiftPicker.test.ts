// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/http";
import { fixtureApi, fixtureFriend, fixtureGift, fixtureList } from "@/game/friends/friendsFixture";
import { FriendsStore } from "@/game/friends/friendsStore";
import { setPlayerPool } from "@/game/friends/friendsView";
import { setResourceRealm } from "@/ui/resourceIcon";
import { choiceOrder, GIFT_TEXT, GiftPicker } from "./GiftPicker";

/** The gift picker (issue #375): four resources, one press sends, the store marks the friend. */

const refused = (reason: string): ApiError =>
  new ApiError("refused", { status: 409, details: { message: "refused", status: 409, data: { reason } } });

const setup = async (answers: Parameters<typeof fixtureApi>[0] = {}) => {
  const { api, calls } = fixtureApi({
    list: fixtureList([fixtureFriend(7, { username: "Bob" })]),
    sendGift: fixtureGift(41, 7, { username: "Bob", resource: "r3", amount: 300 }),
    ...answers,
  });
  const store = new FriendsStore({ api });
  await store.refresh();
  const onSent = vi.fn();
  const picker = new GiftPicker({ userid: 7, username: "Bob" }, { api, store, onSent }).mount(document.body);
  return { picker, store, calls, onSent };
};

const choice = (resource: string): HTMLButtonElement =>
  document.querySelector(`.gift-picker__choice[data-resource="${resource}"]`) as HTMLButtonElement;

afterEach(() => document.body.replaceChildren());

describe("the gift picker", () => {
  it("offers Twigs, Pebbles, Putty and Goo", async () => {
    await setup();
    const names = [...document.querySelectorAll(".gift-picker__choice")].map((node) => node.textContent);
    expect(names).toEqual(["Twigs", "Pebbles", "Putty", "Goo"]);
    expect(document.body.textContent).toContain(GIFT_TEXT.lead("Bob"));
  });

  it("offers the main yard's resources even while the player is in the Inferno (gifts land there)", async () => {
    setResourceRealm("inferno");
    try {
      const { picker } = await setup();
      const names = [...document.querySelectorAll(".gift-picker__choice")].map((node) => node.textContent);
      expect(names).toEqual(["Twigs", "Pebbles", "Putty", "Goo"]);
      const realms = [...document.querySelectorAll(".gift-picker__choice .res-icon")].map((icon) => (icon as HTMLElement).dataset["realm"]);
      expect(realms).toEqual(["surface", "surface", "surface", "surface"]);
      await picker.send("r3");
      expect(picker.statusText).toBe("Sent to Bob · Putty 300 lost");
    } finally {
      setResourceRealm("surface");
    }
  });

  it("sends the picked resource, says what went, and marks the friend gifted", async () => {
    const { picker, store, calls, onSent } = await setup();
    await picker.send("r3");
    expect(calls).toContainEqual(["sendGift", 7, "r3"]);
    // A gift sent is a loss: red with a minus (owner, 28 Oct).
    expect(picker.statusText).toBe("Sent to Bob · Putty 300 lost");
    expect(store.friends[0]!.giftSentToday).toBe(true);
    expect(onSent).toHaveBeenCalledOnce();
    expect(choice("r1").disabled).toBe(true);
    await picker.send("r1");
    expect(calls.filter(([method]) => method === "sendGift")).toHaveLength(1);
  });

  it("asks the yard on screen for its resources fresh once a gift went (it came out of storage)", async () => {
    const refresh = vi.fn();
    const clear = setPlayerPool({ read: () => null, refresh });
    try {
      const { picker } = await setup();
      await picker.send("r3");
      expect(refresh).toHaveBeenCalledOnce();
    } finally {
      clear();
    }
  });

  it("says when the player has too little of a resource, and lets them pick another", async () => {
    const refresh = vi.fn();
    const clear = setPlayerPool({ read: () => null, refresh });
    try {
      const { picker, store } = await setup({ sendGift: refused("notEnough") });
      await picker.send("r1");
      expect(picker.statusText).toBe("You don't have enough of that to send. Pick another.");
      expect(choice("r2").disabled).toBe(false);
      expect(store.friends[0]!.giftSentToday).toBe(false);
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      clear();
    }
  });

  it("resolves closed with the gift when it closes", async () => {
    const { picker } = await setup();
    await picker.send("r3");
    picker.popup.close();
    expect(await picker.closed).toMatchObject({ id: 41, amount: 300 });
  });

  it("says a refusal and lets the player try again", async () => {
    const { picker } = await setup({ sendGift: refused("tooNew") });
    await picker.send("r1");
    expect(picker.statusText).toContain("Not yet");
    expect(choice("r2").disabled).toBe(false);
  });

  it("a gift already sent today marks the friend and keeps the choices off", async () => {
    const { picker, store } = await setup({ sendGift: refused("giftSentToday") });
    await picker.send("r1");
    expect(picker.statusText).toBe("You have already sent this friend a gift today.");
    expect(store.friends[0]!.giftSentToday).toBe(true);
    expect(choice("r2").disabled).toBe(true);
  });

  it("puts the friend's wishes first in their order, ranked, the first on the main plate; any resource can still go (#391)", async () => {
    const { calls } = await setup({ list: fixtureList([fixtureFriend(7, { username: "Bob", wishes: ["r4", "r2"] })]) });
    const ids = [...document.querySelectorAll<HTMLElement>("[data-resource]")].map((node) => node.dataset["resource"]);
    expect(ids).toEqual(["r4", "r2", "r1", "r3"]);
    const wished = [...document.querySelectorAll<HTMLElement>(".gift-picker__choice--wished")];
    expect(wished.map((node) => [node.dataset["resource"], node.dataset["rank"]])).toEqual([["r4", "1"], ["r2", "2"]]);
    // The first wish is the main plate, a clearly different colour; the second the usual one.
    expect(choice("r4").classList.contains("btn--primary")).toBe(true);
    expect(choice("r2").classList.contains("btn--outline")).toBe(true);
    // The painted marker with the rank, not a star.
    expect(choice("r4").querySelector(".wish-mark .wish-mark__rank")?.textContent).toBe("1");
    expect(choice("r2").querySelector(".wish-mark__rank")?.textContent).toBe("2");
    expect(document.body.textContent).not.toContain("★");
    expect(choice("r4").getAttribute("aria-label")).toBe("Goo (wish 1)");
    expect(document.querySelector(".gift-picker__legend-main")?.textContent).toBe("Bob's wishes");
    expect(document.querySelector(".gift-picker__legend-hint")?.textContent).toBe(GIFT_TEXT.bestFirst);
    expect(document.querySelector(".gift-picker__legend .wish-mark")).not.toBeNull();
    // The rest are small tiles under "Or send", and still send.
    const others = document.querySelector(".gift-picker__others")!;
    expect(others.textContent).toBe(GIFT_TEXT.others);
    expect([...others.querySelectorAll<HTMLElement>(".gift-picker__other")].map((node) => node.dataset["resource"])).toEqual(["r1", "r3"]);
    expect(others.querySelector(".gift-picker__other")?.getAttribute("aria-label")).toBe("Twigs");
    (others.querySelector('[data-resource="r1"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(calls.some(([method]) => method === "sendGift")).toBe(true));
    expect(calls.find(([method]) => method === "sendGift")).toEqual(["sendGift", 7, "r1"]);
    // Sending turns the small tiles off too.
    expect((others.querySelector('[data-resource="r3"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("says plainly when the friend wants one resource only", async () => {
    const { picker } = await setup({ list: fixtureList([fixtureFriend(7, { username: "Bob", wishes: ["r1"] })]) });
    expect(document.querySelector(".gift-picker__legend")?.textContent).toBe("Bob wants Twigs only");
    // The name on its own, so a long one ends in "…" and the line never wraps.
    expect(document.querySelector(".gift-picker__legend-name")?.textContent).toBe("Bob");
    expect(document.querySelector(".gift-picker__legend-hint")).toBeNull();
    expect(document.querySelectorAll(".gift-picker__choice--wished")).toHaveLength(1);
    expect(choice("r1").classList.contains("gift-picker__choice--top")).toBe(true);
    expect(document.querySelectorAll(".gift-picker__other")).toHaveLength(3);
    // The wished one has the focus, so Enter sends it.
    expect(document.activeElement).toBe(choice("r1"));
    await picker.send("r1");
    expect(picker.statusText).toContain("Sent to Bob");
  });

  it("reads old wishes saved in resource order the same way: that order is the rank", () => {
    expect(choiceOrder(["r2", "r4"])).toEqual(["r2", "r4", "r1", "r3"]);
    expect(choiceOrder(["r3", "r1"])).toEqual(["r3", "r1", "r2", "r4"]);
  });

  it("has no markers, legend or small tiles when the friend wishes for nothing", async () => {
    await setup();
    expect(document.querySelector(".gift-picker__choice--wished")).toBeNull();
    expect(document.querySelector(".gift-picker__legend")).toBeNull();
    expect(document.querySelector(".gift-picker__others")).toBeNull();
    expect(document.querySelector(".wish-mark")).toBeNull();
    expect(choiceOrder([])).toEqual(["r1", "r2", "r3", "r4"]);
  });
});

describe("the choices' look", () => {
  // jsdom applies no stylesheet: the rules are read from the CSS text.
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "friends.css"), "utf8").replace(/\r\n/g, "\n");
  const rule = (selector: string): string => css.split(`\n${selector} {`)[1]?.split("}")[0] ?? "";

  it("keeps a choice's pile and name tight, so they fit inside the plate on a phone", () => {
    expect(rule(".gift-picker__choice")).toMatch(/gap: var\(--space-1\);/);
    expect(rule(":root[data-skin] .panel .gift-picker__choice.btn--outline")).toMatch(/padding-inline: 0;/);
  });

  it("draws Modern's choices a size smaller on a phone, so the pile clears the plate's rivets", () => {
    // Only below the dialog's full 420 px (92vw < 420 px), and only for Modern ("scrap").
    const phone = css.split("\n@media (width <= 456px) {")[1]?.split("\n}\n")[0] ?? "";
    const phoneRule = (selector: string): string => phone.split(`\n  ${selector} {`)[1]?.split("}")[0] ?? "";
    const choice = phoneRule(':root[data-skin="scrap"] .panel .gift-picker__choice.btn--outline');
    expect(choice).toMatch(/font-size: var\(--text-sm\);/);
    expect(choice).toMatch(/gap: 2px;/);
    // Classic and the wide dialog keep the old size.
    expect(rule(".gift-picker__choice")).not.toMatch(/font-size/);
    expect(rule(":root[data-skin] .panel .gift-picker__choice.btn--outline")).not.toMatch(/font-size/);
  });

  it("hangs the painted marker off the plate's corner, out of the flow, so the pile and word stay centred", () => {
    expect(rule(".wish-mark")).toMatch(/background: url\("\/friends\/wish-mark\.webp"\)/);
    expect(rule(".gift-picker__mark")).toMatch(/position: absolute;/);
    expect(rule(".gift-picker__choice--wished")).toMatch(/position: relative;/);
    // On a skin the plate's ends are its border: the marker sits on the right end.
    expect(rule(":root[data-skin] .panel .gift-picker__choice.btn--outline .gift-picker__mark")).toMatch(/var\(--skin-button2-cap\)/);
    expect(rule(":root[data-skin] .panel .gift-picker__choice.btn--primary .gift-picker__mark")).toMatch(/var\(--skin-button-cap\)/);
  });
});
