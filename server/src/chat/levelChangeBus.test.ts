import { describe, expect, test } from "bun:test";
import { emitLevelChange, onLevelChange } from "./levelChangeBus.js";

/**
 * This module has no imports of its own by design (its file comment): the
 * yard code reports a level through it without ever reaching chat, Postgres
 * or Redis, so its own tests need no mocking either.
 *
 * The bus holds one module-level listener slot, so these run in order: the
 * "nothing registered yet" case has to come first, before any other test in
 * this file sets one.
 */

type Call = [number, string, number];

describe("levelChangeBus", () => {
  test("emitting before anything has registered does not throw", () => {
    expect(() => emitLevelChange(2505, "agenttester", 7)).not.toThrow();
  });

  test("calls the registered listener with the player's id, username and level", () => {
    const calls: Call[] = [];
    onLevelChange((userId, username, level) => calls.push([userId, username, level]));

    emitLevelChange(2505, "agenttester", 7);

    expect(calls).toEqual([[2505, "agenttester", 7]]);
  });

  test("registering a new listener replaces the previous one", () => {
    const first: Call[] = [];
    const second: Call[] = [];
    onLevelChange((userId, username, level) => first.push([userId, username, level]));
    onLevelChange((userId, username, level) => second.push([userId, username, level]));

    emitLevelChange(2505, "agenttester", 8);

    expect(first).toEqual([]);
    expect(second).toEqual([[2505, "agenttester", 8]]);
  });
});
