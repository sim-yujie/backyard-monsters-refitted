/**
 * Moving monsters from the world map (beta 9 #7, owner's "B1 steel plates",
 * 22 Nov 2026). Pure: what the move tray offers and what a move would do —
 * which yards get or give how many of each monster — so the plates, the tray
 * and the list all read one plan, and the server gets exactly its pairs.
 *
 * Two kinds of move, both anchored on the yard the player started from:
 * - `out`: the anchor sends to the yards ticked (one source, many targets),
 *   filled in order nearest first, or split evenly one by one.
 * - `in`: the yards ticked send to the anchor (many sources, one target),
 *   nearest first.
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

/** How many of a type: every one the sources hold, or a number the player set. */
export type MonsterPick = "all" | number;

export interface MoveState {
  readonly mode: MoveMode;
  /** The yard the move started from. */
  readonly anchor: string;
  /** The yards ticked, in the order ticked. */
  readonly ticks: readonly string[];
  /** Monster types picked. */
  readonly picks: Readonly<Record<string, MonsterPick>>;
  /** `out` with several targets: one by one round the targets (true) or each filled in turn. */
  readonly even: boolean;
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
  /** Per type, picked but left behind for want of room. */
  readonly left: Readonly<Record<string, number>>;
  readonly leftTotal: number;
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

/** The sources and targets of a move: the anchor on one side, the ticks (nearest first) on the other. */
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
  const near = othersByDistance(ticked, anchor, distance);
  return state.mode === "out" ? { src: [anchor], dst: near } : { src: near, dst: [anchor] };
};

/** How many of a type the given sources hold. */
export const heldBy = (sources: readonly ArmyYard[], id: string): number =>
  sources.reduce((sum, yard) => sum + (yard.housed[id] ?? 0), 0);

/** The types the tray offers: the anchor's (out), or any tickable source's (in). */
export const trayTypes = (
  state: MoveState,
  yards: readonly ArmyYard[],
  sizeOf: SizeOf,
): string[] => {
  const anchor = yards.find((yard) => yard.baseid === state.anchor);
  if (!anchor) return [];
  if (state.mode === "out") return typesOf(anchor);
  const pool = new Set<string>();
  for (const yard of yards) {
    if (!canTick(yard, anchor, "in", sizeOf, 1)) continue;
    for (const id of typesOf(yard)) pool.add(id);
  }
  return [...pool].sort(byRoster);
};

/** How many of each picked type the move asks for, cut to what the sources hold. */
export const pickedCounts = (state: MoveState, sources: readonly ArmyYard[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const [id, pick] of Object.entries(state.picks)) {
    const held = heldBy(sources, id);
    const want = pick === "all" ? held : Math.max(0, Math.min(Math.floor(pick), held));
    if (want > 0) counts[id] = want;
  }
  return counts;
};

const bump = (into: Record<string, Record<string, number>>, yard: string, id: string, n: number): void => {
  const counts = (into[yard] ??= {});
  counts[id] = (counts[id] ?? 0) + n;
};

/**
 * What the move does: types in roster order; `out` fills the targets nearest
 * first (or, `even`, one at a time round them), `in` takes from the sources
 * nearest first into the anchor's room.
 */
export const planMove = (
  src: readonly ArmyYard[],
  dst: readonly ArmyYard[],
  picked: Readonly<Record<string, number>>,
  even: boolean,
  sizeOf: SizeOf,
): MovePlan => {
  const add: Record<string, Record<string, number>> = {};
  const sub: Record<string, Record<string, number>> = {};
  const moved: Record<string, number> = {};
  const left: Record<string, number> = {};
  let total = 0;
  let leftTotal = 0;
  if (src.length === 0 || dst.length === 0) return { add, sub, moved, total, left, leftTotal };

  const room = new Map(dst.map((yard) => [yard.baseid, freeRoom(yard, sizeOf)]));
  const give = (from: ArmyYard, to: ArmyYard, id: string, n: number): void => {
    bump(add, to.baseid, id, n);
    bump(sub, from.baseid, id, n);
    moved[id] = (moved[id] ?? 0) + n;
    total += n;
    room.set(to.baseid, (room.get(to.baseid) ?? 0) - n * sizeOf(id));
  };

  for (const id of Object.keys(picked).sort(byRoster)) {
    const size = Math.max(1, sizeOf(id));
    let want = picked[id] ?? 0;
    if (want <= 0) continue;
    if (src.length === 1) {
      const from = src[0]!;
      want = Math.min(want, from.housed[id] ?? 0);
      if (even && dst.length > 1) {
        // Round and round the targets, one each, until none has room or none is left.
        let placed = true;
        const given = new Map<string, number>();
        while (want > 0 && placed) {
          placed = false;
          for (const to of dst) {
            if (want <= 0) break;
            if ((room.get(to.baseid) ?? 0) < size) continue;
            given.set(to.baseid, (given.get(to.baseid) ?? 0) + 1);
            room.set(to.baseid, (room.get(to.baseid) ?? 0) - size);
            want -= 1;
            placed = true;
          }
        }
        for (const to of dst) {
          const n = given.get(to.baseid) ?? 0;
          if (n <= 0) continue;
          // `give` takes the room again: hand it back first.
          room.set(to.baseid, (room.get(to.baseid) ?? 0) + n * size);
          give(from, to, id, n);
        }
      } else {
        for (const to of dst) {
          if (want <= 0) break;
          const n = Math.min(want, Math.floor((room.get(to.baseid) ?? 0) / size));
          if (n > 0) {
            give(from, to, id, n);
            want -= n;
          }
        }
      }
    } else {
      const to = dst[0]!;
      for (const from of src) {
        if (want <= 0) break;
        const n = Math.min(want, from.housed[id] ?? 0, Math.floor((room.get(to.baseid) ?? 0) / size));
        if (n > 0) {
          give(from, to, id, n);
          want -= n;
        }
      }
    }
    if (want > 0) {
      left[id] = want;
      leftTotal += want;
    }
  }
  return { add, sub, moved, total, left, leftTotal };
};

