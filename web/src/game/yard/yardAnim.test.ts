import { describe, expect, it } from "vitest";
import { animPolicy, startFrame, stripCells, YARD_TICK_HZ } from "./yardAnim";

describe("the animation rate table", () => {
  it("ticks at the Flash stage's own frame rate", () => {
    // asconfig.json, "default-frame-rate": 40.
    expect(YARD_TICK_HZ).toBe(40);
  });

  it("runs the resource producers at one frame every third tick", () => {
    // BUILDING1.as:31 — `this._frameNumber % 3 == 0` in a yard being looked at.
    for (const type of [1, 2, 3, 4, 8]) {
      expect(animPolicy(type)?.ticksPerFrame, `type ${type}`).toBe(3);
    }
  });

  it("runs decorations at one frame every other tick", () => {
    // BDECORATION.as:37 — `this._frameNumber % 2 == 0`.
    for (const type of [28, 40, 50, 53, 71, 105]) {
      expect(animPolicy(type)?.ticksPerFrame, `type ${type}`).toBe(2);
    }
  });

  it("holds every tower on one cell", () => {
    // A tower's strip is a facing, not a loop: `_animTick` comes from the angle
    // to the target and `AnimFrame` never advances it (BUILDING21.as:27-32).
    for (const type of [21, 22, 23, 25, 115, 118, 129, 132, 136, 137]) {
      expect(animPolicy(type)?.ticksPerFrame, `type ${type}`).toBeNull();
    }
  });

  it("holds the producers while a countdown is running", () => {
    // BUILDING1.as:30 — `_countdownBuild + _countdownUpgrade + _countdownFortify == 0`.
    for (const type of [1, 2, 3, 4, 6, 8, 13, 26, 116]) {
      expect(animPolicy(type)?.pauseWhileBusy, `type ${type}`).toBe(true);
    }
  });

  it("keeps decorations and the taunt totem running regardless", () => {
    // Neither BDECORATION nor BUILDING52 guards on a countdown.
    for (const type of [28, 50, 52, 105]) {
      expect(animPolicy(type)?.pauseWhileBusy, `type ${type}`).toBe(false);
    }
  });

  it("has nothing to say about a type with no strip", () => {
    expect(animPolicy(17)).toBeNull();
    expect(animPolicy(9999)).toBeNull();
  });
});

describe("the starting cell", () => {
  it("spreads a row of identical towers across the strip", () => {
    const policy = animPolicy(21)!;
    const cells = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((id) => startFrame(policy, 30, id)));
    expect(cells.size).toBeGreaterThan(5);
  });

  it("never picks the last two cells", () => {
    // BFOUNDATION.as:1136 — `int(Math.random() * (_animFrames - 2))`.
    const policy = animPolicy(21)!;
    for (let id = 1; id < 500; id++) {
      expect(startFrame(policy, 30, id)).toBeLessThanOrEqual(27);
    }
  });

  it("starts the classes that opt out on cell 0", () => {
    // BUILDING4.as:28, BUILDING13.as:24, SpurtzCannon.as:49 and the four types
    // BFOUNDATION.as:1141 names outright.
    for (const type of [4, 9, 13, 19, 25, 54, 129, 136, 137]) {
      expect(startFrame(animPolicy(type)!, 30, 7), `type ${type}`).toBe(0);
    }
  });

  it("is the same cell for the same building every visit", () => {
    const policy = animPolicy(21)!;
    expect(startFrame(policy, 30, 4242)).toBe(startFrame(policy, 30, 4242));
  });
});

describe("fitting a strip to its file", () => {
  it("leaves a strip that matches its file alone", () => {
    // Sniper Tower: 30 cells of 55 x 47, file 1650 x 47.
    expect(stripCells({ width: 55, height: 47, frames: 30 }, 1650, 47)).toEqual({
      width: 55,
      height: 47,
      frames: 30,
    });
  });

  it("drops the cells a short file does not have", () => {
    // Loot Locker anim.4: the table claims 21 cells of a 20-cell file.
    expect(stripCells({ width: 92, height: 89, frames: 21 }, 1840, 89).frames).toBe(20);
  });

  it("keeps the table's count when the file has spare cells", () => {
    // Fountain: 45 cells on disk, 42 of them played.
    expect(stripCells({ width: 89, height: 114, frames: 42 }, 4005, 114).frames).toBe(42);
  });

  it("trims a cell taller than its file", () => {
    // Lightning Tower's damaged strip claims cells 57 tall of a 27-tall file.
    expect(stripCells({ width: 30, height: 57, frames: 55 }, 1650, 27)).toEqual({
      width: 30,
      height: 27,
      frames: 55,
    });
  });

  it("reduces a grid to the row it can read", () => {
    // One pumpkin strip is 15 x 3 cells, described as 45 in a row.
    expect(stripCells({ width: 189, height: 155, frames: 45 }, 2835, 465).frames).toBe(15);
  });

  it("never returns fewer than one cell", () => {
    expect(stripCells({ width: 500, height: 500, frames: 10 }, 40, 40)).toEqual({
      width: 40,
      height: 40,
      frames: 1,
    });
  });
});
