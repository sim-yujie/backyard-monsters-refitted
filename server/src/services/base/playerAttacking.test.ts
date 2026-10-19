import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * Whether a player is in an attack of their own (issue #366): the attacker's
 * index key names a defender row, whose live session must name them.
 */

const ME = 2505;

let keys: Map<string, string>;

mock.module("../../server.js", () => ({
  postgres: { em: {} },
  redis: { get: async (key: string) => keys.get(key) ?? null, del: async () => 0 },
}));

const { isPlayerAttacking } = await import("./playerAttacking.js");

/** A defender row's stored session, as `serialiseAttackSession` writes a bare one. */
const session = (basesaveid: number, attackerid: number, startedat: number) =>
  keys.set(`attack-session:${basesaveid}`, `${attackerid}:1:${startedat}`);

const now = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  keys = new Map();
});

describe("isPlayerAttacking", () => {
  test("no index key: not attacking", async () => {
    expect(await isPlayerAttacking(ME)).toBe(false);
  });

  test("a live session on the indexed row that names the player: attacking", async () => {
    keys.set(`attacker-session:${ME}`, "900");
    session(900, ME, now() - 30);
    expect(await isPlayerAttacking(ME)).toBe(true);
  });

  test("the attack was saved (its session ended): not attacking", async () => {
    keys.set(`attacker-session:${ME}`, "900");
    expect(await isPlayerAttacking(ME)).toBe(false);
  });

  test("someone else's attack now holds that row: not attacking", async () => {
    keys.set(`attacker-session:${ME}`, "900");
    session(900, 77, now() - 30);
    expect(await isPlayerAttacking(ME)).toBe(false);
  });

  test("a session past the attack window: not attacking", async () => {
    keys.set(`attacker-session:${ME}`, "900");
    session(900, ME, now() - 60 * 60);
    expect(await isPlayerAttacking(ME)).toBe(false);
  });
});