/** The plan as the server's pairs: one per source and target. */
export const pairsOf = (plan: MovePlan, mode: MoveMode, anchor: string): MovePair[] =>
  mode === "out"
    ? Object.entries(plan.add).map(([to, moved]) => ({ from: anchor, to, moved }))
    : Object.entries(plan.sub).map(([from, moved]) => ({ from, to: anchor, moved }));

/** The whole move from a state: its ends, the counts asked, and the plan. */
export const currentPlan = (
  state: MoveState,
  yards: ReadonlyMap<string, ArmyYard>,
  sizeOf: SizeOf,
  distance: DistanceOf,
): { src: ArmyYard[]; dst: ArmyYard[]; picked: Record<string, number>; plan: MovePlan } => {
  const ends = endsOf(state, yards, distance);
  // `in` with nothing ticked yet: the counts read from every source that could be ticked.
  const picked = pickedCounts(state, ends.src);
  return { ...ends, picked, plan: planMove(ends.src, ends.dst, picked, state.even, sizeOf) };
};

/** The `n` nearest outposts with room (`out`), for "Near 5". */
export const nearestWithRoom = (
  yards: readonly ArmyYard[],
  anchor: ArmyYard,
  sizeOf: SizeOf,
  smallest: number,
  distance: DistanceOf,
  n = 5,
): string[] =>
  othersByDistance(yards, anchor, distance)
    .filter((yard) => !yard.main && canTick(yard, anchor, "out", sizeOf, smallest))
    .slice(0, n)
    .map((yard) => yard.baseid);

/** Every yard with monsters that can send to the anchor (`in`): "All home". */
export const everySource = (
  yards: readonly ArmyYard[],
  anchor: ArmyYard,
  sizeOf: SizeOf,
  distance: DistanceOf,
): string[] =>
  othersByDistance(yards, anchor, distance)
    .filter((yard) => canTick(yard, anchor, "in", sizeOf, 1))
    .map((yard) => yard.baseid);

/**
 * A yard's types for its plate: the ones moving to or from it first, then the
 * picked ones, then by the room they take.
 */
export const rankTypes = (
  yard: ArmyYard,
  sizeOf: SizeOf,
  picks: Readonly<Record<string, MonsterPick>> = {},
  moving: Readonly<Record<string, number>> = {},
): string[] =>
  typesOf(yard).sort((a, b) => {
    const ma = moving[a] ?? 0;
    const mb = moving[b] ?? 0;
    if (ma !== mb) return mb - ma;
    const pa = picks[a] !== undefined ? 1 : 0;
    const pb = picks[b] !== undefined ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const ra = (yard.housed[a] ?? 0) * sizeOf(a);
    const rb = (yard.housed[b] ?? 0) * sizeOf(b);
    return rb - ra || (yard.housed[b] ?? 0) - (yard.housed[a] ?? 0) || byRoster(a, b);
  });

/** The type moving most to or from a yard, for its "+11 [icon]" tag. */
export const topOf = (counts: Readonly<Record<string, number>>): string | null => {
  let best: string | null = null;
  for (const [id, n] of Object.entries(counts)) if (best === null || n > (counts[best] ?? 0)) best = id;
  return best;
};

/** A yard after the plan: what it houses once the move lands. */
export const afterPlan = (yard: ArmyYard, plan: MovePlan): ArmyYard => {
  const add = plan.add[yard.baseid];
  const sub = plan.sub[yard.baseid];
  if (!add && !sub) return yard;
  const housed: Record<string, number> = { ...yard.housed };
  for (const [id, n] of Object.entries(add ?? {})) housed[id] = (housed[id] ?? 0) + n;
  for (const [id, n] of Object.entries(sub ?? {})) {
    housed[id] = (housed[id] ?? 0) - n;
    if (housed[id]! <= 0) delete housed[id];
  }
  return { ...yard, housed };
};

/** Matches a yard against the list's search: its name or its coordinates ("240, 209" or "240,209"). */
export const matchesSearch = (name: string, yard: ArmyYard, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const plain = q.replace(/\s+/g, "");
  return name.toLowerCase().includes(q) || `${yard.x},${yard.y}`.includes(plain);
};
