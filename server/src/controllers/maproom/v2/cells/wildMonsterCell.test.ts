import { describe, expect, test } from "bun:test";

import { wildMonsterCell } from "./wildMonsterCell.js";
import { WILD_MONSTER_EXPIRATION } from "../../../../services/maproom/wildMonsterExpiry.js";

/** A damaged camp says when it grows back (`rg`), so the live map needs no timed re-ask (beta 9). */
const now = () => Math.floor(Date.now() / 1000);
const camp = (save: Record<string, unknown> | undefined) =>
  ({ x: 12, y: 34, terrainHeight: 100, save }) as unknown as Parameters<typeof wildMonsterCell>[0];

describe("wildMonsterCell regrowth", () => {
  test("a damaged camp sends when it grows back", async () => {
    const savetime = now() - 60;
    const cell = await wildMonsterCell(camp({ wmid: 3, damage: 40, destroyed: 0, savetime }), "w");
    expect(cell).toMatchObject({ dm: 40, rg: savetime + WILD_MONSTER_EXPIRATION });
  });

  test("an untouched or already grown back camp sends none", async () => {
    expect(await wildMonsterCell(camp(undefined), "w")).not.toHaveProperty("rg");
    expect(await wildMonsterCell(camp({ wmid: 3, damage: 0, destroyed: 0, savetime: now() }), "w")).not.toHaveProperty("rg");
    const old = await wildMonsterCell(camp({ wmid: 3, damage: 40, destroyed: 1, savetime: now() - WILD_MONSTER_EXPIRATION - 5 }), "w");
    expect(old).toMatchObject({ dm: 0, d: 0 });
    expect(old).not.toHaveProperty("rg");
  });
});
