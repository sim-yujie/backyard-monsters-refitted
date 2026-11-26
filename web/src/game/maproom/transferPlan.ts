/**
 * Moving monsters from the world map (beta 9 #7, owner's "B1 steel plates",
 * 22 Nov 2026; made simpler after the owner's playtest, 23 Nov). Pure: what
 * the move tray offers and what a move would do — which yards get or give how
 * many of each monster — so the plates and the tray read one plan, and the
 * server gets exactly its pairs.
 *
 * Two kinds of move, both anchored on the yard the player started from:
 * - `out` ("Move from"): the anchor sends to ONE yard the player taps.
 * - `in` ("Bring to"): every other yard with monsters starts ticked and sends
 *   to the anchor; the main yard gives first, then the outposts nearest it.
 *
 * Every count starts at 0 and the player sets each one; a pick never goes past
 * what the ticked sources hold or what fits in the target's free room.
 *
 * The server checks it all again (`server/src/services/monsters/transferBatch.ts`):
 * this only keeps the tray honest about what will fit.
 */

/** One of the player's yards, as `POST /worldmapv2/ownarmies` gives it. */
export interface ArmyYard {
  readonly baseid: string;
  readonly main: boolean;
  /** Its map cell (col, row). */
  readonly x: number;
  readonly y: number;
  readonly housed: Readonly<Record<string, number>>;
  /** Room from its own Housing (540 at most on an outpost, 675 boosted). */
  readonly capacity: number;
  /** An attack is running there: it can neither send nor take. */
  readonly attack: boolean;
}

export type MoveMode = "out" | "in";

/** How many of each monster type the player picked (a type left out is 0). */
export type Picks = Readonly<Record<string, number>>;

export interface MoveState {
  readonly mode: MoveMode;
  /** The yard the move started from. */
  readonly anchor: string;
  /** `in`: the yards that send. `out`: the one target, or none yet. */
  readonly ticks: readonly string[];
  readonly picks: Picks;
}

/** What a move does. */
export interface MovePlan {
  /** Per target yard: monsters it gets. */
  readonly add: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Per source yard: monsters it gives. */
  readonly sub: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Per type, moved in all. */
  readonly moved: Readonly<Record<string, number>>;
  readonly total: number;
}

/** One pair for the server: `{ from, to, moved }`. */
export interface MovePair {
  readonly from: string;
  readonly to: string;
  readonly moved: Readonly<Record<string, number>>;
}

export type SizeOf = (id: string) => number;
export type DistanceOf = (a: ArmyYard, b: ArmyYard) => number;

/** Roster order: C1, C2, ... then the rest (Inferno monsters last). */
export const rosterOrder = (id: string): number => {
  const plain = /^C(\d+)$/.exec(id);
  if (plain) return Number(plain[1]);
  const inferno = /^IC(\d+)$/.exec(id);
  return inferno ? 500 + Number(inferno[1]) : 1_000;
};

const byRoster = (a: string, b: string): number => rosterOrder(a) - rosterOrder(b) || a.localeCompare(b);

/** The types a yard houses, in roster order. */
export const typesOf = (yard: ArmyYard): string[] =>
  Object.keys(yard.housed).filter((id) => (yard.housed[id] ?? 0) > 0).sort(byRoster);

/** Room a yard's monsters take. */
export const usedRoom = (yard: ArmyYard, sizeOf: SizeOf): number =>
  Object.entries(yard.housed).reduce((sum, [id, count]) => sum + Math.max(0, count) * sizeOf(id), 0);

/** Room left (never below 0). */
export const freeRoom = (yard: ArmyYard, sizeOf: SizeOf): number => Math.max(0, yard.capacity - usedRoom(yard, sizeOf));

/** Monsters a yard houses. */
export const headcount = (yard: ArmyYard): number =>
  Object.values(yard.housed).reduce((sum, count) => sum + Math.max(0, count), 0);

const sumCounts = (counts: Readonly<Record<string, number>> | undefined): number =>
  counts ? Object.values(counts).reduce((sum, count) => sum + count, 0) : 0;

const roomOfCounts = (counts: Readonly<Record<string, number>> | undefined, sizeOf: SizeOf): number =>
  counts ? Object.entries(counts).reduce((sum, [id, count]) => sum + count * sizeOf(id), 0) : 0;

export { sumCounts as countOf, roomOfCounts as roomOf };

/** One monster's room, never below 1 (a type the Academy does not know yet still takes room). */
const sizeOfOne = (sizeOf: SizeOf, id: string): number => Math.max(1, sizeOf(id));

/**
 * Whether a yard has room for even one of the smallest monster the move
 * could send (`smallest`, the smallest size on offer).
 */
