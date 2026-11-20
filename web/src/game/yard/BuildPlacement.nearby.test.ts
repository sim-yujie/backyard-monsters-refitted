import { Container, type Graphics } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import type { Camera } from "@/game/Camera";
import { BuildPlacement, type DropOutcome } from "./BuildPlacement";
import { INFERNO_NEARBY_LINE, NEARBY_STROKE } from "./nearbyFootprints";
import type * as BuildingArt from "./buildingArt";
import type { Point } from "./YardGrid";
import { readYard, type Yard } from "./yardModel";

// No art to fetch: the ghost's picture is not what these are about.
vi.mock("./buildingArt", async (importOriginal) => ({
  ...(await importOriginal<typeof BuildingArt>()),
  resolveArt: () => null,
}));

/**
 * The nearby outlines on a Build-menu carry (#231): drawn from the first
 * spot, redrawn only when the spot moves to another grid square or the yard
 * changes, and taking in each wall of a run as it lands.
 */

const yardOf = (buildings: BuildingData[], type?: "inferno"): Yard =>
  readYard({
    error: 0,
    ...(type && { type }),
    currenttime: 1,
    savetime: 1,
    buildingdata: Object.fromEntries(buildings.map((one) => [String(one.id), one])),
    storedata: {},
  } as unknown as BaseLoadResponse);

const BLOCK = 17; // 20 x 20
const HALL: BuildingData = { id: 1, t: 14, X: -65, Y: -65, l: 3 };
const TOWER: BuildingData = { id: 2, t: 20, X: 300, Y: 200 };

const open: BuildPlacement[] = [];
// The placement listens on the canvas and on the window for Escape; neither
// needs more than somewhere to hang a listener here.
beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  while (open.length > 0) open.pop()?.destroy();
  vi.unstubAllGlobals();
});

const carry = (
  yard: Yard,
  onDrop: (x: number, y: number) => Promise<DropOutcome> = async () => "placed",
  onBuild?: (cells: readonly Point[]) => Promise<DropOutcome>,
  layer = new Container(),
  zoom?: number,
): BuildPlacement => {
  const placement = new BuildPlacement({
    type: BLOCK,
    yard,
    camera: { screenToWorld: (point: { x: number; y: number }) => point, zoom } as unknown as Camera,
    canvas: new EventTarget() as HTMLCanvasElement,
    layer,
    worldToYard: (x, y) => ({ x, y }),
    onDrop,
    onCancel: () => {},
    repeat: true,
    ...(onBuild && {
      line: {
        on: true,
        budget: () => ({ afford: 100, room: 100 }),
        unitCost: { r1: 1000, r2: 0, r3: 0, r4: 0 },
        onPlan: () => {},
        onBuild,
      },
    }),
  });
  open.push(placement);
  return placement;
};

describe("BuildPlacement nearby outlines", () => {
  it("outlines what is near from the first spot, and not the far side of the yard", () => {
    const placement = carry(yardOf([HALL, TOWER]));
    placement.moveTo(220, 200);
    expect(placement.nearbyShown).toEqual([{ type: 20, x: 300, y: 200 }]);
  });

  it("redraws only when the spot moves to another square", () => {
    const placement = carry(yardOf([HALL, TOWER]));
    placement.moveTo(220, 200);
    const first = placement.nearbyShown;

    placement.moveTo(220, 200);
    expect(placement.nearbyShown).toBe(first);

    placement.moveTo(225, 200);
    expect(placement.nearbyShown).not.toBe(first);
    expect(placement.nearbyShown).toEqual(first);
  });

  it("takes in the wall just put down, before and after the server answers", async () => {
    let answer: (outcome: DropOutcome) => void = () => {};
    const placement = carry(
      yardOf([HALL]),
      () => new Promise<DropOutcome>((resolve) => (answer = resolve)),
    );
    placement.moveTo(400, 200);
    expect(placement.nearbyShown).toEqual([]);

    placement.dropHere();
    // Held for the drop: the ghost sits on it and it is outlined already.
    expect(placement.nearbyShown).toEqual([{ type: BLOCK, x: 400, y: 200 }]);

    // The store hands over the new yard before the drop resolves.
    placement.rebase(yardOf([HALL, { id: 9, t: BLOCK, X: 400, Y: 200 }]));
    answer("placed");
    await Promise.resolve();
    await Promise.resolve();

    placement.moveTo(420, 200);
    expect(placement.nearbyShown).toEqual([{ type: BLOCK, x: 400, y: 200 }]);
  });

  it("never outlines the building in hand itself", () => {
    // Nothing on the yard near the spot: the ghost alone is not a neighbour.
    const placement = carry(yardOf([HALL]));
    placement.moveTo(400, 200);
    expect(placement.nearbyShown).toEqual([]);
  });
});

