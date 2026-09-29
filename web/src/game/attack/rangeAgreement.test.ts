import { describe, expect, it } from "vitest";
import type { PlayerCell } from "@/api/types";
import { checkRange } from "../../../../server/src/services/maproom/v2/rangeCheck";
import { rosterInRange, type OwnCell } from "./attackEntry";

/**
 * The map's Attack gate and the server's range check agree, cell for cell
 * (issue #190).
 *
 * Both measure with the shared rule (`game/maproom/rules/range.ts` and its
 * server copy), but each wraps it in its own bookkeeping: the map sums the
 * reach of every own cell in the loaded zones, the server checks the main yard
 * and then sweeps a box for outposts. This drives both over a grid of targets
 * around a yard and an outpost, with and without Declare War, and requires
 * the same answer everywhere, so the overlay and the button never offer a cell
 * the server would refuse, nor hide one it would accept.
 */

const HOME = { col: 241, row: 207 };
const OUTPOST = { col: 230, row: 215 };

const own = (at: { col: number; row: number }, b: 2 | 3, f: number, bid: string): OwnCell => ({
  ...at,
  cell: {
    uid: 2505,
    b,
    i: 150,
    bid,
    aid: null,
    n: "agenttester",
    l: 12,
    v: 0,
    f,
    c: 0,
    dm: 0,
    d: 0,
    lo: 0,
    p: 0,
    mine: 1,
    pic_square: null,
    pi: 0,
    fr: 0,
    m: { housed: { C1: 1 } },
  } satisfies PlayerCell,
});

describe.each([false, true])("with Declare War %s", (declareWar) => {
  it.each([
    [4, 3],
    [2, 1],
    [1, 4],
  ])("agrees for a yard flinger %i and an outpost flinger %i", (yardFlinger, outpostFlinger) => {
    const cells = [own(HOME, 2, yardFlinger, "main"), own(OUTPOST, 3, outpostFlinger, "op")];
    const ownSave = declareWar ? { powerups: [{ id: "ap_declarewar", endtime: 1 }] } : {};
    let inReach = 0;

    for (let col = HOME.col - 20; col <= HOME.col + 20; col++) {
      for (let row = HOME.row - 20; row <= HOME.row + 20; row++) {
        const web = rosterInRange({ col, row }, cells, ownSave).flingerLevel > 0;
        const server = checkRange({
          homebase: [String(HOME.col), String(HOME.row)],
          flinger: yardFlinger,
          cell: { x: col, y: row },
          outposts: [[OUTPOST.col, OUTPOST.row, "op"]],
          outpostFlingers: new Map([["op", outpostFlinger]]),
          declareWar,
        }).ok;
        expect(web, `(${col}, ${row})`).toBe(server);
        if (server) inReach += 1;
      }
    }
    expect(inReach).toBeGreaterThan(0);
  });

  it("agrees across the world's seam", () => {
    const corner = { col: 1, row: 1 };
    const cells = [own(corner, 2, 4, "main")];
    const ownSave = declareWar ? { powerups: [{ id: "ap_declarewar" }] } : {};

    for (let dc = -14; dc <= 14; dc++) {
      for (let dr = -14; dr <= 14; dr++) {
        const col = (corner.col + dc + 800) % 800;
        const row = (corner.row + dr + 800) % 800;
        const web = rosterInRange({ col, row }, cells, ownSave).flingerLevel > 0;
        const server = checkRange({
          homebase: ["1", "1"],
          flinger: 4,
          cell: { x: col, y: row },
          outposts: [],
          outpostFlingers: new Map(),
          declareWar,
        }).ok;
        expect(web, `(${col}, ${row})`).toBe(server);
      }
    }
  });
});
