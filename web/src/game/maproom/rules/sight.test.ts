import { describe, expect, it } from "vitest";
import {
  DECLARE_WAR_RANGE,
  mainYardRange,
  outpostRange,
  withDeclareWar,
  type RangeCell,
} from "./range";
import { isVisible, type RevealedCell, type SightSource } from "./sight";

/**
 * The Map Room 2 fog of war sight rule (issue #329,
 * `docs/design/fog-of-war.md` §3): own flinger reach, outposts measured from
 * their own cell, Declare War's +2 while it runs, reach 0 seeing only the
 * revealed cell itself, wrap at the world seam, an ally's circles unioned in,
 * and attacker bases revealed forever.
 */

const cell = (x: number, y: number): RangeCell => ({ x, y });
const source = (x: number, y: number, reach: number): SightSource => ({ x, y, reach });

describe("isVisible", () => {
  it("sees a cell inside a main yard's reach at every level", () => {
    const home = cell(100, 100);

    for (const level of [0, 1, 2, 3, 4, 9]) {
      const reach = mainYardRange(level);
      const sources: SightSource[] = [source(home.x, home.y, reach)];

      // The furthest cell the level reaches, and one step past it.
      expect(isVisible(cell(100 + reach, 100), sources, [])).toBe(reach > 0);
      if (reach > 0) expect(isVisible(cell(100 + reach + 1, 100), sources, [])).toBe(false);
    }
  });

  it("measures each outpost from its own cell, not the main yard's", () => {
    const outpost = cell(500, 500);

    for (const level of [1, 2, 3, 4]) {
      const reach = outpostRange(level);
      const sources: SightSource[] = [source(outpost.x, outpost.y, reach)];

      expect(isVisible(cell(500 + reach, 500), sources, [])).toBe(true);
      expect(isVisible(cell(500 + reach + 1, 500), sources, [])).toBe(false);
    }
  });

  it("adds Declare War's two cells to a circle only while it runs", () => {
    const home = cell(200, 200);
    const base = mainYardRange(2); // 6
    const atWar = withDeclareWar(base, true);
    const atPeace = withDeclareWar(base, false);

    expect(atWar).toBe(base + DECLARE_WAR_RANGE);

    const warSources: SightSource[] = [source(home.x, home.y, atWar)];
    const peaceSources: SightSource[] = [source(home.x, home.y, atPeace)];

    expect(isVisible(cell(home.x + base + 1, home.y), warSources, [])).toBe(true);
    expect(isVisible(cell(home.x + base + 1, home.y), peaceSources, [])).toBe(false);
  });

  it("gives a reach-0 circle no cells, not even its own", () => {
    const home = cell(300, 300);
    const sources: SightSource[] = [source(home.x, home.y, 0)];

    expect(isVisible(home, sources, [])).toBe(false);
  });

  it("sees the revealed cell itself even with no reach anywhere", () => {
    const home = cell(300, 300);
    const revealed: RevealedCell[] = [home];

    expect(isVisible(home, [], revealed)).toBe(true);
    expect(isVisible(cell(301, 300), [], revealed)).toBe(false);
  });

  it("wraps sight across the world's edges like the range rule", () => {
    // (799, 400) and (0, 400) are one hex step apart across the x seam.
    const sources: SightSource[] = [source(799, 400, 1)];
    expect(isVisible(cell(0, 400), sources, [])).toBe(true);

    const ySources: SightSource[] = [source(400, 799, 1)];
    expect(isVisible(cell(400, 0), ySources, [])).toBe(true);
  });

  it("unions an ally's circles and own cells with the player's own", () => {
    const mine = source(10, 10, 4);
    const allyCircle = source(600, 600, 4);
    const allyOwnCell = cell(700, 700);

    const sources: SightSource[] = [mine, allyCircle];
    const revealed: RevealedCell[] = [allyOwnCell];

    expect(isVisible(cell(10, 10), sources, revealed)).toBe(true); // mine
    expect(isVisible(cell(600, 600), sources, revealed)).toBe(true); // ally's circle
    expect(isVisible(allyOwnCell, sources, revealed)).toBe(true); // ally's own cell, reach 0 or not
    expect(isVisible(cell(750, 750), sources, revealed)).toBe(false); // outside everything
  });

  it("reveals an attacker's base forever, independent of every circle", () => {
    const attackerBase = cell(650, 12);
    const revealed: RevealedCell[] = [attackerBase];

    expect(isVisible(attackerBase, [], revealed)).toBe(true);
    // Being revealed is not being in range: a neighbouring cell stays dark.
    expect(isVisible(cell(651, 12), [], revealed)).toBe(false);
  });
});
