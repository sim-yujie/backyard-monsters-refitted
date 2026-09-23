import { describe, expect, it } from "vitest";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import { CHUNK_SIZE, ChunkResidency, chunkCells, chunksForRange } from "./chunks";
import { zoneFor } from "./zones";

describe("chunksForRange", () => {
  it("returns the one chunk a range inside a single zone falls in", () => {
    const chunks = chunksForRange({ minCol: 12, maxCol: 17, minRow: 23, maxRow: 28 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ originX: 10, originY: 20 });
  });

  it("covers every chunk a range straddles", () => {
    const chunks = chunksForRange({ minCol: 8, maxCol: 21, minRow: 5, maxRow: 12 });
    const origins = chunks.map((chunk) => `${chunk.originX},${chunk.originY}`).sort();
    expect(origins).toEqual([
      "0,0",
      "0,10",
      "10,0",
      "10,10",
      "20,0",
      "20,10",
    ]);
  });

  it("gives every cell in the range a chunk that contains it", () => {
    const range = { minCol: 96, maxCol: 133, minRow: 720, maxRow: 748 };
    const ids = new Set(chunksForRange(range).map((chunk) => chunk.id));

    for (let col = range.minCol; col <= range.maxCol; col++) {
      for (let row = range.minRow; row <= range.maxRow; row++) {
        expect(ids.has(zoneFor(col, row).id)).toBe(true);
      }
    }
  });

  it("clamps to the world rather than returning chunks outside it", () => {
    const chunks = chunksForRange({
      minCol: -30,
      maxCol: 5,
      minRow: WORLD_HEIGHT - 4,
      maxRow: WORLD_HEIGHT + 40,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ originX: 0, originY: WORLD_HEIGHT - CHUNK_SIZE });
  });

  it("clamps a range beyond the far edge onto the last chunk, not past it", () => {
    const chunks = chunksForRange({
      minCol: WORLD_WIDTH + 5,
      maxCol: WORLD_WIDTH + 9,
      minRow: 0,
      maxRow: 4,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ originX: WORLD_WIDTH - CHUNK_SIZE, originY: 0 });
  });

  it("reports the cells a chunk owns", () => {
    expect(chunkCells({ id: 0, originX: 40, originY: 90 })).toEqual({
      minCol: 40,
      maxCol: 49,
      minRow: 90,
      maxRow: 99,
    });
  });
});

describe("ChunkResidency", () => {
  const residency = (ttlMs = 1_000, maxResident = 4): ChunkResidency =>
    new ChunkResidency({ ttlMs, maxResident });

  it("keeps a chunk that is still being seen", () => {
    const books = residency();
    books.keep([1], 0);
    books.keep([1], 10_000);
    expect(books.evict(10_000)).toEqual([]);
    expect(books.has(1)).toBe(true);
  });

  it("evicts a chunk once it has been off screen longer than the ttl", () => {
    const books = residency(1_000);
    books.keep([1, 2], 0);
    books.keep([1], 1_500);

    expect(books.evict(1_500)).toEqual([2]);
    expect(books.has(2)).toBe(false);
    expect(books.has(1)).toBe(true);
  });

  it("does not evict on the tick the ttl is reached, only past it", () => {
    const books = residency(1_000);
    books.keep([7], 0);
    expect(books.evict(1_000)).toEqual([]);
    expect(books.evict(1_001)).toEqual([7]);
  });

  it("trims the least recently seen once the cap is exceeded", () => {
    const books = residency(60_000, 3);
    books.keep([1], 100);
    books.keep([2], 200);
    books.keep([3], 300);
    books.keep([4], 400);
    books.keep([5], 500);

    // Nothing has expired; the cap alone takes the two oldest.
    expect(books.evict(600)).toEqual([1, 2]);
    expect(books.size).toBe(3);
    expect(books.ids().sort()).toEqual([3, 4, 5]);
  });

  it("never trims a chunk that was seen on this very tick", () => {
    const books = residency(60_000, 2);
    books.keep([1, 2, 3, 4], 900);

    expect(books.evict(900)).toEqual([]);
    expect(books.size).toBe(4);
  });

  it("reports expired chunks before cap-trimmed ones and forgets both", () => {
    const books = residency(1_000, 2);
    books.keep([1], 0);
    books.keep([2, 3, 4, 5], 2_000);

    expect(books.evict(2_000)).toEqual([1]);
    expect(books.size).toBe(4);
  });

  it("forgets a chunk destroyed for another reason", () => {
    const books = residency();
    books.keep([9], 0);
    books.forget(9);
    expect(books.has(9)).toBe(false);
    expect(books.size).toBe(0);
  });
});
