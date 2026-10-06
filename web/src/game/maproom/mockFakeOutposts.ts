import { CellType, isPlayerCell, type MapCell, type PlayerCell } from "@/api/types";
import { mockFakeOutposts } from "./mockCellStyle";
import type { ZoneStore } from "./ZoneStore";

/**
 * MOCK-UP ONLY (branch `mock/hexcell-styles`): the dev database has no
 * outposts, so `?fakeOutposts=1` rewrites a few cells near the player's own
 * yard — discovered the first time it arrives — into outposts: two of the
 * player's own and two belonging to invented neighbours. It wraps `getCell`
 * on the client; nothing is sent to the server and the real cells underneath
 * are untouched.
 */
const OFFSETS: ReadonlyArray<{
  dx: number;
  dy: number;
  neighbour?: { name: string; level: number; uid: number };
}> = [
  { dx: 2, dy: -1 },
  { dx: -2, dy: 2 },
  { dx: 1, dy: 3, neighbour: { name: "Bramblefoot", level: 24, uid: 700_001 } },
  { dx: -3, dy: -1, neighbour: { name: "Grubwick", level: 31, uid: 700_002 } },
];

export const installMockOutposts = (store: ZoneStore): void => {
  if (!mockFakeOutposts) return;
  const original = store.getCell.bind(store);
  let origin: { x: number; y: number; cell: PlayerCell } | null = null;

  store.getCell = (x: number, y: number): MapCell | undefined => {
    const cell = original(x, y);
    if (!origin && cell && isPlayerCell(cell) && cell.mine === 1 && cell.b === CellType.HOME_CELL) {
      origin = { x, y, cell };
    }
    if (origin) {
      const here = origin;
      const offset = OFFSETS.find((candidate) => x === here.x + candidate.dx && y === here.y + candidate.dy);
      if (offset) return fakeOutpost(here.cell, offset.neighbour);
    }
    return cell;
  };
};

/**
 * The player's own yard, redrawn as an outpost — theirs, or a neighbour's.
 *
 * Built field by field, rather than spread from `own`, so none of its
 * optional properties (truce `t`, protection `pe`, `r`, `m`) tag along onto a
 * cell that should not have them.
 */
const fakeOutpost = (
  own: PlayerCell,
  neighbour?: { name: string; level: number; uid: number },
): PlayerCell => ({
  uid: neighbour?.uid ?? own.uid,
  b: CellType.OUTPOST,
  i: own.i,
  bid: own.bid,
  aid: own.aid,
  n: neighbour?.name ?? own.n,
  l: neighbour?.level ?? own.l,
  v: own.v,
  f: own.f,
  c: own.c,
  dm: own.dm,
  d: own.d,
  lo: own.lo,
  p: own.p,
  mine: neighbour ? 0 : 1,
  pic_square: neighbour ? null : own.pic_square,
  pi: 0,
  fr: own.fr,
});