export const isFull = (yard: ArmyYard, sizeOf: SizeOf, smallest: number): boolean =>
  freeRoom(yard, sizeOf) < Math.max(1, smallest);

/** The other yards, nearest the anchor first (then in list order). */
export const othersByDistance = (yards: readonly ArmyYard[], anchor: ArmyYard, distance: DistanceOf): ArmyYard[] =>
  yards
    .map((yard, index) => ({ yard, index, d: distance(anchor, yard) }))
    .filter(({ yard }) => yard.baseid !== anchor.baseid)
    .sort((a, b) => a.d - b.d || a.index - b.index)
    .map(({ yard }) => yard);

/**
 * The order sources give in when bringing to `target`: the main yard first,
 * then the outposts nearest the target (owner, 23 Nov 2026).
 */
export const sourceOrder = (sources: readonly ArmyYard[], target: ArmyYard, distance: DistanceOf): ArmyYard[] => {
  const near = othersByDistance(sources, target, distance);
  return [...near.filter((yard) => yard.main), ...near.filter((yard) => !yard.main)];
};

/**
 * Whether a yard can be ticked in this move. One end must be an outpost, so
 * with the main yard as the anchor only outposts can be ticked; with an
 * outpost as the anchor the main yard can be too. A yard under attack never;
 * in `out`, a full one cannot take; in `in`, an empty one has nothing to give.
 */
export const canTick = (
  yard: ArmyYard,
  anchor: ArmyYard,
  mode: MoveMode,
  sizeOf: SizeOf,
  smallest: number,
): boolean => {
  if (yard.baseid === anchor.baseid || yard.attack) return false;
  if (yard.main && anchor.main) return false;
  return mode === "out" ? !isFull(yard, sizeOf, smallest) : headcount(yard) > 0;
};

/** The yards ticked when a move opens: `in`, every yard that can send (main first, then nearest); `out`, none. */
export const firstTicks = (
  mode: MoveMode,
  yards: readonly ArmyYard[],
  anchor: ArmyYard,
  sizeOf: SizeOf,
  distance: DistanceOf,
): string[] =>
  mode === "out"
    ? []
    : sourceOrder(
        yards.filter((yard) => canTick(yard, anchor, "in", sizeOf, 1)),
        anchor,
        distance,
      ).map((yard) => yard.baseid);

/**
 * The ticks after a tap on `baseid` (already checked as tickable, or ticked).
 * `in`: ticks or unticks it. `out`: it becomes the one target, or, tapped
 * again, the target is cleared.
 */
export const tapTicks = (mode: MoveMode, ticks: readonly string[], baseid: string): string[] => {
  if (ticks.includes(baseid)) return ticks.filter((id) => id !== baseid);
  return mode === "out" ? [baseid] : [...ticks, baseid];
};

/** The sources and target of a move: the anchor on one side, the ticks on the other. */
export const endsOf = (
  state: MoveState,
  yards: ReadonlyMap<string, ArmyYard>,
  distance: DistanceOf,
): { src: ArmyYard[]; dst: ArmyYard[] } => {
  const anchor = yards.get(state.anchor);
  if (!anchor) return { src: [], dst: [] };
  const ticked = state.ticks
    .map((id) => yards.get(id))
    .filter((yard): yard is ArmyYard => yard !== undefined && yard.baseid !== anchor.baseid);
  return state.mode === "out"
    ? { src: [anchor], dst: ticked.slice(0, 1) }
    : { src: sourceOrder(ticked, anchor, distance), dst: [anchor] };
};

/** How many of a type the given sources hold. */
export const heldBy = (sources: readonly ArmyYard[], id: string): number =>
  sources.reduce((sum, yard) => sum + (yard.housed[id] ?? 0), 0);

/** The types the tray offers: the anchor's (out), or any tickable source's (in). */
export const trayTypes = (mode: MoveMode, anchorId: string, yards: readonly ArmyYard[], sizeOf: SizeOf): string[] => {
  const anchor = yards.find((yard) => yard.baseid === anchorId);
  if (!anchor) return [];
  if (mode === "out") return typesOf(anchor);
  const pool = new Set<string>();
  for (const yard of yards) {
    if (!canTick(yard, anchor, "in", sizeOf, 1)) continue;
    for (const id of typesOf(yard)) pool.add(id);
  }
  return [...pool].sort(byRoster);
};

/** The room the target has, or null when there is no target yet (`out`, before a tap): no cap. */
export const roomFor = (dst: readonly ArmyYard[], sizeOf: SizeOf): number | null =>
  dst[0] ? freeRoom(dst[0], sizeOf) : null;

/**
 * The picks cut to what the sources hold, then to the room, in roster order
 * (C1, C2, ... then IC*): a later type loses first. Zeroes are dropped.
 */
