import { AREA_ZONE_SIZE, MAX_HEX_CELLS } from "@/config";
import { zonesForRange, type CellRange, type ZoneRef } from "./zones";

/**
 * Chunk bookkeeping for the map renderer.
 *
 * A chunk is exactly one server zone: 10 x 10 cells on a multiple of 10. Tying
 * the two together is the whole point. A zone response is the only thing that
 * can change what a chunk looks like, so "a zone arrived" maps to "rebuild one
 * chunk" with no lookup and no cross-chunk invalidation: every cell in a chunk
 * reads its data from that one zone record (see zones.ts on belongs-to).
 *
 * Nothing here touches Pixi. The renderer owns the display objects; this owns
 * the question of which chunks should exist, and for how long.
 */

/** Cells across and down one chunk. */
export const CHUNK_SIZE = AREA_ZONE_SIZE;

/** A chunk's identity: the same id, origin and key space as its zone. */
export type ChunkRef = ZoneRef;

/**
 * Every chunk touching a cell range, clamped to the world.
 *
 * This is the renderer's visibility test. It is deliberately the same function
 * the zone fetcher uses, so a chunk is never drawn for a zone that was never
 * asked for and vice versa.
 */
export const chunksForRange = (range: CellRange): ChunkRef[] => zonesForRange(range);

/** The inclusive cell rectangle a chunk covers. */
export const chunkCells = (chunk: ChunkRef): CellRange => ({
  minCol: chunk.originX,
  maxCol: chunk.originX + CHUNK_SIZE - 1,
  minRow: chunk.originY,
  maxRow: chunk.originY + CHUNK_SIZE - 1,
});

/**
 * How long a chunk survives after it was last on screen.
 *
 * Long enough that panning away and back, or opening a panel and returning,
 * finds it still built — a 1,200 px drag takes under three seconds. Short
 * enough that wandering the map does not leave a trail of sprites behind for
 * the rest of the session. A chunk costs about a millisecond to rebuild, so
 * being wrong about this is cheap in both directions.
 */
export const CHUNK_TTL_MS = 15_000;

/**
 * Hard cap on built chunks, for the case the clock cannot cover: one long
 * uninterrupted sweep where nothing is ever idle for fifteen seconds. Derived
 * from the renderer's per-pass hex cap, so it is the same 16,000 cells — about
 * three screens at the closest zoom that still uses chunks.
 */
export const MAX_RESIDENT_CHUNKS = MAX_HEX_CELLS / (CHUNK_SIZE * CHUNK_SIZE);

export interface ResidencyOptions {
  /** How long a chunk may stay built after it was last on screen. */
  ttlMs: number;
  /** Hard cap on built chunks, whatever the clock says. */
  maxResident: number;
}

/**
 * Which built chunks are worth keeping.
 *
 * Two rules, in order. A chunk that has been off screen longer than `ttlMs`
 * goes, because rebuilding it costs about a millisecond and holding it costs
 * a few hundred sprites. Then, if more than `maxResident` are still built, the
 * least recently seen go until the count is back at the cap — that rule exists
 * for the case the clock cannot cover, a long uninterrupted sweep across the
 * world where nothing is ever idle long enough to expire.
 *
 * A chunk seen on this very tick is never evicted, so the cap cannot take a
 * chunk out from under the current viewport even if the viewport somehow holds
 * more chunks than the cap.
 */
export class ChunkResidency {
  private readonly lastSeenMs = new Map<number, number>();

  constructor(private readonly options: ResidencyOptions) {}

  /** How many chunks are currently believed to be built. */
  get size(): number {
    return this.lastSeenMs.size;
  }

  /** True when this chunk is on the books. */
  has(id: number): boolean {
    return this.lastSeenMs.has(id);
  }

  /** Records that these chunks exist and are on screen right now. */
  keep(ids: Iterable<number>, nowMs: number): void {
    for (const id of ids) this.lastSeenMs.set(id, nowMs);
  }

  /** Drops a chunk from the books, for a rebuild or an explicit destroy. */
  forget(id: number): void {
    this.lastSeenMs.delete(id);
  }

  /** Every chunk on the books, for a wholesale teardown. */
  ids(): number[] {
    return [...this.lastSeenMs.keys()];
  }

  /**
   * The chunks to destroy now, removed from the books as they are returned.
   *
   * Call it on a timer rather than every frame: the work is proportional to
   * the number of built chunks and nothing about the answer is urgent.
   */
  evict(nowMs: number): number[] {
    const doomed: number[] = [];

    for (const [id, seen] of this.lastSeenMs) {
      if (nowMs - seen > this.options.ttlMs) doomed.push(id);
    }
    for (const id of doomed) this.lastSeenMs.delete(id);

    const excess = this.lastSeenMs.size - this.options.maxResident;
    if (excess > 0) {
      const byAge = [...this.lastSeenMs.entries()]
        .filter(([, seen]) => seen !== nowMs)
        .sort((a, b) => a[1] - b[1])
        .slice(0, excess);
      for (const [id] of byAge) {
        this.lastSeenMs.delete(id);
        doomed.push(id);
      }
    }

    return doomed;
  }
}
