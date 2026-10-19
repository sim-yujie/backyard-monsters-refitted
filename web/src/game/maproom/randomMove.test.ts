import { describe, expect, it } from "vitest";
import {
  RANDOM_MOVE_COOLDOWN_SECONDS,
  availableAgainText,
  confirmQuestion,
  outpostCountOf,
  outpostWarning,
  randomMoveAvailableAt,
  randomMoveWait,
} from "./randomMove";

/** "Move to a random spot" (#366): the week's wait and the warning's words. */

const NOW = 1_800_000_000;
const DAY = 24 * 60 * 60;

describe("the week between moves", () => {
  it("is 7 days, as the server holds it", () => {
    expect(RANDOM_MOVE_COOLDOWN_SECONDS).toBe(7 * DAY);
  });

  it("is open to a player who never moved", () => {
    expect(randomMoveAvailableAt({})).toBe(0);
    expect(randomMoveAvailableAt({ randommoveat: null })).toBe(0);
    expect(randomMoveWait({ randommoveat: null }, NOW)).toBe(0);
  });

  it("runs for 7 days after a move", () => {
    const save = { randommoveat: NOW - 2 * DAY };
    expect(randomMoveAvailableAt(save)).toBe(NOW + 5 * DAY);
    expect(randomMoveWait(save, NOW)).toBe(5 * DAY);
    expect(randomMoveWait(save, NOW + 5 * DAY)).toBe(0);
  });

  it("says when it opens again: days rounded up, then hours, then minutes", () => {
    expect(availableAgainText(5 * DAY)).toBe("Available again in 5 days.");
    expect(availableAgainText(4 * DAY + 1)).toBe("Available again in 5 days.");
    expect(availableAgainText(DAY)).toBe("Available again in 1 day.");
    expect(availableAgainText(3 * 60 * 60 + 5)).toBe("Available again in 4 hours.");
    expect(availableAgainText(60 * 60)).toBe("Available again in 1 hour.");
    expect(availableAgainText(90)).toBe("Available again in 2 minutes.");
    expect(availableAgainText(1)).toBe("Available again in 1 minute.");
  });
});

describe("the warning", () => {
  it("counts the outposts the main yard lists", () => {
    expect(outpostCountOf({ outposts: [[1, 2, "a"], [3, 4, "b"]] as never })).toBe(2);
    expect(outpostCountOf({ outposts: null })).toBe(0);
    expect(outpostCountOf({})).toBe(0);
  });

  it("names how many outposts are lost, that they go back to the wild, and what goes with them", () => {
    const lines = outpostWarning(3)!;
    expect(lines[0]).toBe(
      "All 3 of your outposts will be lost. They go back to the wild monsters, and anyone can attack them and take them over.",
    );
    expect(lines[1]).toContain("the buildings, the monsters living there");
    expect(lines[1]).toContain("Starter Kit");
    expect(lines[1]).toContain("Their income stops.");
    expect(lines).toContain("This cannot be undone.");
  });

  it("speaks of one outpost in the singular", () => {
    const lines = outpostWarning(1)!;
    expect(lines[0]).toBe(
      "Your outpost will be lost. It goes back to the wild monsters, and anyone can attack it and take it over.",
    );
    expect(lines[1]).toContain("Everything on it is lost too");
  });

  it("has nothing to warn about without outposts", () => {
    expect(outpostWarning(0)).toBeNull();
  });

  it("asks the question with the count", () => {
    expect(confirmQuestion(0)).toBe("Move your main yard to a random spot?");
    expect(confirmQuestion(1)).toBe("Move your main yard and lose your outpost?");
    expect(confirmQuestion(4)).toBe("Move your main yard and lose all 4 outposts?");
  });
});
