/**
 * Smart Repeat attack (owner, 16 Nov 2026, `agent-handoffs/smart-repeat-spec.md`):
 * when the yards whose Flinger reaches a camp do not hold the army a Repeat
 * attack needs, which monsters to move in from the player's other yards first.
 *
 * Pure: the caller hands over every yard as it is now (caught up, with its
 * housing and whether it is under attack) and gets back one verdict:
 *
 * - `ready`: the yards in range already hold the army; nothing moves.
 * - `moves`: the moves that make it so, each one source yard to one yard in
 *   range, carrying one or more monster types.
 * - `short`: even every yard together cannot gather the army.
 * - `housing`: the army could be gathered, but the yards in range have no room
 *   for the monsters that must move in.
 *
 * The rule (deterministic greedy, no optimal solver, owner: "fewest moves"):
 *
 * 1. The monsters already in range are used first; only the shortfall moves.
 * 2. Sources: the yards out of range that are not under attack. The one that
 *    covers most of what is still missing (in housing space) goes first, ties
 *    to the main yard and then the lower base id, and gives all it can; then
 *    the next, until nothing is missing.
 * 3. Destinations: the yards in range that are not under attack, with their
 *    free housing (capacity less what they house now). Each source's load,
 *    the biggest first, goes whole into the yard in range with the least room
 *    that still fits it; a load no single yard fits is split, the biggest
 *    monsters first, across the roomiest yards.
 *
 * Packing is checked monster by monster against each real yard, never the sum
 * of free space: a load refused here does not fit the way this rule places it.
 * Being a greedy, it can refuse a rare load that a cleverer split would fit
 * (the owner asked for a simple rule); it never says yes to one that does not.
 *
 * A move always has an outpost at one end, as the transfer rules require:
 * sources are out of range and destinations in range, so the main yard is at
 * most one end. Champions never move (they are not housed in a yard).
 */

/** Counts per monster id. */
export type Counts = Record<string, number>;

/** One of the player's yards, as it is now. */
export interface PlanYard {
  readonly baseid: string;
  /** The main yard (every other yard here is an outpost). */
  readonly main: boolean;
  /** Its own Flinger reaches the camp (`ownYardsInReach`). */
  readonly reaches: boolean;
  /** What it houses now, caught up. */
  readonly housed: Readonly<Counts>;
  /** Its Monster Housing capacity (`deriveHousingCapacity`). */
  readonly capacity: number;
  /** Under attack: nothing may move in or out (`transferMonsters`). */
  readonly busy: boolean;
}

/** One move: monsters from one yard to one yard in range. */
export interface YardMove {
  readonly from: string;
  readonly to: string;
  readonly monsters: Readonly<Counts>;
}

/** A monster type the army lacks even counting every yard. */
export interface MoveShort {
  readonly id: string;
  readonly need: number;
  /** In range plus what the other yards could send. */
  readonly have: number;
}

export type MovePlan =
  | { readonly kind: "ready" }
  | { readonly kind: "moves"; readonly moves: readonly YardMove[] }
  | { readonly kind: "short"; readonly short: readonly MoveShort[] }
  | {
      readonly kind: "housing";
      /** Housing space the monsters that must move in take. */
      readonly need: number;
      /** Free housing in each yard in range that can take monsters, in range order. */
      readonly free: readonly { readonly baseid: string; readonly free: number }[];
    };

/** Housing space one monster of a type takes (`monsterStorage` at the player's levels). */
export type SizeOf = (id: string) => number;

const total = (counts: Readonly<Counts>, sizeOf: SizeOf): number =>
  Object.entries(counts).reduce((sum, [id, count]) => sum + sizeOf(id) * count, 0);

const positive = (counts: Counts): Counts => {
  const out: Counts = {};
  for (const [id, count] of Object.entries(counts)) if (count > 0) out[id] = count;
  return out;
};

/** Ids biggest monster first, then by id, so a split is the same every time. */
const bySize = (ids: string[], sizeOf: SizeOf): string[] =>
  ids.sort((one, other) => sizeOf(other) - sizeOf(one) || one.localeCompare(other));

/**
 * The moves a Repeat attack needs first (see the file comment).
 *
 * @param needs - Monsters the plan flings, per id (`planNeeds().monsters`).
 * @param yards - Every yard of the player's, main yard first.
 * @param sizeOf - Housing space per monster.
 */
