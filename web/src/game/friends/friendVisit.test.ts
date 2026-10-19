import { describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/api/http";
import type { HelpYardResponse } from "@/api/friends";
import { consumeViewTarget } from "@/game/attack/attackTarget";
import { friendTarget, loadFriendYard, NoFriendYard, visitFailureText, visitFriend } from "./friendVisit";

const bob = { userid: 77, username: "Bob" };
const yard = { error: 0, baseid: "1234", help: { helpsLeft: 17, buildings: {} } } as unknown as HelpYardResponse;

describe("visiting a friend (#372)", () => {
  it("targets the friend by user id, read-only, with no attack", () => {
    const own = { resources: { r1: 5 }, credits: 3 };
    expect(friendTarget(bob, own)).toEqual({
      baseid: "",
      kind: "friend",
      friend: 77,
      name: "Bob",
      attack: null,
      refusal: null,
      own,
    });
    expect(friendTarget(bob)).not.toHaveProperty("own");
  });

  it("hands the target to the yard scene once", () => {
    visitFriend(bob);
    expect(consumeViewTarget()).toMatchObject({ kind: "friend", friend: 77 });
    expect(consumeViewTarget()).toBeNull();
  });

  it("looks the main yard up by user id, then loads it in help mode", async () => {
    const yardOf = vi.fn(async () => ({ baseid: "1234", name: "Bob" }));
    const loadHelpYard = vi.fn(async () => yard);
    expect(await loadFriendYard(77, { yardOf, loadHelpYard })).toBe(yard);
    expect(yardOf).toHaveBeenCalledWith(77);
    expect(loadHelpYard).toHaveBeenCalledWith("1234");
  });

  it("refuses when the friend has no yard to show", async () => {
    const loadHelpYard = vi.fn(async () => yard);
    await expect(loadFriendYard(77, { yardOf: async () => null, loadHelpYard })).rejects.toBeInstanceOf(NoFriendYard);
    expect(loadHelpYard).not.toHaveBeenCalled();
  });

  it("says why a visit failed in plain words", () => {
    const notFriends = new ApiError("Conflict", { status: 409, body: { reason: "notFriends" } });
    expect(visitFailureText("Bob", notFriends)).toBe("Could not visit Bob. You are not friends with this player any more.");
    expect(visitFailureText("Bob", new NoFriendYard())).toBe("Bob's yard could not be found.");
    expect(visitFailureText("Bob", new NetworkError("down", null))).toBe("Could not reach the server to visit Bob.");
    expect(visitFailureText("Bob", new ApiError("That yard is busy.", { status: 500 }))).toBe(
      "Could not visit Bob. That yard is busy.",
    );
    expect(visitFailureText("Bob", new Error("?"))).toBe("Could not visit Bob. Try again in a moment.");
  });
});
