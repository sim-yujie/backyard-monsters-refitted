import { describe, expect, mock, test } from "bun:test";
import type { Save } from "../../../database/models/save.model.js";
import type { User } from "../../../database/models/user.model.js";

let cell: { x: number; y: number } | null = { x: 240, y: 208 };

mock.module("../../../server.js", () => ({
  postgres: { em: { findOne: async () => cell } },
  redis: {},
}));

const { takeoverOffer } = await import("./takeoverOffer.js");

const grant = { attackerid: 2505, basesaveid: 900, baseid: "2000240208", expiresAt: 1_800_000_600 };
const taker = { userid: 2505, alliance_id: null } as unknown as User;
const outpost = { baseid: "2000240208", empirevalue: 10_000_000 } as unknown as Save;
const takerAt = (homebase: string[]) => ({ homebase }) as unknown as Save;

describe("takeoverOffer", () => {
  test("the grant's end and the price takeoverCell will charge", async () => {
    // ln(10,000,000) prices at 28,000,000 of each (takeoverCost.test.ts).
    expect(await takeoverOffer(grant, taker, takerAt(["100", "100"]), outpost)).toEqual({
      baseid: "2000240208",
      expiresAt: 1_800_000_600,
      resources: 28_000_000,
      shiny: expect.any(Number),
      adjacent: false,
    });
  });

  test("next to the taker's main yard it is half", async () => {
    const offer = await takeoverOffer(grant, taker, takerAt(["240", "207"]), outpost);
    expect(offer).toMatchObject({ resources: 14_000_000, adjacent: true });
  });

  test("with no map cell the place comes from the base id", async () => {
    cell = null;
    const offer = await takeoverOffer(grant, taker, takerAt(["240", "207"]), outpost);
    expect(offer).toMatchObject({ resources: 14_000_000, adjacent: true });
    cell = { x: 240, y: 208 };
  });
});
