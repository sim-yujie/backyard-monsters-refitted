import { describe, expect, test } from "bun:test";

import { mostHeld, planGiftAll, type GiftAllCandidate } from "./giftAll.js";

const friend = (userid: number, wishes: GiftAllCandidate["wishes"], amount = 100): GiftAllCandidate => ({
  userid,
  username: `f${userid}`,
  wishes,
  amount,
});

describe("planGiftAll", () => {
  test("each friend gets their first wish; no wish gets the sender's pick", () => {
    const plan = planGiftAll([friend(1, ["r4", "r1"]), friend(2, []), friend(3, ["r2"])], { r1: 1000, r2: 1000, r3: 1000, r4: 1000 }, "r3");
    expect(plan.gifts.map((g) => [g.userid, g.resource, g.wish])).toEqual([
      [1, "r4", 1],
      [2, "r3", 0],
      [3, "r2", 1],
    ]);
    expect(plan.skipped).toEqual([]);
    expect(plan.cost).toEqual({ r1: 0, r2: 100, r3: 100, r4: 100 });
  });

  test("falls back to the next wish the sender can still afford, counting earlier gifts", () => {
    // 150 Goo: the first friend takes 100 of it, the second can only have their second wish.
    const plan = planGiftAll([friend(1, ["r4"]), friend(2, ["r4", "r1"])], { r1: 500, r2: 0, r3: 0, r4: 150 }, "r1");
    expect(plan.gifts.map((g) => [g.userid, g.resource, g.wish])).toEqual([
      [1, "r4", 1],
      [2, "r1", 2],
    ]);
    expect(plan.cost).toEqual({ r1: 100, r2: 0, r3: 0, r4: 100 });
  });

  test("a friend nothing affordable fits is skipped, never sent a short gift", () => {
    const plan = planGiftAll([friend(1, ["r4", "r3"]), friend(2, []), friend(3, ["r1"], 50)], { r1: 60, r2: 0, r3: 99, r4: 99 }, "r2");
    expect(plan.gifts.map((g) => g.userid)).toEqual([3]);
    expect(plan.skipped).toEqual([
      { userid: 1, username: "f1", reason: "notEnough", lacking: ["r4", "r3"], amount: 100 },
      { userid: 2, username: "f2", reason: "notEnough", lacking: ["r2"], amount: 100 },
    ]);
    expect(plan.cost).toEqual({ r1: 50, r2: 0, r3: 0, r4: 0 });
  });

  test("exactly enough is enough", () => {
    const plan = planGiftAll([friend(1, []), friend(2, [])], { r1: 200, r2: 0, r3: 0, r4: 0 }, "r1");
    expect(plan.gifts).toHaveLength(2);
    expect(plan.skipped).toHaveLength(0);
  });

  test("does not change what it is given", () => {
    const held = { r1: 500, r2: 0, r3: 0, r4: 0 };
    planGiftAll([friend(1, [])], held, "r1");
    expect(held.r1).toBe(500);
  });
});

describe("mostHeld", () => {
  test("the resource held most, the first on a tie", () => {
    expect(mostHeld({ r1: 5, r2: 9, r3: 9, r4: 1 })).toBe("r2");
    expect(mostHeld({ r1: 0, r2: 0, r3: 0, r4: 0 })).toBe("r1");
  });
});
