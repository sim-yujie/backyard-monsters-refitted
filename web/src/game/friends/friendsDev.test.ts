import { describe, expect, it } from "vitest";
import { canHelp } from "./friendText";
import { devBigFriends, withBigList } from "./friendsDev";
import { BIG_FRIENDS, bigFriendList, fixtureApi } from "./friendsFixture";

describe("the dev build's long friends list (?bigfriends)", () => {
  it("is off without the parameter", () => {
    expect(devBigFriends("")).toBeNull();
    expect(devBigFriends("?protect=40,20")).toBeNull();
  });

  it("is 90 / 20 / 150 by default, or the counts given", () => {
    expect(devBigFriends("?bigfriends")).toEqual(BIG_FRIENDS);
    expect(devBigFriends("?bigfriends=1")).toEqual(BIG_FRIENDS);
    expect(devBigFriends("?x=1&bigfriends=5,2,30")).toEqual({ help: 5, online: 2, total: 30 });
  });

  it("makes 90 who can use help, 20 more online and 150 in all", () => {
    const friends = bigFriendList();
    expect(friends).toHaveLength(150);
    expect(friends.filter(canHelp)).toHaveLength(90);
    expect(friends.filter((friend) => !canHelp(friend) && friend.online === "online")).toHaveLength(20);
    expect(new Set(friends.map((friend) => friend.userid)).size).toBe(150);
    expect(friends.filter((friend) => friend.pinnedAt !== null)).toHaveLength(3);
  });

  it("answers the list from the made-up friends and leaves the rest to the real API", async () => {
    const { api, calls } = fixtureApi();
    const big = withBigList(api, { help: 4, online: 1, total: 9 });
    expect((await big.list()).friends).toHaveLength(9);
    await big.requests();
    expect(calls.map(([method]) => method)).toEqual(["requests"]);
  });
});
