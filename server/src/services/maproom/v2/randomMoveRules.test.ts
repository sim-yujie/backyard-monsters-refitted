import { describe, expect, test } from "bun:test";
import {
  RANDOM_MOVE_COOLDOWN,
  randomMoveAvailableAt,
  randomMoveRefusal,
  type RandomMoveInput,
} from "./randomMoveRules.js";

/** "Move to a random spot" (issue #366): the owner's rules, without a database. */

const NOW = 1_800_000_000;
const DAY = 24 * 60 * 60;

const input = (overrides: Partial<RandomMoveInput> = {}): RandomMoveInput => ({
  mapVersion: 2,
  hasHomeCell: true,
  randomMoveAt: null,
  now: NOW,
  underAttack: false,
  outpostUnderAttack: false,
  attacking: false,
  ...overrides,
});

describe("randomMoveRefusal", () => {
  test("a Map Room 2 player who never moved may move", () => {
    expect(randomMoveRefusal(input())).toBeNull();
  });

  test("the cooldown is a week", () => {
    expect(RANDOM_MOVE_COOLDOWN).toBe(7 * DAY);
  });

  test("refused for a week after a move, allowed once the week is up", () => {
    expect(randomMoveRefusal(input({ randomMoveAt: NOW - DAY }))).toBe("coolingDown");
    expect(randomMoveRefusal(input({ randomMoveAt: NOW - 7 * DAY + 1 }))).toBe("coolingDown");
    expect(randomMoveRefusal(input({ randomMoveAt: NOW - 7 * DAY }))).toBeNull();
  });

  test("the next move's time is a week after the last, or 0 for a player who never moved", () => {
    expect(randomMoveAvailableAt(NOW)).toBe(NOW + 7 * DAY);
    expect(randomMoveAvailableAt(null)).toBe(0);
    expect(randomMoveAvailableAt(0)).toBe(0);
  });

  test("only on Map Room 2", () => {
    expect(randomMoveRefusal(input({ mapVersion: 1 }))).toBe("notMapRoom2");
    expect(randomMoveRefusal(input({ mapVersion: 3 }))).toBe("notMapRoom2");
    expect(randomMoveRefusal(input({ mapVersion: null }))).toBe("notMapRoom2");
  });

  test("refused without a home cell on the map", () => {
    expect(randomMoveRefusal(input({ hasHomeCell: false }))).toBe("noHomeCell");
  });

  test("refused while the main yard or an outpost is under attack, or the player is attacking", () => {
    expect(randomMoveRefusal(input({ underAttack: true }))).toBe("underAttack");
    expect(randomMoveRefusal(input({ outpostUnderAttack: true }))).toBe("outpostUnderAttack");
    expect(randomMoveRefusal(input({ attacking: true }))).toBe("attacking");
  });
});
