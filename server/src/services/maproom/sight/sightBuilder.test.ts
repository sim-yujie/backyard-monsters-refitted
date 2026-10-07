import { describe, expect, test } from "bun:test";

import {
  attackerRevealedCells,
  mainYardSource,
  outpostSources,
  ownRevealedCells,
  ownSources,
  sightVersionOf,
  type OwnBaseSave,
} from "./sightBuilder.js";

/**
 * The database-free half of the Map Room 2 fog of war rule (issue #329):
 * turning a save's own fields into sight circles and revealed cells.
 */

const save = (over: Partial<OwnBaseSave> = {}): OwnBaseSave => ({
  homebase: ["100", "100"],
  flinger: 2,
  outposts: [],
  ...over,
});

describe("mainYardSource", () => {
  test("a main yard with a cell gets a circle at its reach", () => {
    expect(mainYardSource(save({ flinger: 2 }), false)).toEqual({ x: 100, y: 100, reach: 6 });
  });

  test("Declare War adds its two cells while running", () => {
    expect(mainYardSource(save({ flinger: 2 }), true)).toEqual({ x: 100, y: 100, reach: 8 });
  });

  test("flinger 0 still gets a circle, just one that reaches nothing", () => {
    expect(mainYardSource(save({ flinger: 0 }), false)).toEqual({ x: 100, y: 100, reach: 0 });
  });

  test("no homebase cell at all is not a circle", () => {
    expect(mainYardSource(save({ homebase: [] }), false)).toBeNull();
    expect(mainYardSource(save({ homebase: null }), false)).toBeNull();
  });
});

describe("outpostSources", () => {
  const outposts: [number, number, string][] = [
    [200, 200, "a"],
    [300, 300, "b"],
  ];

  test("each outpost is measured from its own cell with its own flinger level", () => {
    const flingerLevels = new Map([
      ["a", 3],
      ["b", 1],
    ]);

    expect(outpostSources({ outposts }, flingerLevels, false)).toEqual([
      { x: 200, y: 200, reach: 3 },
      { x: 300, y: 300, reach: 1 },
    ]);
  });

  test("Declare War adds to every outpost circle while running", () => {
    const flingerLevels = new Map([["a", 3]]);
    expect(outpostSources({ outposts: [[200, 200, "a"]] }, flingerLevels, true)).toEqual([
      { x: 200, y: 200, reach: 5 },
    ]);
  });

  test("an outpost whose save row is gone (not in the map) is skipped", () => {
    const flingerLevels = new Map([["a", 3]]);
    expect(outpostSources({ outposts }, flingerLevels, false)).toEqual([{ x: 200, y: 200, reach: 3 }]);
  });

  test("no outposts is an empty list", () => {
    expect(outpostSources({ outposts: [] }, new Map(), false)).toEqual([]);
    expect(outpostSources({ outposts: undefined }, new Map(), false)).toEqual([]);
  });
});

describe("ownSources", () => {
  test("combines the main yard's circle with every outpost's", () => {
    const outposts: [number, number, string][] = [[200, 200, "a"]];
    const flingerLevels = new Map([["a", 4]]);

    expect(ownSources(save({ flinger: 1, outposts }), flingerLevels, false)).toEqual([
      { x: 100, y: 100, reach: 4 },
      { x: 200, y: 200, reach: 4 },
    ]);
  });

  test("no main yard cell still returns the outposts", () => {
    const outposts: [number, number, string][] = [[200, 200, "a"]];
    const flingerLevels = new Map([["a", 4]]);

    expect(ownSources(save({ homebase: [], outposts }), flingerLevels, false)).toEqual([
      { x: 200, y: 200, reach: 4 },
    ]);
  });
});

describe("ownRevealedCells", () => {
  test("the main yard and every outpost, regardless of flinger reach", () => {
    const outposts: [number, number, string][] = [
      [200, 200, "a"],
      [300, 300, "b"],
    ];

    expect(ownRevealedCells({ homebase: ["100", "100"], outposts })).toEqual([
      { x: 100, y: 100 },
      { x: 200, y: 200 },
      { x: 300, y: 300 },
    ]);
  });

  test("no homebase cell leaves only the outposts", () => {
    expect(ownRevealedCells({ homebase: null, outposts: [[200, 200, "a"]] })).toEqual([{ x: 200, y: 200 }]);
  });

  test("no outposts leaves only the main yard", () => {
    expect(ownRevealedCells({ homebase: ["5", "6"], outposts: [] })).toEqual([{ x: 5, y: 6 }]);
  });
});

describe("attackerRevealedCells", () => {
  test("keeps only the coordinates of each attacker base", () => {
    expect(attackerRevealedCells([{ x: 1, y: 2 }, { x: 3, y: 4 }])).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });

  test("no attackers is an empty list", () => {
    expect(attackerRevealedCells([])).toEqual([]);
  });
});

describe("sightVersionOf", () => {
  test("is the same hash regardless of the order sources and revealed cells arrive in", () => {
    const sources = [
      { x: 100, y: 100, reach: 6 },
      { x: 200, y: 200, reach: 4 },
    ];
    const revealed = [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ];

    expect(sightVersionOf(sources, revealed)).toBe(
      sightVersionOf([...sources].reverse(), [...revealed].reverse()),
    );
  });

  test("changes when a source or a revealed cell changes", () => {
    const base = sightVersionOf([{ x: 100, y: 100, reach: 6 }], [{ x: 1, y: 1 }]);

    expect(sightVersionOf([{ x: 100, y: 100, reach: 7 }], [{ x: 1, y: 1 }])).not.toBe(base);
    expect(sightVersionOf([{ x: 100, y: 100, reach: 6 }], [{ x: 1, y: 2 }])).not.toBe(base);
    expect(sightVersionOf([], [])).not.toBe(base);
  });

  test("is stable for the same input", () => {
    const sources = [{ x: 100, y: 100, reach: 6 }];
    const revealed = [{ x: 1, y: 1 }];
    expect(sightVersionOf(sources, revealed)).toBe(sightVersionOf(sources, revealed));
  });
});
