import { describe, expect, it } from "vitest";
import { mushroomKey } from "./mushroomPick";
import { MUSHROOM_POP_SECONDS, mushroomPopScale, newMushroomKeys } from "./mushroomPop";
import type { YardMushroom } from "./yardModel";

const at = (x: number, y: number): YardMushroom => ({ x, y }) as YardMushroom;

describe("mushroomPopScale", () => {
  it("starts from nothing and ends at full size", () => {
    expect(mushroomPopScale(0)).toBe(0);
    expect(mushroomPopScale(-1)).toBe(0);
    expect(mushroomPopScale(MUSHROOM_POP_SECONDS)).toBe(1);
    expect(mushroomPopScale(10)).toBe(1);
  });

  it("overshoots a little on the way, never by more than a fifth", () => {
    const samples = Array.from({ length: 45 }, (_, i) => mushroomPopScale((i / 45) * MUSHROOM_POP_SECONDS));
    expect(Math.max(...samples)).toBeGreaterThan(1);
    expect(Math.max(...samples)).toBeLessThan(1.2);
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0);
  });
});

describe("newMushroomKeys", () => {
  it("names the mushrooms whose spot was not on screen: a moved one and a new one", () => {
    const before = new Set([mushroomKey(at(10, 20)), mushroomKey(at(300, -40))]);
    const after = [at(10, 20), at(120, 80), at(-60, 5)];

    expect(newMushroomKeys(before, after)).toEqual([mushroomKey(at(120, 80)), mushroomKey(at(-60, 5))]);
  });

  it("nothing new, nothing to pop", () => {
    const before = new Set([mushroomKey(at(10, 20))]);
    expect(newMushroomKeys(before, [at(10, 20)])).toEqual([]);
  });
});