export const fitPicks = (
  picks: Picks,
  held: (id: string) => number,
  room: number | null,
  sizeOf: SizeOf,
): Record<string, number> => {
  const fitted: Record<string, number> = {};
  let left = room ?? Number.POSITIVE_INFINITY;
  for (const id of Object.keys(picks).sort(byRoster)) {
    const size = sizeOfOne(sizeOf, id);
    const n = Math.max(0, Math.min(Math.floor(picks[id] ?? 0), held(id), Math.floor(left / size)));
    if (n <= 0) continue;
    fitted[id] = n;
    left -= n * size;
  }
  return fitted;
};

/** The most of one type the player can pick, with the other picks as they are. */
export const maxFor = (
  id: string,
  picks: Picks,
  held: (id: string) => number,
  room: number | null,
  sizeOf: SizeOf,
): number => {
  const have = held(id);
  if (room === null) return have;
  const others = roomOfCounts({ ...picks, [id]: 0 }, sizeOf);
  return Math.max(0, Math.min(have, Math.floor((room - others) / sizeOfOne(sizeOf, id))));
};

/** "All": every type filled to as many as fit, in roster order, until the room is full. */
export const fillAll = (
  types: readonly string[],
  held: (id: string) => number,
  room: number | null,
  sizeOf: SizeOf,
): Record<string, number> => fitPicks(Object.fromEntries(types.map((id) => [id, held(id)])), held, room, sizeOf);

const bump = (into: Record<string, Record<string, number>>, yard: string, id: string, n: number): void => {
  const counts = (into[yard] ??= {});
  counts[id] = (counts[id] ?? 0) + n;
};

/**
 * What the move does: types in roster order, taken from the sources in their
 * order (main first, then nearest) into the one target's room.
 */
export const planMove = (
  src: readonly ArmyYard[],
  dst: readonly ArmyYard[],
  picked: Readonly<Record<string, number>>,
  sizeOf: SizeOf,
): MovePlan => {
  const add: Record<string, Record<string, number>> = {};
  const sub: Record<string, Record<string, number>> = {};
  const moved: Record<string, number> = {};
  let total = 0;
  const to = dst[0];
  if (src.length === 0 || !to) return { add, sub, moved, total };

  let room = freeRoom(to, sizeOf);
  for (const id of Object.keys(picked).sort(byRoster)) {
    const size = sizeOfOne(sizeOf, id);
    let want = picked[id] ?? 0;
    for (const from of src) {
      if (want <= 0) break;
      const n = Math.min(want, from.housed[id] ?? 0, Math.floor(room / size));
      if (n <= 0) continue;
      bump(add, to.baseid, id, n);
      bump(sub, from.baseid, id, n);
      moved[id] = (moved[id] ?? 0) + n;
      total += n;
      room -= n * size;
      want -= n;
    }
  }
  return { add, sub, moved, total };
};

/** The plan as the server's pairs: one per source and target. */
export const pairsOf = (plan: MovePlan, mode: MoveMode, anchor: string): MovePair[] =>
  mode === "out"
    ? Object.entries(plan.add).map(([to, moved]) => ({ from: anchor, to, moved }))
    : Object.entries(plan.sub).map(([from, moved]) => ({ from, to: anchor, moved }));

/** The whole move from a state: its ends, what the sources hold, the target's room, and the plan. */
export const currentPlan = (
  state: MoveState,
  yards: ReadonlyMap<string, ArmyYard>,
  sizeOf: SizeOf,
  distance: DistanceOf,
): { src: ArmyYard[]; dst: ArmyYard[]; held: (id: string) => number; room: number | null; plan: MovePlan } => {
  const ends = endsOf(state, yards, distance);
  const held = (id: string): number => heldBy(ends.src, id);
  const room = roomFor(ends.dst, sizeOf);
  return { ...ends, held, room, plan: planMove(ends.src, ends.dst, fitPicks(state.picks, held, room, sizeOf), sizeOf) };
};

/**
 * A yard's types for its plate: the ones moving to or from it first, then the
 * picked ones, then by the room they take.
 */
export const rankTypes = (
  yard: ArmyYard,
  sizeOf: SizeOf,
  picks: Picks = {},
  moving: Readonly<Record<string, number>> = {},
): string[] =>
  typesOf(yard).sort((a, b) => {
    const ma = moving[a] ?? 0;
    const mb = moving[b] ?? 0;
    if (ma !== mb) return mb - ma;
    const pa = (picks[a] ?? 0) > 0 ? 1 : 0;
    const pb = (picks[b] ?? 0) > 0 ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const ra = (yard.housed[a] ?? 0) * sizeOf(a);
    const rb = (yard.housed[b] ?? 0) * sizeOf(b);
    return rb - ra || (yard.housed[b] ?? 0) - (yard.housed[a] ?? 0) || byRoster(a, b);
  });
