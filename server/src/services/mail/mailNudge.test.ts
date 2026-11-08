import { afterEach, describe, expect, test } from "bun:test";
import { nudgeMail, setMailNudge } from "./mailNudge.js";

/** The live mail nudge (`mailNudge.ts`): off until set, players only, and it never throws. */

afterEach(() => setMailNudge(null));

describe("the mail nudge", () => {
  test("does nothing until the server sets how it goes out", () => {
    expect(() => nudgeMail(2503)).not.toThrow();
  });

  test("goes out for a player, not for the game's own senders", () => {
    const sent: number[] = [];
    setMailNudge(async (userId) => void sent.push(userId));
    nudgeMail(2503);
    nudgeMail(0);
    nudgeMail(-1);
    nudgeMail(Number.NaN);
    expect(sent).toEqual([2503]);
  });

  test("a failing publisher never reaches the caller", async () => {
    setMailNudge(() => {
      throw new Error("redis away");
    });
    expect(() => nudgeMail(2503)).not.toThrow();
    setMailNudge(async () => {
      throw new Error("redis away");
    });
    expect(() => nudgeMail(2503)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