/**
 * While a wall line is drawn (owner, 20 Nov 2026): the Block in hand is
 * hidden once the first corner is down, and the neighbours stay outlined
 * round the line's Blocks instead, with the same reach, in both yards.
 */
describe("BuildPlacement nearby outlines along a wall line", () => {
  const FAR_TOWER: BuildingData = { id: 3, t: 20, X: 300, Y: 600 };
  const line = (yard: Yard, onBuild = async (): Promise<DropOutcome> => "placed") =>
    carry(yard, async () => "placed", onBuild);

  for (const kind of [undefined, "inferno"] as const) {
    it(`outlines what is near any Block of the line, after the first corner too (${kind ?? "main"} yard)`, () => {
      const placement = line(yardOf([HALL, TOWER, FAR_TOWER], kind));
      placement.lineTap(600, 200);
      expect(placement.lineNearbyShown).toEqual([]);

      // Back along x towards the tower: the far end comes within reach of it.
      placement.lineTap(240, 200);
      expect(placement.linePlan?.cells.length).toBeGreaterThan(1);
      expect(placement.lineNearbyShown).toEqual([{ type: 20, x: 300, y: 200 }]);
    });
  }

  it("keeps the single Block's reach: a tower just past it stays plain", () => {
    // 140 units round a 20-unit Block at 400: its far edge reaches 560 on x.
    const placement = line(yardOf([HALL, { id: 2, t: 20, X: 600, Y: 200 }]));
    placement.lineTap(400, 200);
    placement.lineTap(400, 260);
    expect(placement.lineNearbyShown).toEqual([]);
  });

  it("never outlines the line's own Blocks while ✓ holds their spots", async () => {
    let answer: (outcome: DropOutcome) => void = () => {};
    const placement = line(
      yardOf([HALL, TOWER]),
      () => new Promise<DropOutcome>((resolve) => (answer = resolve)),
    );
    placement.lineTap(240, 200);
    placement.lineTap(240, 260);
    const confirming = placement.confirmLine();
    expect(placement.lineNearbyShown).toEqual([{ type: 20, x: 300, y: 200 }]);
    answer("placed");
    await confirming;
  });

  it("lets the outlines go with the line", () => {
    const placement = line(yardOf([HALL, TOWER]));
    placement.lineTap(240, 200);
    placement.lineTap(240, 260);
    expect(placement.lineNearbyShown).not.toEqual([]);
    placement.clearLine();
    expect(placement.lineNearbyShown).toEqual([]);
  });
});

/**
 * The outline's look (owner, 20 Nov 2026): the Inferno gets a charcoal
 * keyline under a cool white line so it reads on lava; the main yard keeps
 * its one faint white stroke exactly as it was.
 */
describe("BuildPlacement nearby outline style", () => {
  /** The strokes the single Block's nearby outlines were drawn with. */
  const strokesOf = (layer: Container) => {
    const ghost = layer.children[0] as Container;
    const nearby = ghost.children[0] as Graphics;
    return nearby.context.instructions
      .filter((one) => one.action === "stroke")
      .map((one) => one.data.style as { color: number; alpha: number; width: number; pixelLine: boolean });
  };

  it("keeps the main yard's single faint white line", () => {
    const layer = new Container();
    const placement = carry(yardOf([HALL, TOWER]), undefined, undefined, layer);
    placement.moveTo(220, 200);
    const strokes = strokesOf(layer);
    expect(strokes).toHaveLength(1);
    expect(strokes[0]).toMatchObject({ color: 0xffffff, alpha: NEARBY_STROKE.alpha, pixelLine: true });
  });

  it("draws the Inferno's keyline under its line, 3 screen pixels at the camera's zoom", () => {
    const layer = new Container();
    const placement = carry(yardOf([HALL, TOWER], "inferno"), undefined, undefined, layer, 0.5);
    placement.moveTo(220, 200);
    const [keyline, line] = strokesOf(layer);
    expect(keyline).toMatchObject({ color: 0x171b20, alpha: 0.7, width: 6 });
    expect(line).toMatchObject({ color: INFERNO_NEARBY_LINE.color, alpha: 0.8, pixelLine: true });

    placement.setZoom(2);
    expect(strokesOf(layer)[0]).toMatchObject({ width: 1.5 });
  });
});
