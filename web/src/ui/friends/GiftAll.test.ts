// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GiftAllResult } from "@/api/friends";
import { ApiError } from "@/api/http";
import { fixtureApi, fixtureFriend, fixtureList, NO_GIFT_ALL } from "@/game/friends/friendsFixture";
import { FriendsStore } from "@/game/friends/friendsStore";
import { GIFT_ALL_TEXT, GiftAll } from "./GiftAll";

/** Gift all (owner, 13 Nov 2026): the plan, the confirm, the send. */

const plan = (extra: Partial<GiftAllResult> = {}): GiftAllResult => ({
  ...NO_GIFT_ALL,
  fallback: "r3",
  gifts: [
    { userid: 1, username: "Ann", resource: "r4", amount: 100, wish: 1 },
    { userid: 2, username: "Bo", resource: "r3", amount: 200, wish: 0 },
  ],
  skipped: [{ userid: 3, username: "Max", reason: "notEnough", lacking: ["r4", "r1"], amount: 100 }],
  cost: { r1: 0, r2: 0, r3: 200, r4: 100 },
  resources: { r1: 50, r2: 0, r3: 9000, r4: 100 },
  ...extra,
});

const setup = async (answers: Parameters<typeof fixtureApi>[0] = {}) => {
  const { api, calls } = fixtureApi({
    list: fixtureList([1, 2, 3].map((id) => fixtureFriend(id))),
    giftAllPlan: plan(),
    ...answers,
  });
  const store = new FriendsStore({ api });
  await store.refresh();
  const onSent = vi.fn();
  const view = new GiftAll({ api, store, onSent }).mount(document.body);
  await vi.waitFor(() => expect(view.statusText).not.toBe(GIFT_ALL_TEXT.loading));
  return { view, store, calls, onSent };
};

const send = () => document.querySelector<HTMLButtonElement>(".gift-all__send")!;
const pick = (key: string) => document.querySelector<HTMLButtonElement>(`.gift-all__pick[data-resource="${key}"]`)!;

afterEach(() => document.body.replaceChildren());

describe("Gift all", () => {
  it("opens on the plan: how many, the cost per resource, each friend's gift and who is left out", async () => {
    const { calls } = await setup();
    expect(calls.filter(([method]) => method === "giftAllPlan")).toEqual([["giftAllPlan", undefined]]);
    expect(document.querySelector(".gift-all__count")?.textContent).toBe("2 friends");
    expect(document.querySelectorAll(".gift-all__cost .res-amount")).toHaveLength(2);
    const rows = [...document.querySelectorAll(".gift-all__row")].map((row) => row.querySelector(".gift-all__name")!.textContent);
    expect(rows).toEqual(["Ann", "Bo"]);
    expect(document.querySelector('.gift-all__row[data-userid="1"] .wish-mark')).not.toBeNull();
    expect(document.querySelector('.gift-all__row[data-userid="2"] .wish-mark')).toBeNull();
    const skip = document.querySelector('.gift-all__skip[data-userid="3"]')!;
    expect(skip.textContent).toContain("Max");
    expect(skip.textContent).toContain(GIFT_ALL_TEXT.notEnough);
    expect(skip.querySelectorAll(".gift-all__lack")).toHaveLength(2);
    expect(send().textContent).toBe(GIFT_ALL_TEXT.send(2));
    expect(send().disabled).toBe(false);
    // The no-wish pick starts on the server's (the most held).
    expect(pick("r3").getAttribute("aria-pressed")).toBe("true");
    // Nothing went yet.
    expect(calls.some(([method]) => method === "giftAll")).toBe(false);
  });

  it("asks again when the no-wish pick changes", async () => {
    const { calls } = await setup();
    pick("r1").click();
    await vi.waitFor(() => expect(calls.filter(([method]) => method === "giftAllPlan")).toHaveLength(2));
    expect(calls.filter(([method]) => method === "giftAllPlan")[1]).toEqual(["giftAllPlan", "r1"]);
  });

  it("sends to the friends shown only, marks them gifted and says who was left out", async () => {
    const sent: GiftAllResult = {
      ...plan(),
      gifts: [plan().gifts[0]!],
      skipped: [{ userid: 2, username: "Bo", reason: "giftSentToday", lacking: [], amount: 200 }],
      cost: { r1: 0, r2: 0, r3: 0, r4: 100 },
    };
    const { view, store, calls, onSent } = await setup({ giftAll: sent });
    await view.send();
    expect(calls.find(([method]) => method === "giftAll")).toEqual(["giftAll", "r3", [1, 2]]);
    expect(store.friends.filter((friend) => friend.giftSentToday).map((friend) => friend.userid)).toEqual([1, 2]);
    expect(document.querySelector(".gift-all__count")?.textContent).toBe(GIFT_ALL_TEXT.sent(1));
    expect(document.querySelector('.gift-all__skip[data-userid="2"]')?.textContent).toContain(GIFT_ALL_TEXT.alreadySent);
    // The plan's own skip is still listed.
    expect(document.querySelector('.gift-all__skip[data-userid="3"]')).not.toBeNull();
    expect(send().hidden).toBe(true);
    expect(onSent).toHaveBeenCalledWith(sent);
    // A second press sends nothing more.
    await view.send();
    expect(calls.filter(([method]) => method === "giftAll")).toHaveLength(1);
  });

  it("says so when nobody can take a gift, and cannot send", async () => {
    await setup({ giftAllPlan: { ...NO_GIFT_ALL } });
    expect(document.body.textContent).toContain(GIFT_ALL_TEXT.none);
    expect(send().disabled).toBe(true);
  });

  it("a refusal is said and Send can be pressed again", async () => {
    const refused = new ApiError("refused", {
      status: 409,
      details: { message: "refused", status: 409, data: { reason: "underAttack" } },
    });
    const { view } = await setup({ giftAll: refused });
    await view.send();
    expect(view.statusText).not.toBe("");
    expect(send().disabled).toBe(false);
  });
});
