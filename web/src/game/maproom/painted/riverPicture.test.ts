import { afterAll, describe, expect, it } from "vitest";
import { HexGrid, mapRoomGrid, setHexShape, type HexShape } from "@/game/HexGrid";
import type { CellRange } from "../zones";
import { RiverBuilder, type RiverWorkerLike } from "./riverBuilder";
import { buildRiverMask } from "./riverMask";
import { riverPaths, type RiverCells } from "./riverPaths";
import { buildRiverPicture, snapshotRiverCells, type RiverAnswer, type RiverRequest } from "./riverPicture";
import { RiverLayer, worldRectOf } from "./RiverLayer";

/**
 * The river picture built from a snapshot of the cells (in the worker, `riverWorker.ts`, or on the
 * main thread as its fallback) is byte for byte the one built from the live cells, and the layer
 * shows it the same way whichever thread built it.
 */

afterAll(() => {
  setHexShape("flat");
});

/** A small seeded random source, so a failure can be replayed. */
const random = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
};

/** A busy world: rivers of every width on many cells (also far past any range), water, fog, lifts. */
const busyWorld = (seed: number): RiverCells => {
  const next = random(seed);
  const cells = new Map<string, { rv: number; water: boolean; known: boolean; lift: number }>();
  for (let col = -5; col < 70; col++) {
    for (let row = -5; row < 70; row++) {
      const water = next() < 0.15;
      const rv = !water && next() < 0.35 ? Math.floor(next() * 64) : 0;
      cells.set(`${col},${row}`, { rv, water, known: next() > 0.1, lift: next() < 0.2 ? Math.round(next() * 12) : 0 });
    }
  }
  const at = (col: number, row: number) => cells.get(`${col},${row}`);
  return {
    rvAt: (col, row) => at(col, row)?.rv ?? 0,
    isWater: (col, row) => at(col, row)?.water ?? false,
    isKnown: (col, row) => at(col, row)?.known ?? false,
    liftOf: (col, row) => at(col, row)?.lift ?? 0,
  };
};

const ranges: CellRange[] = [
  { minCol: 10, maxCol: 30, minRow: 12, maxRow: 28 },
  { minCol: 0, maxCol: 9, minRow: 40, maxRow: 47 },
  { minCol: 33, maxCol: 60, minRow: 3, maxRow: 22 },
];

describe.each<HexShape>(["pointy", "flat"])("the river picture from a snapshot, %s-top", (shape) => {
  it.each([1, 2, 3])("matches the live cells' picture byte for byte (world %i)", (seed) => {
    setHexShape(shape);
    const cells = busyWorld(seed);
    for (const range of ranges) {
      const rect = worldRectOf(range);
      const direct = buildRiverMask(riverPaths(range, cells, mapRoomGrid), rect, mapRoomGrid.cellWidth, 32);
      const request = snapshotRiverCells(7, range, cells, mapRoomGrid, rect, 32);
      // As the worker gets it: a structured copy.
      const answer = buildRiverPicture(structuredClone(request));
      expect(answer.id).toBe(7);
      expect(direct.any).toBe(true);
      expect(answer.mask.width).toBe(direct.width);
      expect(answer.mask.height).toBe(direct.height);
      expect(answer.mask.any).toBe(direct.any);
      expect(Buffer.from(answer.mask.bytes).equals(Buffer.from(direct.bytes))).toBe(true);
    }
  });

  it("uses the grid it was given, not the worker's default one", () => {
    setHexShape(shape);
    const cells = busyWorld(4);
    const range = ranges[0]!;
    const request = snapshotRiverCells(1, range, cells, mapRoomGrid, worldRectOf(range), 22);
    expect(request.grid).toEqual({ shape, cellWidth: mapRoomGrid.cellWidth, cellHeight: mapRoomGrid.cellHeight });
    const other = new HexGrid(mapRoomGrid.cellWidth, mapRoomGrid.cellHeight, shape === "flat" ? "pointy" : "flat");
    const wrong = buildRiverMask(riverPaths(range, cells, other), request.rect, other.cellWidth, 22);
    expect(Buffer.from(buildRiverPicture(request).mask.bytes).equals(Buffer.from(wrong.bytes))).toBe(false);
  });
});