export const planMoves = (needs: Readonly<Counts>, yards: readonly PlanYard[], sizeOf: SizeOf): MovePlan => {
  // 1. What the yards in range lack.
  const inRange: Counts = {};
  for (const yard of yards) {
    if (!yard.reaches) continue;
    for (const [id, count] of Object.entries(yard.housed)) if (count > 0) inRange[id] = (inRange[id] ?? 0) + count;
  }
  const gap = positive(
    Object.fromEntries(Object.entries(needs).map(([id, need]) => [id, need - (inRange[id] ?? 0)])),
  );
  if (Object.keys(gap).length === 0) return { kind: "ready" };

  // 2. Whether the other yards can make it up at all.
  const sources = yards.filter((yard) => !yard.reaches && !yard.busy);
  const short: MoveShort[] = [];
  for (const [id, missing] of Object.entries(gap)) {
    const spare = sources.reduce((sum, yard) => sum + Math.max(0, yard.housed[id] ?? 0), 0);
    if (spare < missing) short.push({ id, need: needs[id] ?? 0, have: (inRange[id] ?? 0) + spare });
  }
  if (short.length > 0) return { kind: "short", short };

  // 3. Sources, greedily: the one covering most of what is left first.
  const left: Counts = { ...gap };
  const loads: { from: PlanYard; monsters: Counts }[] = [];
  const unused = [...sources];
  while (Object.values(left).some((count) => count > 0)) {
    let best: { yard: PlanYard; take: Counts; space: number; count: number } | null = null;
    for (const yard of unused) {
      const take: Counts = {};
      for (const [id, owed] of Object.entries(left)) {
        const give = Math.min(owed, Math.max(0, yard.housed[id] ?? 0));
        if (give > 0) take[id] = give;
      }
      if (Object.keys(take).length === 0) continue;
      const space = total(take, sizeOf);
      const count = Object.values(take).reduce((sum, one) => sum + one, 0);
      // More housing space covered, then more monsters, then the main yard, then the lower base id.
      const better =
        !best ||
        (space - best.space ||
          count - best.count ||
          Number(yard.main) - Number(best.yard.main) ||
          best.yard.baseid.localeCompare(yard.baseid)) > 0;
      if (better) best = { yard, take, space, count };
    }
    // Step 2 proved the sources hold enough, so there is always one.
    if (!best) break;
    unused.splice(unused.indexOf(best.yard), 1);
    for (const [id, give] of Object.entries(best.take)) left[id] = (left[id] ?? 0) - give;
    loads.push({ from: best.yard, monsters: best.take });
  }

  // 4. Destinations: each load whole into the tightest yard it fits, else split.
  const receivers = yards
    .filter((yard) => yard.reaches && !yard.busy)
    .map((yard) => ({ yard, free: Math.max(0, yard.capacity - total(yard.housed, sizeOf)) }));
  const room = receivers.map(({ yard, free }) => ({ baseid: yard.baseid, free }));
  const refused = (): MovePlan => ({ kind: "housing", need: total(gap, sizeOf), free: room });
  // A move needs an outpost at one end; the main yard never sends to itself.
  const canTake = (from: PlanYard, to: PlanYard) => from.baseid !== to.baseid && !(from.main && to.main);

  const moves = new Map<string, Counts>();
  const add = (from: string, to: string, id: string, count: number) => {
    const key = `${from}>${to}`;
    const counts = moves.get(key) ?? {};
    counts[id] = (counts[id] ?? 0) + count;
    moves.set(key, counts);
  };

  const ordered = [...loads].sort(
    (one, other) => total(other.monsters, sizeOf) - total(one.monsters, sizeOf) || one.from.baseid.localeCompare(other.from.baseid),
  );
  for (const load of ordered) {
    const size = total(load.monsters, sizeOf);
    const whole = receivers
      .filter((receiver) => canTake(load.from, receiver.yard) && receiver.free >= size)
      .sort((one, other) => one.free - other.free || one.yard.baseid.localeCompare(other.yard.baseid))[0];
    if (whole) {
      whole.free -= size;
      for (const [id, count] of Object.entries(load.monsters)) add(load.from.baseid, whole.yard.baseid, id, count);
      continue;
    }
    const remaining: Counts = { ...load.monsters };
    const roomiest = receivers
      .filter((receiver) => canTake(load.from, receiver.yard))
      .sort((one, other) => other.free - one.free || one.yard.baseid.localeCompare(other.yard.baseid));
    for (const receiver of roomiest) {
      for (const id of bySize(Object.keys(remaining), sizeOf)) {
        const each = sizeOf(id);
        const want = remaining[id] ?? 0;
        const fits = each <= 0 ? want : Math.min(want, Math.floor(receiver.free / each));
        if (fits <= 0) continue;
        receiver.free -= fits * each;
        remaining[id] = want - fits;
        add(load.from.baseid, receiver.yard.baseid, id, fits);
      }
    }
    if (Object.values(remaining).some((count) => count > 0)) return refused();
  }

  const list: YardMove[] = [...moves.entries()].map(([key, monsters]) => {
    const [from, to] = key.split(">") as [string, string];
    return { from, to, monsters };
  });
  return { kind: "moves", moves: list };
};

/**
 * One string that names a set of moves exactly: what the prompt showed, sent
 * back on "Move and attack" so the server can tell the plan has not changed.
 * The server never moves what the client sends; it re-plans and compares.
 */
export const movesKey = (moves: readonly YardMove[]): string =>
  moves
    .map(
      (move) =>
        `${move.from}>${move.to}:` +
        Object.entries(move.monsters)
          .filter(([, count]) => count > 0)
          .sort(([one], [other]) => one.localeCompare(other))
          .map(([id, count]) => `${id}=${count}`)
          .join(","),
    )
    .sort()
    .join(";");
