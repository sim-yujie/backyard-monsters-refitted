import { Container } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import type { Camera } from "@/game/Camera";
import { BuildPlacement, type DropOutcome } from "./BuildPlacement";
import type * as BuildingArt from "./buildingArt";
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

const yardOf = (buildings: BuildingData[]): Yard =>
  readYard({
    error: 0,
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
): BuildPlacement => {
  const placement = new BuildPlacement({
    type: BLOCK,
    yard,
    camera: { screenToWorld: (point: { x: number; y: number }) => point } as unknown as Camera,
    canvas: new EventTarget() as HTMLCanvasElement,
    layer: new Container(),
    worldToYard: (x, y) => ({ x, y }),
    onDrop,
    onCancel: () => {},
    repeat: true,
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
