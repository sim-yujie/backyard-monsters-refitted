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
  state: { online: new Set(), truces: new Map() },
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
});

describe("userCell protection end (#187)", () => {
  test("a protected yard says when its protection ends", async () => {
    const until = now() + 3600;
    expect(await userCell(ctx, outpostWith(30, until), owners)).toMatchObject({ p: 1, pe: until });
  });

  test("an unprotected yard sends no end", async () => {
    const payload = await userCell(ctx, outpostWith(30, now() - 60), owners);
    expect(payload).toMatchObject({ p: 0 });
    expect(payload).not.toHaveProperty("pe");
  });

  test("a repaired yard, whose stored damage the catch-up lowered, shows that", async () => {
    expect(await userCell(ctx, outpostWith(0, now() - 60), owners)).toMatchObject({ dm: 0, d: 0 });
  });
});

describe("userCell outpost kit (#334)", () => {
  const withKit = (kit: number | undefined) =>
    ({
      uid: OWNER,
      base_type: 3,
      baseid: "2000240208",
      terrainHeight: 100,
      save: {
        damage: 0,
        protected: 0,
        locked: 0,
        empirevalue: 0,
        flinger: 0,
        catapult: 0,
        attackid: 0,
        attacks: [],
        starterkit: kit,
      },
    }) as unknown as Parameters<typeof userCell>[1];

  test("an outpost carries its Starter Kit, for the map's tint and filter", async () => {
    expect(await userCell(ctx, withKit(2), owners)).toMatchObject({ kit: 2 });
  });

  test("an outpost that never took one reads 0, not undefined", async () => {
    expect(await userCell(ctx, withKit(undefined), owners)).toMatchObject({ kit: 0 });
  });

  test("a main yard carries no kit at all", async () => {
    const homeCell = { ...withKit(1), base_type: 2 } as unknown as Parameters<typeof userCell>[1];
    const payload = await userCell(ctx, homeCell, owners);
    expect(payload).not.toHaveProperty("kit");
  });
});

describe("userCell invitation pending (#205)", () => {
  const OUTPOST = "2000240208";
  const withInvite = {
    authUser: { userid: OWNER, save: { basesaveid: 1 } },
    state: { online: new Set(), truces: new Map(), pendingInvites: new Map([[OUTPOST, 41]]) },
  } as unknown as Context;
  const own = new Map() as unknown as Parameters<typeof userCell>[2];
  // No basesaveid on the save: the owner's own monsters are then the stored ones, with no database read.
  const cellOwnedBy = (base_type: number) =>
    ({ ...outpostWith(0, 0), base_type }) as unknown as Parameters<typeof userCell>[1];

  test("the owner's own outpost carries the thread of its invitation still waiting", async () => {
    (withInvite.authUser as unknown as { save: object }).save = { basesaveid: 1, points: "0", basevalue: "0" };
    expect(await userCell(withInvite, cellOwnedBy(3), own)).toMatchObject({ pi: 41 });
  });

  test("nobody else sees it, and a main yard never has one", async () => {
    expect(await userCell({ ...ctx, state: withInvite.state } as unknown as Context, outpostWith(0, 0), owners)).toMatchObject({
      pi: 0,
    });
    expect(await userCell(withInvite, cellOwnedBy(2), own)).toMatchObject({ pi: 0 });
  });
});
