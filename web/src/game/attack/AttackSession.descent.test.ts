import { describe, expect, it } from "vitest";

import { devDescentYard } from "./AttackSession";

/** The dev build's `?descentYard=N`, for seeing the Descent burn in a practice (Inferno WP 1.21). */
describe("devDescentYard", () => {
  it("reads a Descent yard from 1 to 13", () => {
    expect(devDescentYard("?descentYard=7")).toEqual({ descentYard: 7 });
    expect(devDescentYard("?x=1&descentYard=13")).toEqual({ descentYard: 13 });
    expect(devDescentYard("?descentYard=1")).toEqual({ descentYard: 1 });
  });

  it("reads nothing else", () => {
    for (const search of [
      "",
      "?descentYard=0",
      "?descentYard=14",
      "?descentYard=7.5",
      "?descentYard=x",
    ]) {
      expect(devDescentYard(search)).toEqual({});
    }
  });
});
