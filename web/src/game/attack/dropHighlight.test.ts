import { describe, expect, it } from "vitest";
import { DropHighlight } from "./dropHighlight";

describe("DropHighlight", () => {
  it("lights what came under the zone and puts back what left it, nothing else", () => {
    const calls: Array<[number, boolean]> = [];
    const highlight = new DropHighlight((id, on) => calls.push([id, on]));
    highlight.show([1, 2, 3]);
    expect(calls).toEqual([
      [1, true],
      [2, true],
      [3, true],
    ]);
    calls.length = 0;
    highlight.show([2, 3, 4]);
    expect(calls).toEqual([
      [1, false],
      [4, true],
    ]);
    calls.length = 0;
    highlight.show([4, 3, 2]);
    expect(calls).toEqual([]);
    highlight.clear();
    expect(calls.sort((a, b) => a[0] - b[0])).toEqual([
      [2, false],
      [3, false],
      [4, false],
    ]);
    expect(highlight.ids.size).toBe(0);
  });
});