/** A worker that answers only when the test says so. */
class FakeWorker implements RiverWorkerLike {
  onmessage: ((event: MessageEvent<RiverAnswer>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  sent: RiverRequest[] = [];
  terminated = false;
  postMessage(message: RiverRequest): void {
    this.sent.push(structuredClone(message));
  }
  terminate(): void {
    this.terminated = true;
  }
  /** Answers the oldest request not answered yet. */
  answer(): void {
    const request = this.sent.shift()!;
    this.onmessage?.({ data: buildRiverPicture(request) } as MessageEvent<RiverAnswer>);
  }
  fail(): void {
    this.onerror?.(new Event("error"));
  }
}

describe("the river builder", () => {
  const request = (id: number): RiverRequest => {
    setHexShape("flat");
    const range = ranges[0]!;
    return snapshotRiverCells(id, range, busyWorld(5), mapRoomGrid, worldRectOf(range), 22);
  };

  it("builds at once on the main thread where there is no worker", () => {
    const builder = new RiverBuilder(() => null);
    expect(builder.usesWorker).toBe(false);
    expect(builder.request(request(1))).toBe(true);
    const built = builder.take();
    expect(built?.servedBy).toBe("main");
    expect(built?.id).toBe(1);
    expect(builder.take()).toBeNull();
  });

  it("has one request out at a time and hands the worker's answer over once", () => {
    const worker = new FakeWorker();
    const builder = new RiverBuilder(() => worker);
    expect(builder.request(request(1))).toBe(true);
    expect(builder.busy).toBe(true);
    expect(builder.request(request(2))).toBe(false);
    expect(builder.take()).toBeNull();
    worker.answer();
    expect(builder.busy).toBe(false);
    const built = builder.take();
    expect(built?.servedBy).toBe("worker");
    expect(built?.id).toBe(1);
    expect(builder.take()).toBeNull();
  });

  it("builds the held request itself when the worker fails, and on its own from then on", () => {
    const worker = new FakeWorker();
    const builder = new RiverBuilder(() => worker);
    builder.request(request(1));
    worker.fail();
    expect(worker.terminated).toBe(true);
    expect(builder.usesWorker).toBe(false);
    expect(builder.take()).toMatchObject({ id: 1, servedBy: "main" });
    builder.request(request(2));
    expect(builder.take()).toMatchObject({ id: 2, servedBy: "main" });
  });
});

describe("the river layer with a worker", () => {
  const view: CellRange = { minCol: 20, maxCol: 34, minRow: 20, maxRow: 30 };
  const shifted = (range: CellRange, by: number): CellRange => ({
    ...range,
    minCol: range.minCol + by,
    maxCol: range.maxCol + by,
  });

  const setup = () => {
    setHexShape("flat");
    const worker = new FakeWorker();
    const layer = new RiverLayer(() => new RiverBuilder(() => worker));
    return { worker, layer, cells: busyWorld(6) };
  };

  it("keeps the old picture until the new one lands, then shows it", () => {
    const { worker, layer, cells } = setup();
    expect(layer.update(view, true, cells, "low")).toBe(false);
    expect(layer.showing).toBe(false);
    expect(worker.sent).toHaveLength(1);
    worker.answer();
    expect(layer.update(view, true, cells, "low")).toBe(true);
    expect(layer.showing).toBe(true);
    expect(layer.stats.worker).toBe(1);
    const first = layer.uniforms.rect.slice();
    // Far away: the old picture stays up while the new one is built.
    expect(layer.update(shifted(view, 30), true, cells, "low")).toBe(false);
    expect(layer.uniforms.rect).toEqual(first);
    expect(layer.showing).toBe(true);
    worker.answer();
    expect(layer.update(shifted(view, 30), true, cells, "low")).toBe(true);
    expect(layer.uniforms.rect).not.toEqual(first);
  });

  it("asks ahead when the view nears the edge, and only one at a time", () => {
    const { worker, layer, cells } = setup();
    layer.update(view, true, cells, "low");
    worker.answer();
    layer.update(view, true, cells, "low");
    expect(worker.sent).toHaveLength(0);
    // Two cells on of the six built past the view: not yet.
    layer.update(shifted(view, 2), true, cells, "low");
    expect(worker.sent).toHaveLength(0);
    // Four on: the next picture is asked for, still inside the built one.
    layer.update(shifted(view, 4), true, cells, "low");
    expect(worker.sent).toHaveLength(1);
    layer.update(shifted(view, 9), true, cells, "low");
    expect(worker.sent).toHaveLength(1);
  });

  it("builds again when a zone arrived while a picture was being built", () => {
    const { worker, layer, cells } = setup();
    layer.update(view, true, cells, "low");
    layer.invalidate({ minCol: 25, maxCol: 26, minRow: 25, maxRow: 26 });
    worker.answer();
    expect(layer.update(view, true, cells, "low")).toBe(true);
    // Landed, but stale: asked again at once.
    expect(worker.sent).toHaveLength(1);
    worker.answer();
    layer.update(view, true, cells, "low");
    expect(worker.sent).toHaveLength(0);
  });

  it("ignores a zone that reaches neither the built picture nor the one asked for", () => {
    const { worker, layer, cells } = setup();
    layer.update(view, true, cells, "low");
    worker.answer();
    layer.update(view, true, cells, "low");
    layer.invalidate({ minCol: 60, maxCol: 61, minRow: 60, maxRow: 61 });
    layer.update(view, true, cells, "low");
    expect(worker.sent).toHaveLength(0);
  });

  it("shows the same picture as the main-thread build", () => {
    const { worker, layer, cells } = setup();
    layer.update(view, true, cells, "low");
    worker.answer();
    layer.update(view, true, cells, "low");
    const here = new RiverLayer(() => new RiverBuilder(() => null));
    expect(here.update(view, true, cells, "low")).toBe(true);
    expect(here.stats.main).toBe(1);
    const a = layer.uniforms.source;
    const b = here.uniforms.source;
    expect([a.width, a.height]).toEqual([b.width, b.height]);
    expect(Buffer.from(a.resource as Uint8Array).equals(Buffer.from(b.resource as Uint8Array))).toBe(true);
    expect(layer.uniforms.rect).toEqual(here.uniforms.rect);
  });
});
