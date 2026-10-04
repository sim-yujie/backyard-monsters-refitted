import { Container } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import type { Camera } from "@/game/Camera";
import { BuildPlacement, type DropOutcome, type SpotCheck } from "./BuildPlacement";
import type * as BuildingArt from "./buildingArt";
import { readYard, type Yard } from "./yardModel";

// No art to fetch: the ghost's picture is not what these are about.
vi.mock("./buildingArt", async (importOriginal) => ({
  ...(await importOriginal<typeof BuildingArt>()),
  resolveArt: () => null,
}));

/**
 * What the building in hand does between the click and the server's answer
 * (#277). It used to be checked against the spot its own drop had just held,
 * so it turned red ("Something is already there.") on the spot it was put on
 * and stayed red until the answer came back.
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
const TOWER = 20;
const HALL: BuildingData = { id: 1, t: 14, X: -65, Y: -65, l: 3 };

const open: BuildPlacement[] = [];
beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  while (open.length > 0) open.pop()?.destroy();
  vi.unstubAllGlobals();
});

/** A drop whose answer the test gives when it likes. */
const later = () => {
  let answer: (outcome: DropOutcome) => void = () => {};
  const onDrop = vi.fn(() => new Promise<DropOutcome>((resolve) => (answer = resolve)));
  return { onDrop, answer: (outcome: DropOutcome) => answer(outcome) };
};

const settle = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

const carry = (
  type: number,
  yard: Yard,
  onDrop: (x: number, y: number) => Promise<DropOutcome>,
  extra: { onDone?: () => void; spots?: (SpotCheck | null)[] } = {},
) => {
  const canvas = new EventTarget() as HTMLCanvasElement;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
  const placement = new BuildPlacement({
    type,
    yard,
    camera: { screenToWorld: (point: { x: number; y: number }) => point } as unknown as Camera,
    canvas,
    layer: new Container(),
    worldToYard: (x, y) => ({ x, y }),
    onDrop,
    onSpot: (check) => extra.spots?.push(check),
    onCancel: () => {},
    ...(extra.onDone ? { onDone: extra.onDone } : {}),
    repeat: type === BLOCK,
  });
  open.push(placement);
  return { placement, canvas };
};

/** A mouse moved to yard point `(x, y)` (the stand-in camera and view map 1:1). */
const hover = (canvas: EventTarget, x: number, y: number) => {
  const event = new Event("pointermove") as PointerEvent;
  Object.assign(event, { pointerType: "mouse", clientX: x, clientY: y });
  canvas.dispatchEvent(event);
};

describe("BuildPlacement drop (#277)", () => {
  it("a one-off building stays green where it was clicked while the server answers", async () => {
    const { onDrop, answer } = later();
    const onDone = vi.fn();
    const spots: (SpotCheck | null)[] = [];
    const { placement } = carry(TOWER, yardOf([HALL]), onDrop, { onDone, spots });
    placement.moveTo(300, 200);
    spots.length = 0;

    placement.dropHere();
    expect(onDrop).toHaveBeenCalledWith(300, 200);
    expect(placement.landing).toBe(true);
    expect(placement.current).toMatchObject({ x: 300, y: 200, problem: null });
    // Nothing told the bar the spot went bad.
    expect(spots.filter((check) => check?.problem)).toEqual([]);

    // The store hands over the yard with the new building before the drop resolves.
    placement.rebase(yardOf([HALL, { id: 9, t: TOWER, X: 300, Y: 200 }]));
    expect(placement.current?.problem).toBeNull();
    expect(spots.filter((check) => check?.problem)).toEqual([]);

    answer("placed");
    await settle();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("does not follow the pointer or take a second click while it lands", async () => {
    const { onDrop, answer } = later();
    const { placement, canvas } = carry(TOWER, yardOf([HALL]), onDrop);
    placement.moveTo(300, 200);
    placement.dropHere();

    hover(canvas, 600, 600);
    placement.moveTo(500, 500);
    placement.dropHere();
    expect(placement.current).toMatchObject({ x: 300, y: 200, problem: null });
    expect(onDrop).toHaveBeenCalledOnce();

    answer("placed");
    await settle();
  });

  it("a refused drop goes back in hand, follows the pointer again and is checked for real", async () => {
    const { onDrop, answer } = later();
    const onDone = vi.fn();
    const { placement, canvas } = carry(TOWER, yardOf([HALL]), onDrop, { onDone });
    placement.moveTo(300, 200);
    placement.dropHere();

    answer("refused");
    await settle();
    expect(onDone).not.toHaveBeenCalled();
    expect(placement.landing).toBe(false);
    expect(placement.current).toMatchObject({ x: 300, y: 200, problem: null });

    hover(canvas, 520, 520);
    expect(placement.current).toMatchObject(placement.grid.spotAt(TOWER, 520, 520));
    // Over the hall: refused, red, as before.
    placement.moveTo(-60, -60);
    expect(placement.current?.problem).toBe("overlap");
  });

  it("a wall stays green on the block just put down until the pointer moves off it", async () => {
    const { onDrop, answer } = later();
    const spots: (SpotCheck | null)[] = [];
    const { placement, canvas } = carry(BLOCK, yardOf([HALL]), onDrop, { spots });
    placement.moveTo(400, 200);
    spots.length = 0;

    placement.dropHere();
    expect(placement.landing).toBe(false);
    expect(placement.current?.problem).toBeNull();

    placement.rebase(yardOf([HALL, { id: 9, t: BLOCK, X: 400, Y: 200 }]));
    answer("placed");
    await settle();
    expect(placement.current?.problem).toBeNull();
    expect(spots.filter((check) => check?.problem)).toEqual([]);

    // The next block follows the pointer at once; back over the last one, it is taken.
    hover(canvas, 430, 210);
    expect(placement.current).toMatchObject({ x: 420, y: 200, problem: null });
    placement.moveTo(400, 200);
    expect(placement.current).toMatchObject({ problem: "overlap", blockedBy: 9 });
  });

  it("a second click on the block just put down is refused here and turns it red", async () => {
    const { onDrop, answer } = later();
    const { placement } = carry(BLOCK, yardOf([HALL]), onDrop);
    placement.moveTo(400, 200);
    placement.dropHere();
    placement.dropHere();
    expect(onDrop).toHaveBeenCalledOnce();
    expect(placement.current?.problem).toBe("overlap");

    answer("placed");
    await settle();
  });
});
