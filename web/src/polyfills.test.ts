import { describe, expect, test } from "vitest";
import { polyfillAt, polyfillDeepCopy } from "./polyfills";

/** Old browsers (e.g. Vivo's on Chrome 87) lack `at`, `Object.hasOwn` and `structuredClone`. */
describe("polyfills for older browsers", () => {
  test("at counts from the start, and from the end when negative", () => {
    const list = ["a", "b", "c"];
    expect(polyfillAt.call(list, 0)).toBe("a");
    expect(polyfillAt.call(list, -1)).toBe("c");
    expect(polyfillAt.call(list, -3)).toBe("a");
    expect(polyfillAt.call(list, 3)).toBeUndefined();
    expect(polyfillAt.call(list, -4)).toBeUndefined();
    expect(polyfillAt.call([], -1)).toBeUndefined();
    expect(polyfillAt.call("word", -1)).toBe("d");
    expect(polyfillAt.call(list, 1.7)).toBe("b");
  });

  test("the deep copy shares nothing with the original and keeps loops", () => {
    const shared = { level: 3 };
    const original: Record<string, unknown> = {
      buildings: [
        { t: 1, pos: shared },
        { t: 2, pos: shared },
      ],
      when: new Date(1_000),
      tags: new Set(["x"]),
      byId: new Map([[1, { hp: 5 }]]),
    };
    original.self = original;

    const copy = polyfillDeepCopy(original) as typeof original & {
      buildings: { pos: object }[];
    };
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
    expect(copy.buildings[0]!.pos).not.toBe(shared);
    expect(copy.buildings[0]!.pos).toBe(copy.buildings[1]!.pos);
    expect(copy.self).toBe(copy);
    expect(copy.when).not.toBe(original.when);
  });
});
