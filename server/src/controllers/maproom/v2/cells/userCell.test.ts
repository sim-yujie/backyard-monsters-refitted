import { describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * The owner's rule for the map (issue #182 B): a player's yard shows its real
 * damage until it is repaired, not 0% once its damage protection runs out.
 */

mock.module("../../../../server.js", () => ({ postgres: { em: {} }, redis: {} }));

const { userCell } = await import("./userCell.js");

const OWNER = 77;
const now = () => Math.floor(Date.now() / 1000);

const ctx = {
  authUser: { userid: 2505 },
  state: { lastSeen: new Map(), truces: new Map() },
} as unknown as Context;

const owners = new Map([
  [OWNER, { userid: OWNER, username: "owner", pic_square: "", alliance_id: null, save: { points: "0", basevalue: "0" } }],
]) as unknown as Parameters<typeof userCell>[2];

const outpostWith = (damage: number, protectedUntil: number) =>
  ({
    uid: OWNER,
    base_type: 3,
    baseid: "2000240208",
    terrainHeight: 100,
    save: { damage, protected: protectedUntil, locked: 0, empirevalue: 0, flinger: 0, catapult: 0, attackid: 0, attacks: [] },
  }) as unknown as Parameters<typeof userCell>[1];

describe("userCell damage", () => {
  test("after damage protection has run out, the real damage shows", async () => {
    const payload = await userCell(ctx, outpostWith(92, now() - 60), owners);
    expect(payload).toMatchObject({ dm: 92, d: 1, p: 0 });
  });

  test("while protected, likewise", async () => {
    expect(await userCell(ctx, outpostWith(60, now() + 3600), owners)).toMatchObject({ dm: 60, d: 0, p: 1 });
  });

  test("a repaired yard, whose stored damage the catch-up lowered, shows that", async () => {
    expect(await userCell(ctx, outpostWith(0, now() - 60), owners)).toMatchObject({ dm: 0, d: 0 });
  });
});
