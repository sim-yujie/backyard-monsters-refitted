// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/http";
import type { BaiterTestsApi, BaiterTestsResponse, FriendTestRow } from "@/api/baiterTests";
import { BaiterFriends, leftText, lengthText } from "./BaiterFriends";

const NOW = 1_800_000_000;

const row = (id: number, tester: [number, string], extra: Partial<FriendTestRow> = {}): FriendTestRow => ({
  id,
  tester: { userid: tester[0], name: tester[1], pic: null },
  foughtAt: NOW - id * 60,
  damage: 40 + id,
  result: "held",
  seconds: 161,
  rulesVersion: "r1",
  hasReport: true,
  hasReplay: true,
  playable: true,
  ...extra,
});

const data = (extra: Partial<BaiterTestsResponse> = {}): BaiterTestsResponse => ({
  error: 0,
  now: NOW,
  baiterLevel: 4,
  cap: 1_500,
  inviteSeconds: 86_400,
  keepSeconds: 604_800,
  maxPerSend: 25,
  candidates: [
    { userid: 11, username: "GooGobbler", pic: null, level: 18, friend: true, alliance: false },
    { userid: 12, username: "TwigTitan", pic: null, level: 25, friend: true, alliance: true },
    { userid: 13, username: "SlimeQueen", pic: null, level: 39, friend: false, alliance: true },
  ],
  invited: [{ userid: 12, username: "TwigTitan", pic: null, level: 25, expiresAt: NOW + 21 * 3_600, tests: 3 }],
  invitedMe: [{ userid: 21, username: "VorgLord", pic: null, level: 30, expiresAt: NOW + 40 * 60, cap: 2_100 }],
  results: [row(1, [12, "TwigTitan"]), row(2, [13, "SlimeQueen"], { playable: false }), row(3, [12, "TwigTitan"])],
  ...extra,
});

const fakeApi = (answer: BaiterTestsResponse = data()): BaiterTestsApi & Record<string, ReturnType<typeof vi.fn>> =>
  ({
    list: vi.fn(async () => answer),
    invite: vi.fn(async (ids: readonly number[]) => ({ invited: ids.length, skipped: 0 })),
    cancel: vi.fn(async () => undefined),
    start: vi.fn(),
    finish: vi.fn(),
    replay: vi.fn(),
  }) as never;

const texts = (root: HTMLElement, selector: string): string[] =>
  [...root.querySelectorAll(selector)].map((node) => node.textContent ?? "");

