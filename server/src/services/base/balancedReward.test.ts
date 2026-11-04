import { describe, expect, it } from "bun:test";
import { Reward } from "../../enums/Rewards.js";
import type { Save } from "../../database/models/save.model.js";
import { balancedReward } from "./balancedReward.js";

/** A main-yard save with only a Town Hall at `level`. */
const saveWithHall = (level: number) =>
  ({
    rewards: {},
    champion: [],
    krallen: null,
    buildingdata: { "1": { id: 1, t: 14, l: level, x: 0, y: 0 } },
  }) as unknown as Save;

describe("balancedReward", () => {
  it("never gives Krallen for the Town Hall (only the Krallen Hunt does)", async () => {
    for (const level of [6, 7, 8, 9, 10]) {
      const save = saveWithHall(level);
      await balancedReward(save);
      expect(save.champion).toEqual([]);
      expect(save.krallen).toBeNull();
      expect(save.rewards![Reward.KRALLEN]).toBeUndefined();
    }
  });

  it("still gives Korath at Town Hall 7", async () => {
    const save = saveWithHall(7);
    await balancedReward(save);
    expect(save.rewards![Reward.KORATH]).toBeDefined();
  });

  it("holds back Rezghul and Diamond Spurtz, even at Town Hall 10", async () => {
    const save = saveWithHall(10);
    await balancedReward(save);
    expect(Object.keys(save.rewards!)).toEqual([Reward.KORATH]);
  });

  it("gives nothing below Town Hall 7", async () => {
    const save = saveWithHall(6);
    await balancedReward(save);
    expect(save.rewards).toEqual({});
  });
});
