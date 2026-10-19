import { describe, expect, it, vi } from "vitest";
import type { FriendsApi, FriendsList } from "@/api/friends";
import { fixtureFriend, fixtureList } from "./friendsFixture";
import { FriendsStore, NUDGE_GAP_MS, REFRESH_MS, type FriendsSnapshot } from "./friendsStore";

/** The friends store (design §8, issue #370). */

const friend = fixtureFriend;
const listOf = fixtureList;

const setup = (answers: (FriendsList | Error)[] = [listOf([friend(7)])]) => {
  let clock = 1_000_000;
  const timers: { run: () => void; ms: number; cleared: boolean }[] = [];
  const list = vi.fn(() => {
    const next = answers.length > 1 ? answers.shift()! : answers[0]!;
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  const store = new FriendsStore({
    api: { list } as unknown as FriendsApi,
    now: () => clock,
    setInterval: (run, ms) => {
      const timer = { run, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearInterval: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
  });
  return { store, list, timers, tick: (ms: number) => (clock += ms) };
};

describe("FriendsStore", () => {
  it("starts empty and not loaded, and tells a new listener at once", () => {
    const { store } = setup();
    const seen: FriendsSnapshot[] = [];
    store.subscribe((snapshot) => seen.push(snapshot));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ friends: [], loaded: false, max: 100 });
    expect(store.waiting).toBe(0);
  });

  it("fetches the list, the friend ids and the counts", async () => {
    const { store } = setup([listOf([friend(7), friend(9)], { requestsIn: 2, giftsWaiting: 3 })]);
    await store.refresh();
    expect(store.snapshot.loaded).toBe(true);
    expect(store.friends.map((one) => one.userid)).toEqual([7, 9]);
    expect(store.isFriend(9)).toBe(true);
    expect(store.isFriend(8)).toBe(false);
    expect(store.waiting).toBe(5);
  });

  it("shares one request between refreshes at once", async () => {
    const { store, list } = setup();
    await Promise.all([store.refresh(), store.refresh()]);
    expect(list).toHaveBeenCalledTimes(1);
    await store.refresh();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("keeps what it had when a refresh fails", async () => {
    const { store } = setup([listOf([friend(7)]), new Error("down")]);
    await store.refresh();
    await store.refresh();
    expect(store.isFriend(7)).toBe(true);
    expect(store.snapshot.loaded).toBe(true);
  });

  it("drops a nudge right after a refresh, and refreshes on a later one", async () => {
    const { store, list, tick } = setup();
    await store.refresh();
    store.nudge();
    expect(list).toHaveBeenCalledTimes(1);
    tick(NUDGE_GAP_MS);
    store.nudge();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("refreshes every few minutes while anyone has started it", async () => {
    const { store, list, timers } = setup();
    const stopOne = store.start();
    const stopTwo = store.start();
    expect(list).toHaveBeenCalledTimes(1);
    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(REFRESH_MS);
    // Shares the start's own fetch.
    await store.refresh();
    timers[0]!.run();
    expect(list).toHaveBeenCalledTimes(2);
    stopOne();
    stopOne();
    expect(timers[0]?.cleared).toBe(false);
    stopTwo();
    expect(timers[0]?.cleared).toBe(true);
  });

  it("takes a friend off and puts one on at once, and sets the requests count", async () => {
    const { store } = setup([listOf([friend(7), friend(9)], { requestsIn: 1 })]);
    await store.refresh();
    const seen: number[] = [];
    store.subscribe((snapshot) => seen.push(snapshot.friends.length));
    store.removeFriend(7);
    store.removeFriend(7);
    expect(store.isFriend(7)).toBe(false);
    store.addFriend(friend(11));
    store.addFriend(friend(11, { level: 9 }));
    expect(store.friends.filter((one) => one.userid === 11)).toEqual([friend(11, { level: 9 })]);
    store.setRequestsIn(0);
    expect(store.waiting).toBe(0);
    expect(seen).toEqual([2, 1, 2, 2, 2]);
  });

  it("forgets the last player's list when someone else signs in", async () => {
    const { store } = setup();
    store.forUser(1);
    await store.refresh();
    store.forUser(1);
    expect(store.snapshot.loaded).toBe(true);
    store.forUser(2);
    expect(store.snapshot).toMatchObject({ loaded: false, friends: [] });
    expect(store.isFriend(7)).toBe(false);
  });
});
