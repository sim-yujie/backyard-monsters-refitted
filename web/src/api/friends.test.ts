import { afterEach, describe, expect, it, vi } from "vitest";
import { dayText } from "@/game/mail/mailbox";
import {
  friendRefusal,
  friendsApi,
  GENERAL_REFUSAL,
  NETWORK_REFUSAL,
  REFUSAL_TEXT,
  toSeconds,
  tooNewText,
  type FriendRefusalReason,
} from "./friends";
import { ApiError, NetworkError } from "./http";

/** The friends routes as the screens call them (design §6.2, issue #370). */

interface Call {
  url: string;
  method: string;
  contentType: string | null;
  json: Record<string, unknown> | null;
}

const calls: Call[] = [];

const stubFetch = (answer: unknown, status = 200): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      const contentType = headers.get("Content-Type");
      calls.push({
        url,
        method: init.method ?? "GET",
        contentType,
        json: contentType === "application/json" ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      });
      return Promise.resolve(new Response(JSON.stringify(answer), { status }));
    }),
  );
};

/** A friends route's refusal as the server sends it: a ClientSafeError's 409 with `data.reason`. */
const refusal = (reason: string, extra: Record<string, unknown> = {}): unknown => ({
  error: "refused",
  errorDetails: { message: "refused", status: 409, data: { reason, ...extra } },
});

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe("friendsApi reads", () => {
  it("reads the list with its counts, checking every field", async () => {
    stubFetch({
      error: 0,
      max: 100,
      requestsIn: 2,
      giftsWaiting: 1,
      helpsLeft: 17,
      friends: [
        {
          userid: 7,
          username: "Bob",
          pic: "/avatars/pokey.webp",
          level: 12,
          online: "today",
          since: "2026-10-18T10:00:00.000Z",
          giftSentToday: true,
          canGiftFrom: null,
          help: null,
        },
        { userid: "9", online: "sometimes", help: { speedup: true, repair: 0 } },
      ],
    });
    const list = await friendsApi.list();
    expect(calls[0]).toMatchObject({ method: "GET" });
    expect(calls[0]?.url).toMatch(/\/api\/[^/]+\/bm\/friends$/);
    expect(list).toMatchObject({ max: 100, requestsIn: 2, giftsWaiting: 1, helpsLeft: 17 });
    expect(list.friends[0]).toEqual({
      userid: 7,
      username: "Bob",
      pic: "/avatars/pokey.webp",
      level: 12,
      online: "today",
      since: Math.floor(Date.parse("2026-10-18T10:00:00.000Z") / 1000),
      giftSentToday: true,
      canGiftFrom: null,
      help: null,
    });
    // A row with missing or odd fields still draws.
    expect(list.friends[1]).toMatchObject({
      userid: 9,
      username: "A player",
      pic: null,
      level: 0,
      online: null,
      giftSentToday: false,
      help: { speedup: true, repair: false },
    });
  });

  it("falls back to 100 friends when the answer has no cap", async () => {
    stubFetch({ error: 0, friends: [] });
    expect((await friendsApi.list()).max).toBe(100);
  });

  it("reads requests both ways", async () => {
    stubFetch({
      error: 0,
      incoming: [{ requestid: 3, userid: 7, username: "Bob", level: 4, at: 1_760_000_000 }],
      outgoing: [{ requestid: 4, userid: 8, username: "Cat", at: "2026-10-19T00:00:00Z" }],
    });
    const { incoming, outgoing } = await friendsApi.requests();
    expect(calls[0]?.url).toMatch(/\/bm\/friends\/requests$/);
    expect(incoming).toEqual([{ id: 3, userid: 7, username: "Bob", pic: null, level: 4, status: "pending", createdAt: 1_760_000_000, expiresAt: null }]);
    expect(outgoing[0]).toMatchObject({ id: 4, userid: 8, createdAt: Math.floor(Date.parse("2026-10-19T00:00:00Z") / 1000) });
  });

  it("searches with q and reads each player's relation", async () => {
    stubFetch({
      error: 0,
      results: [
        { userid: 7, username: "Bob", level: 3, relation: "asked" },
        { userid: 8, username: "Bobby", level: 3, relation: "weird" },
      ],
    });
    const found = await friendsApi.search("  Bob ");
    expect(calls[0]?.url).toMatch(/\/bm\/friends\/search\?q=Bob$/);
    expect(found.map((one) => one.relation)).toEqual(["asked", "none"]);
  });

  it("does not ask the server for a search under 3 letters", async () => {
    stubFetch({ error: 0, results: [{ userid: 1 }] });
    expect(await friendsApi.search("Bo")).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("reads suggestions from the suggestions route", async () => {
    stubFetch({ error: 0, results: [{ userid: 5, username: "Mate", level: 9, relation: "none" }] });
    expect(await friendsApi.suggestions()).toEqual([{ userid: 5, username: "Mate", pic: null, level: 9, relation: "none" }]);
    expect(calls[0]?.url).toMatch(/\/bm\/friends\/suggestions$/);
  });

  it("reads gifts and the blocked list", async () => {
    stubFetch({ error: 0, collectsLeft: 4, gifts: [{ id: 1, userid: 7, username: "Bob", resource: "r3", amount: 1200 }] });
    expect(await friendsApi.gifts()).toMatchObject({
      collectsLeft: 4,
      gifts: [{ id: 1, userid: 7, resource: "r3", amount: 1200 }],
    });
    stubFetch({ error: 0, blocked: [{ userid: 9, username: "Grump" }] });
    expect(await friendsApi.blocked()).toEqual([{ userid: 9, username: "Grump" }]);
    expect(calls[1]?.url).toMatch(/\/player\/blocked$/);
  });
});

describe("friendsApi writes", () => {
  it("sends every POST as JSON, booleans kept as booleans", async () => {
    stubFetch({ error: 0, request: { id: 11, userid: 7, username: "Bob" } });
    expect((await friendsApi.request({ username: " Bob " })).request).toMatchObject({ id: 11, userid: 7 });
    await friendsApi.request({ userid: 7 });

    stubFetch({ error: 0, friend: { userid: 7, username: "Bob", level: 2 } });
    expect(await friendsApi.answer(11, true)).toMatchObject({ userid: 7, level: 2 });
    stubFetch({ error: 0 });
    expect(await friendsApi.answer(12, false)).toBeNull();
    await friendsApi.cancel(13);
    await friendsApi.remove(7);
    await friendsApi.block(9);
    await friendsApi.unblock(9);

    expect(calls.map((call) => [call.url.replace(/^.*\/api\/[^/]+/, ""), call.json])).toEqual([
      ["/bm/friends/request", { username: "Bob" }],
      ["/bm/friends/request", { userid: 7 }],
      ["/bm/friends/request/answer", { requestid: 11, accept: true }],
      ["/bm/friends/request/answer", { requestid: 12, accept: false }],
      ["/bm/friends/request/cancel", { requestid: 13 }],
      ["/bm/friends/remove", { userid: 7 }],
      ["/player/block", { userid: 9 }],
      ["/player/unblock", { userid: 9 }],
    ]);
    expect(calls.every((call) => call.method === "POST" && call.contentType === "application/json")).toBe(true);
  });

  it("sends a gift, collects one or all, and reads what came back", async () => {
    stubFetch({ error: 0, gift: { id: 5, userid: 7, resource: "r2", amount: 300 } });
    expect(await friendsApi.sendGift(7, "r2")).toMatchObject({ id: 5, resource: "r2", amount: 300 });
    stubFetch({ error: 0, collected: 2, resources: { r1: 100, r2: "50", r3: -1 }, collectsLeft: 3, giftsWaiting: 1 });
    expect(await friendsApi.collect("all")).toEqual({ collected: 2, resources: { r1: 100, r2: 50 }, collectsLeft: 3, giftsWaiting: 1 });
    await friendsApi.collect(5);
    expect(calls.map((call) => call.json)).toEqual([{ userid: 7, resource: "r2" }, { all: true }, { giftid: 5 }]);
  });

  it("helps and reads the result", async () => {
    stubFetch({ error: 0, secondsSaved: 390, reward: { r1: 10, r2: 10, r3: 10, r4: 10 }, helpsLeft: 16, building: { id: 4 } });
    expect(await friendsApi.help(7, 4, "speedup")).toEqual({
      secondsSaved: 390,
      reward: { r1: 10, r2: 10, r3: 10, r4: 10 },
      helpsLeft: 16,
      building: { id: 4 },
    });
    expect(calls[0]?.json).toEqual({ userid: 7, buildingId: 4, kind: "speedup" });
  });

  it("loads a friend's yard in help mode", async () => {
    stubFetch({ error: 0, help: { helpsLeft: 3, buildings: { "4": { speedup: true, repair: "nothingToHelp" } } } });
    const yard = await friendsApi.loadHelpYard("1234");
    expect(calls[0]?.url).toMatch(/\/base\/load$/);
    expect(calls[0]?.json).toMatchObject({ type: "help", baseid: "1234" });
    expect(yard.help?.buildings["4"]).toEqual({ speedup: true, repair: "nothingToHelp" });
  });

  it("changes privacy settings with only the fields given", async () => {
    stubFetch({ error: 0, settings: { shinyLocked: false, hideOnline: true, friendRequests: false } });
    expect(await friendsApi.setPrivacy({ hideOnline: true })).toEqual({ hideOnline: true, friendRequests: false });
    expect(calls[0]?.url).toMatch(/\/player\/settings$/);
    expect(calls[0]?.json).toEqual({ hideOnline: true });
  });
});

describe("friendRefusal", () => {
  const reasons = Object.keys(REFUSAL_TEXT) as FriendRefusalReason[];

  it("has plain words for every reason in the contract", () => {
    for (const reason of [
      "friendLimit",
      "theirFriendLimit",
      "requestLimit",
      "alreadyFriends",
      "alreadyRequested",
      "requestsOff",
      "declinedRecently",
      "cannotSend",
      "tooNew",
      "dailyCap",
      "giftSentToday",
      "collectLimit",
      "notFriends",
      "helpersFull",
      "alreadyHelped",
      "nothingToHelp",
      "underAttack",
    ]) {
      expect(reasons).toContain(reason);
    }
    for (const words of Object.values(REFUSAL_TEXT)) {
      expect(words).toMatch(/^[A-Z].*[.!]$/);
      expect(words.toLowerCase()).not.toContain("bot");
    }
  });

  it("reads the reason a refused call carries", async () => {
    stubFetch(refusal("requestsOff"), 409);
    const caught = await friendsApi.request({ userid: 7 }).catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(ApiError);
    expect(friendRefusal(caught)).toEqual({ reason: "requestsOff", message: "This player isn't taking friend requests." });
  });

  it("reads a reason on the body too, and tooNew's from", () => {
    const error = new ApiError("no", { status: 409, body: { reason: "tooNew", from: "2026-10-20T00:00:00Z" } });
    expect(friendRefusal(error)).toEqual({
      reason: "tooNew",
      message: REFUSAL_TEXT.tooNew,
      from: Math.floor(Date.parse("2026-10-20T00:00:00Z") / 1000),
    });
  });

  it("says which gate holds a tooNew and how long is left", () => {
    const now = Math.floor(Date.now() / 1000);
    const refused = (body: Record<string, unknown>) => friendRefusal(new ApiError("no", { status: 409, body }));
    // Friends 7 hours of the 12: about 5 hours to go.
    const friendship = refused({ reason: "tooNew", from: now + 5 * 3600 - 30, rule: "friendship" });
    expect(friendship).toMatchObject({ reason: "tooNew", rule: "friendship", from: now + 5 * 3600 - 30 });
    expect(friendship.message).toMatch(/^Opens in 4h 59m|^Opens in 5h 0m/);
    expect(friendship.message).toContain("(friends for 12 hours first)");
    // An account 2 days old: a day and a bit to go.
    const account = refused({ reason: "tooNew", from: now + 28 * 3600 + 120, rule: "account" });
    expect(account.message).toBe("Opens in 1d 4h (accounts must be 3 days old).");
    expect(refused({ reason: "tooNew", rule: "level" }).message).toBe("Not yet: each player must be level 5.");
    // An older server with no rule: still the time left; an unknown rule is dropped.
    expect(refused({ reason: "tooNew", from: now + 600 + 30 }).message).toMatch(/^Opens in 10m \d+s\.$/);
    expect(refused({ reason: "tooNew", rule: "moon" })).toEqual({ reason: "tooNew", message: REFUSAL_TEXT.tooNew });
    expect(REFUSAL_TEXT.tooNew).toBe("Not yet: friends for 12 hours, accounts 3 days old, each player level 5.");
  });

  it("tooNewText: a gate whose time has passed is named without a countdown", () => {
    expect(tooNewText({ from: 1000, rule: "friendship" }, 2000)).toBe("Not yet: friends for 12 hours first.");
    expect(tooNewText({ from: 1000 + 12 * 3600, rule: "friendship" }, 1000)).toBe("Opens in 12h 0m (friends for 12 hours first).");
    expect(tooNewText({}, 1000)).toBe(REFUSAL_TEXT.tooNew);
  });

  it("names the day a declined request can be asked again", () => {
    const from = "2026-10-20T00:00:00Z";
    const error = new ApiError("no", { status: 409, body: { reason: "declinedRecently", from } });
    const seconds = Math.floor(Date.parse(from) / 1000);
    expect(friendRefusal(error)).toEqual({
      reason: "declinedRecently",
      message: `You can't ask this player again until ${dayText(seconds)}.`,
      from: seconds,
    });
  });

  it("falls back to a general line for a reason it does not know", async () => {
    stubFetch(refusal("somethingNew"), 409);
    const caught = await friendsApi.remove(7).catch((error: unknown) => error);
    expect(friendRefusal(caught)).toEqual({ reason: "unknown", message: GENERAL_REFUSAL });
    expect(friendRefusal(new Error("boom"))).toEqual({ reason: "unknown", message: GENERAL_REFUSAL });
  });

  it("says when the server could not be reached", () => {
    expect(friendRefusal(new NetworkError("down", null))).toEqual({ reason: "network", message: NETWORK_REFUSAL });
  });
});

describe("toSeconds", () => {
  it("reads unix seconds, milliseconds and ISO strings, and nothing else", () => {
    expect(toSeconds(1_760_000_000)).toBe(1_760_000_000);
    expect(toSeconds(1_760_000_000_500)).toBe(1_760_000_000);
    expect(toSeconds("1760000000")).toBe(1_760_000_000);
    expect(toSeconds("2026-10-19T00:00:00Z")).toBe(Math.floor(Date.parse("2026-10-19T00:00:00Z") / 1000));
    expect(toSeconds(null)).toBeNull();
    expect(toSeconds("")).toBeNull();
    expect(toSeconds("soon")).toBeNull();
    expect(toSeconds(0)).toBeNull();
  });
});