describe("the Baiter window's friend tabs (beta 9 #4, design A)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => document.body.replaceChildren());

  it("words the time left and a test's length", () => {
    expect(leftText(21 * 3_600 + 59)).toBe("21h");
    expect(leftText(40 * 60)).toBe("40m");
    expect(leftText(10)).toBe("1m");
    expect(lengthText(161)).toBe("2m 41s");
    expect(lengthText(300)).toBe("5m");
    expect(lengthText(42)).toBe("42s");
  });

  it("Invite: friends and mates once each, filters, a tick per player not yet invited, Send for the picked", async () => {
    const api = fakeApi();
    const friends = new BaiterFriends({ api, onTest: vi.fn(), now: () => NOW });
    document.body.append(friends.invite);
    await friends.load();
    const view = friends.invite;
    // "Invited 1" is the phone's way to the open invites (CSS hides it beside the column).
    expect(texts(view, ".baiter-friends__chip")).toEqual(["All 3", "Invited 1", "Friends 2", "Alliance 2"]);
    expect(texts(view, ".baiter-friends__col--pick .friends-row__name")).toEqual(["GooGobbler", "TwigTitan", "SlimeQueen"]);
    // Already invited: no tick, "Invited" instead.
    expect(view.querySelector('[aria-label="Invite TwigTitan"]')).toBeNull();
    expect(texts(view, ".baiter-friends__col--open .friends-row__note")).toEqual(["21h left · 3 tests"]);

    const send = () => view.querySelector<HTMLButtonElement>(".baiter-friends__send")!;
    expect(send().disabled).toBe(true);
    view.querySelector<HTMLButtonElement>('[aria-label="Invite GooGobbler"]')!.click();
    view.querySelector<HTMLButtonElement>('[aria-label="Invite SlimeQueen"]')!.click();
    expect(view.querySelector('[aria-label="Invite GooGobbler"]')!.getAttribute("aria-checked")).toBe("true");
    expect(send().textContent).toBe("Send 2");
    expect(view.textContent).toContain("2 picked · 24 h, any number of tests");
    send().click();
    await vi.waitFor(() => expect(api.invite).toHaveBeenCalledWith([11, 13]));
    await vi.waitFor(() => expect(view.querySelector(".baiter-friends__status")!.textContent).toBe("2 invites sent."));
    expect(api.list).toHaveBeenCalledTimes(2);

    // The Alliance filter and the search narrow the list.
    [...view.querySelectorAll<HTMLButtonElement>(".baiter-friends__chip")].find((one) => one.textContent === "Alliance 2")!.click();
    expect(texts(friends.invite, ".baiter-friends__col--pick .friends-row__name")).toEqual(["TwigTitan", "SlimeQueen"]);
    const search = friends.invite.querySelector<HTMLInputElement>(".baiter-friends__search-input")!;
    search.value = "slime";
    search.dispatchEvent(new Event("input"));
    expect(texts(friends.invite, ".baiter-friends__col--pick .friends-row__name")).toEqual(["SlimeQueen"]);

    // The Invited filter lists the open invites, with their cancels, in the list's place.
    [...friends.invite.querySelectorAll<HTMLButtonElement>(".baiter-friends__chip")].find((one) => one.textContent === "Invited 1")!.click();
    expect(texts(friends.invite, ".baiter-friends__col--pick .friends-row__name")).toEqual(["TwigTitan"]);
    expect(friends.invite.querySelector(".baiter-friends__col--pick .baiter-friends__cancel")).not.toBeNull();
  });

  it("Invite: ticking keeps the list where it is (no redraw) and caps the pick at the server's limit", async () => {
    const friends = new BaiterFriends({ api: fakeApi(data({ maxPerSend: 1 })), onTest: vi.fn(), now: () => NOW });
    await friends.load();
    const list = friends.invite.querySelector(".baiter-friends__col--pick .baiter-friends__list")!;
    friends.invite.querySelector<HTMLButtonElement>('[aria-label="Invite GooGobbler"]')!.click();
    friends.invite.querySelector<HTMLButtonElement>('[aria-label="Invite SlimeQueen"]')!.click();
    expect(friends.invite.querySelector(".baiter-friends__col--pick .baiter-friends__list")).toBe(list);
    expect(friends.invite.querySelector('[aria-label="Invite SlimeQueen"]')!.getAttribute("aria-checked")).toBe("false");
    expect(friends.invite.querySelector(".baiter-friends__send")!.textContent).toBe("Send 1");
  });

  it("Invite: a cancel ends that invite; a refusal is said in words", async () => {
    const api = fakeApi();
    api.cancel.mockRejectedValueOnce(
      new ApiError("x", { status: 409, details: { data: { reason: "notFriend" } } }),
    );
    const friends = new BaiterFriends({ api, onTest: vi.fn(), now: () => NOW });
    await friends.load();
    friends.invite.querySelector<HTMLButtonElement>('[aria-label="Cancel TwigTitan\'s invite"]')!.click();
    await vi.waitFor(() =>
      expect(friends.invite.querySelector(".baiter-friends__status")!.textContent).toBe(
        "You can only test friends and alliance mates.",
      ),
    );
    expect(api.cancel).toHaveBeenCalledWith(12);
  });

  it("Invite: with no Baiter there is no one to invite, only the reason", async () => {
    const friends = new BaiterFriends({ api: fakeApi(data({ baiterLevel: 0, candidates: [] })), onTest: vi.fn() });
    await friends.load();
    expect(friends.invite.textContent).toBe("Build a Wild Monster Baiter to invite friends to test your yard.");
  });

  it("Invited me: the inviter, THEIR cap, the time left, and Test", async () => {
    const onTest = vi.fn();
    const friends = new BaiterFriends({ api: fakeApi(), onTest, now: () => NOW });
    await friends.load();
    const view = friends.invitedMe;
    expect(view.querySelector(".friends-row__name")!.textContent).toBe("VorgLord");
    expect(view.querySelector(".baiter-friends__cap")!.textContent).toBe("2,100 max");
    expect(view.querySelector(".baiter-friends__left")!.textContent).toBe("40m left");
    view.querySelector<HTMLButtonElement>('[aria-label="Test VorgLord\'s yard"]')!.click();
    expect(onTest).toHaveBeenCalledWith(expect.objectContaining({ userid: 21, cap: 2_100 }));

    const empty = new BaiterFriends({ api: fakeApi(data({ invitedMe: [] })), onTest });
    await empty.load();
    expect(empty.invitedMe.textContent).toContain("No one has invited you yet.");
  });

  it("Results: newest first, a chip per tester, Watch only when playable, new ones dotted until seen", async () => {
    const counts = vi.fn();
    const friends = new BaiterFriends({
      api: fakeApi(),
      onTest: vi.fn(),
      onWatch: vi.fn(),
      onReport: vi.fn(),
      onCounts: counts,
      now: () => NOW,
    });
    await friends.load();
    const view = friends.results;
    expect(texts(view, ".baiter-friends__chip")).toEqual(["All 3", "TwigTitan 2", "SlimeQueen 1"]);
    expect(texts(view, ".friends-row__note")).toEqual(["1 min ago · 2m 41s", "2 min ago · 2m 41s", "3 min ago · 2m 41s"]);
    expect(texts(view, ".baiter-friends__result")).toEqual(["Held", "Held", "Held"]);
    expect(texts(view, ".baiter-friends__damage")).toEqual(["41%", "42%", "43%"]);
    const watches = [...view.querySelectorAll<HTMLButtonElement>(".baiter-friends__watch")];
    expect(watches.map((one) => one.disabled)).toEqual([false, true, false]);
    expect(watches[1]!.title).toBe("Replay not available after a game update");
    expect(view.querySelectorAll(".baiter-friends__row--new")).toHaveLength(3);
    expect(texts(view, ".baiter-friends__new")).toEqual(["New", "New", "New"]);
    expect(view.textContent).toContain("Kept 7 days. Real attacks stay in Defences.");
    expect(counts).toHaveBeenLastCalledWith({ invitedMe: 1, results: 3, fresh: 3 });

    friends.markSeen();
    expect(counts).toHaveBeenLastCalledWith({ invitedMe: 1, results: 3, fresh: 0 });
    const again = new BaiterFriends({ api: fakeApi(), onTest: vi.fn(), now: () => NOW });
    await again.load();
    expect(again.results.querySelectorAll(".baiter-friends__row--new")).toHaveLength(0);

    [...view.querySelectorAll<HTMLButtonElement>(".baiter-friends__chip")].find((one) => one.textContent === "SlimeQueen 1")!.click();
    expect(texts(friends.results, ".friends-row__name")).toEqual(["SlimeQueen"]);
  });

  it("Results: Report shows the list's figures when the server kept no replay", async () => {
    const api = fakeApi();
    api.replay.mockRejectedValueOnce(new ApiError("gone", { status: 410, details: { data: { reason: "noReplay" } } }));
    const onReport = vi.fn();
    const friends = new BaiterFriends({ api, onTest: vi.fn(), onReport, now: () => NOW });
    await friends.load();
    friends.results.querySelector<HTMLButtonElement>(".baiter-friends__report")!.click();
    await vi.waitFor(() => expect(onReport).toHaveBeenCalledTimes(1));
    expect(onReport.mock.calls[0]![0]).toMatchObject({ damagePercent: 41, resultLine: "Your yard held", time: "2:41" });
    expect(friends.results.querySelector(".baiter-friends__report img")).toBeNull();
    expect(onReport.mock.calls[0]![1]).toBeNull();
  });

  it("a list that cannot load says so, with Try again", async () => {
    const api = fakeApi();
    api.list.mockRejectedValueOnce(new ApiError("busy", { status: 503, details: { data: { reason: "busy" } } }));
    const friends = new BaiterFriends({ api, onTest: vi.fn() });
    await friends.load();
    expect(friends.results.textContent).toContain("The server is busy.");
    friends.results.querySelector<HTMLButtonElement>(".baiter-friends__retry")!.click();
    await vi.waitFor(() => expect(friends.results.querySelectorAll(".friends-row")).toHaveLength(3));
  });
});
