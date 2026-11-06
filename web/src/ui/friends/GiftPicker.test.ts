// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/http";
import { fixtureApi, fixtureFriend, fixtureGift, fixtureList } from "@/game/friends/friendsFixture";
import { FriendsStore } from "@/game/friends/friendsStore";
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

  it("puts the friend's wishes first, starred, with a legend; any resource can still go (#391)", async () => {
    const { calls } = await setup({ list: fixtureList([fixtureFriend(7, { username: "Bob", wishes: ["r4", "r2"] })]) });
    const ids = [...document.querySelectorAll<HTMLElement>(".gift-picker__choice")].map((node) => node.dataset["resource"]);
    expect(ids).toEqual(["r2", "r4", "r1", "r3"]);
    const starred = [...document.querySelectorAll<HTMLElement>(".gift-picker__choice--wished")].map((node) => node.dataset["resource"]);
    expect(starred).toEqual(["r2", "r4"]);
    expect(choice("r2").querySelector(".gift-picker__star")?.textContent).toBe("★");
    expect(choice("r1").querySelector(".gift-picker__star")).toBeNull();
    expect(document.querySelector(".gift-picker__legend")?.textContent).toBe(GIFT_TEXT.wished("Bob"));
    // The legend's star is the buttons' gold one.
    expect(document.querySelector(".gift-picker__legend .gift-picker__star")?.textContent).toBe("★");
    choice("r1").click();
    await vi.waitFor(() => expect(calls.some(([method]) => method === "sendGift")).toBe(true));
    expect(calls.find(([method]) => method === "sendGift")).toEqual(["sendGift", 7, "r1"]);
  });

  it("has no stars or legend when the friend wishes for nothing", async () => {
    await setup();
    expect(document.querySelector(".gift-picker__choice--wished")).toBeNull();
    expect(document.querySelector(".gift-picker__legend")).toBeNull();
    expect(choiceOrder([])).toEqual(["r1", "r2", "r3", "r4"]);
  });
});

describe("the choices' look", () => {
  // jsdom applies no stylesheet: the rules are read from the CSS text.
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "friends.css"), "utf8").replace(/\r\n/g, "\n");
  const rule = (selector: string): string => css.split(`\n${selector} {`)[1]?.split("}")[0] ?? "";

  it("keeps a choice's pile, name and star tight, so they fit inside the plate on a phone", () => {
    expect(rule(".gift-picker__choice")).toMatch(/gap: var\(--space-1\);/);
    expect(rule(":root[data-skin] .panel .gift-picker__choice.btn--outline")).toMatch(/padding-inline: 0;/);
  });

  it("draws Modern's choices a size smaller on a phone, so the pile and star clear the plate's rivets", () => {
    // Only below the dialog's full 420 px (92vw < 420 px), and only for Modern ("scrap").
    const phone = css.split("\n@media (width <= 456px) {")[1]?.split("\n}\n")[0] ?? "";
    const phoneRule = (selector: string): string => phone.split(`\n  ${selector} {`)[1]?.split("}")[0] ?? "";
    const choice = phoneRule(':root[data-skin="scrap"] .panel .gift-picker__choice.btn--outline');
    expect(choice).toMatch(/font-size: var\(--text-sm\);/);
    expect(choice).toMatch(/gap: 2px;/);
    expect(phoneRule(':root[data-skin="scrap"] .panel .gift-picker__choice .gift-picker__star')).toMatch(/font-size: 1em;/);
    // Classic and the wide dialog keep the old size.
    expect(rule(".gift-picker__choice")).not.toMatch(/font-size/);
    expect(rule(":root[data-skin] .panel .gift-picker__choice.btn--outline")).not.toMatch(/font-size/);
  });
});
