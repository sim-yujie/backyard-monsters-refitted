import { Container } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import type { Camera } from "@/game/Camera";
import { BuildPlacement, type DropOutcome, type LineStage } from "./BuildPlacement";
import type * as BuildingArt from "./buildingArt";
import type { LinePlan } from "./wallLine";
import type { Point } from "./YardGrid";
import { readYard, type Yard } from "./yardModel";

vi.mock("./buildingArt", async (importOriginal) => ({
  ...(await importOriginal<typeof BuildingArt>()),
  resolveArt: () => null,
}));

/**
 * Line mode for wall Blocks (walls Option B, owner 8 Nov 2026): picking the
 * ends with the mouse or by taps, the preview's states, and ✓.
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
const TWIGS = { r1: 1000, r2: 0, r3: 0, r4: 0 };

const open: BuildPlacement[] = [];
beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  while (open.length > 0) open.pop()?.destroy();
  vi.unstubAllGlobals();
});

const settle = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

const draw = (
  options: {
    budget?: { afford: number; room: number };
    onBuild?: (cells: readonly Point[]) => Promise<DropOutcome>;
    onDrop?: (x: number, y: number) => Promise<DropOutcome>;
    on?: boolean;
    yard?: Yard;
  } = {},
) => {
  const canvas = new EventTarget() as HTMLCanvasElement;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
  canvas.setPointerCapture = () => {};
  const plans: { plan: LinePlan | null; stage: LineStage }[] = [];
  const onDrop = vi.fn(options.onDrop ?? (() => Promise.resolve<DropOutcome>("placed")));
  const onBuild = vi.fn(options.onBuild ?? (() => Promise.resolve<DropOutcome>("placed")));
  const placement = new BuildPlacement({
    type: BLOCK,
    yard: options.yard ?? yardOf([HALL]),
    camera: { screenToWorld: (point: { x: number; y: number }) => point } as unknown as Camera,
    canvas,
    layer: new Container(),
    worldToYard: (x, y) => ({ x, y }),
    onDrop,
    onCancel: () => {},
    repeat: true,
    line: {
      on: options.on ?? true,
      budget: () => options.budget ?? { afford: 100, room: 100 },
      unitCost: TWIGS,
      onPlan: (plan, stage) => plans.push({ plan, stage }),
      onBuild,
    },
  });
  open.push(placement);
  return { placement, canvas, plans, onDrop, onBuild, last: () => plans[plans.length - 1]! };
};

/** A pointer event with the fields the placement reads. */
const pointer = (type: string, pointerType: string, x: number, y: number) =>
  Object.assign(new Event(type), { pointerType, clientX: x, clientY: y, button: 0, pointerId: 1 }) as PointerEvent;

/**
 * A mouse press on the canvas. The placement claims it on `window` in the
 * capture phase (before the camera); with no DOM here, the press goes to
 * `window` carrying the canvas as its target, as a real one would.
 */
const press = (canvas: EventTarget, x: number, y: number) => {
  const event = pointer("pointerdown", "mouse", x, y);
  Object.defineProperty(event, "target", { value: canvas });
  window.dispatchEvent(event);
  return event;
};
const move = (canvas: EventTarget, x: number, y: number, pointerType = "mouse") =>
  canvas.dispatchEvent(pointer("pointermove", pointerType, x, y));
const release = (canvas: EventTarget, x: number, y: number, pointerType = "mouse") =>
  canvas.dispatchEvent(pointer("pointerup", pointerType, x, y));
const tap = (canvas: EventTarget, x: number, y: number) => {
  canvas.dispatchEvent(pointer("pointerdown", "touch", x, y));
  canvas.dispatchEvent(pointer("pointerup", "touch", x, y));
};

describe("BuildPlacement line mode", () => {
  it("starts on when asked, with no line yet", () => {
    const { placement, last } = draw();
    expect(placement.lineMode).toBe(true);
    expect(placement.linePlan).toBeNull();
    expect(last().stage).toEqual({ empty: true, fixed: false, busy: false });
  });

  it("mouse: press, drag and release draw a straight line and wait for ✓ (no build on release)", () => {
    const { canvas, placement, onBuild, onDrop, last } = draw();
    const down = press(canvas, 210, 110); // spot centred on the pointer: (200, 100)
    move(canvas, 270, 110);
    expect(last().stage).toMatchObject({ empty: false, fixed: false });
    release(canvas, 290, 110);

    expect(last().stage).toMatchObject({ fixed: true, busy: false });
    expect(placement.linePlan?.build).toEqual([
      { x: 200, y: 100 },
      { x: 220, y: 100 },
      { x: 240, y: 100 },
      { x: 260, y: 100 },
      { x: 280, y: 100 },
    ]);
    expect(onBuild).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    // The camera never saw the press, so it did not pan.
    expect((down as unknown as { cancelBubble: boolean }).cancelBubble).toBe(true);
  });

  it("mouse: a diagonal drag draws an L, the longer leg first", () => {
    const { canvas, placement } = draw();
    press(canvas, 210, 110);
    release(canvas, 270, 150);
    expect(placement.linePlan?.build).toEqual([
      { x: 200, y: 100 },
      { x: 220, y: 100 },
      { x: 240, y: 100 },
      { x: 260, y: 100 },
      { x: 260, y: 120 },
      { x: 260, y: 140 },
    ]);
  });

  it("mouse: a click picks the start, the end follows the pointer, the second click fixes it", () => {
    const { canvas, placement, last } = draw();
    press(canvas, 210, 110);
    release(canvas, 211, 110);
    expect(last().stage).toMatchObject({ empty: false, fixed: false });
    move(canvas, 250, 110);
    expect(placement.linePlan?.build).toHaveLength(3);
    press(canvas, 270, 110);
    release(canvas, 270, 110);
    expect(last().stage).toMatchObject({ fixed: true });
    expect(placement.linePlan?.build).toHaveLength(4);
    // Moving after it is fixed changes nothing.
    move(canvas, 500, 110);
    expect(placement.linePlan?.build).toHaveLength(4);
  });

  it("touch: tap the start, tap the end; a finger drag pans and picks nothing", () => {
    const { canvas, placement, last } = draw();
    tap(canvas, 210, 110);
    expect(placement.linePlan?.build).toEqual([{ x: 200, y: 100 }]);
    expect(last().stage).toMatchObject({ fixed: false });

    canvas.dispatchEvent(pointer("pointerdown", "touch", 300, 300));
    move(canvas, 100, 100, "touch");
    release(canvas, 100, 100, "touch");
    expect(placement.linePlan?.build).toEqual([{ x: 200, y: 100 }]);

    tap(canvas, 210, 170);
    expect(last().stage).toMatchObject({ fixed: true });
    expect(placement.linePlan?.build.map((cell) => cell.y)).toEqual([100, 120, 140, 160]);
    // A third tap starts a new line.
    tap(canvas, 110, 210);
    expect(placement.linePlan?.build).toEqual([{ x: 100, y: 200 }]);
  });

  it("the preview: red on a building (skipped), grey past the budget", () => {
    const wall: BuildingData = { id: 5, t: BLOCK, X: 240, Y: 100 };
    const { placement, last } = draw({ yard: yardOf([HALL, wall]), budget: { afford: 3, room: 100 } });
    placement.lineTap(200, 100);
    placement.lineTap(340, 100);
    const plan = last().plan!;
    expect(plan.cells.map((cell) => cell.state)).toEqual([
      "build", "build", "blocked", "build", "short", "short", "short", "short",
    ]);
    expect(plan.cells[2]).toMatchObject({ problem: "overlap", blockedBy: 5 });
    expect(plan.shortReason).toBe("resources");
    expect(plan.cost.r1).toBe(3000);
  });

  it("a line off the plot is red where it leaves", () => {
    const { placement } = draw();
    placement.lineTap(1500, 0);
    placement.lineTap(3000, 0);
    expect(placement.linePlan?.cells.some((cell) => cell.problem === "outOfBounds")).toBe(true);
  });

  it("✓ sends the green Blocks once, holds them while it waits, then clears the line", async () => {
    let answer: (outcome: DropOutcome) => void = () => {};
    const onBuild = vi.fn(() => new Promise<DropOutcome>((resolve) => (answer = resolve)));
    const { placement, last } = draw({ onBuild, budget: { afford: 2, room: 100 } });
    placement.lineTap(200, 100);
    placement.lineTap(260, 100);

    void placement.confirmLine();
    void placement.confirmLine(); // a second ✓ while waiting does nothing
    expect(onBuild).toHaveBeenCalledOnce();
    expect(onBuild).toHaveBeenCalledWith([
      { x: 200, y: 100 },
      { x: 220, y: 100 },
    ]);
    expect(last().stage).toMatchObject({ busy: true });
    // Held: the spots read as taken until the answer.
    expect(placement.grid.check(BLOCK, 200, 100).problem).toBe("overlap");
    placement.lineTap(500, 500); // no new line while waiting
    expect(placement.linePlan?.build[0]).toEqual({ x: 200, y: 100 });

    answer("placed");
    await settle();
    expect(placement.linePlan).toBeNull();
    expect(last().stage).toEqual({ empty: true, fixed: false, busy: false });
    expect(placement.grid.check(BLOCK, 200, 100).problem).toBeNull();
  });

  it("a refused ✓ keeps the line to try again", async () => {
    const { placement } = draw({ onBuild: () => Promise.resolve("refused") });
    placement.lineTap(200, 100);
    placement.lineTap(240, 100);
    await placement.confirmLine();
    expect(placement.linePlan?.build).toHaveLength(3);
  });

  it("✓ with nothing green sends nothing", async () => {
    const { placement, onBuild } = draw({ budget: { afford: 0, room: 100 } });
    placement.lineTap(200, 100);
    await placement.confirmLine();
    expect(onBuild).not.toHaveBeenCalled();
  });

  it("Escape lets the line go first, then cancels", () => {
    const onCancel = vi.fn();
    const { placement } = draw();
    // Swap in a cancel spy through a fresh placement sharing the shape.
    placement.destroy();
    open.pop();
    const canvas = new EventTarget() as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
    const withCancel = new BuildPlacement({
      type: BLOCK,
      yard: yardOf([HALL]),
      camera: { screenToWorld: (point: { x: number; y: number }) => point } as unknown as Camera,
      canvas,
      layer: new Container(),
      worldToYard: (x, y) => ({ x, y }),
      onDrop: () => Promise.resolve("placed"),
      onCancel,
      repeat: true,
      line: {
        on: true,
        budget: () => ({ afford: 10, room: 10 }),
        unitCost: TWIGS,
        onPlan: () => {},
        onBuild: () => Promise.resolve("placed"),
      },
    });
    open.push(withCancel);
    vi.stubGlobal("HTMLInputElement", class {});
    vi.stubGlobal("HTMLTextAreaElement", class {});
    withCancel.lineTap(200, 100);
    window.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
    expect(withCancel.linePlan).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    window.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("off: a click builds one Block as before, and the mouse press is left to the camera", () => {
    const { canvas, placement, onDrop, onBuild } = draw({ on: false });
    expect(placement.lineMode).toBe(false);
    const down = press(canvas, 210, 110);
    expect((down as unknown as { cancelBubble: boolean }).cancelBubble).toBe(false);
    canvas.dispatchEvent(pointer("pointerdown", "mouse", 210, 110));
    release(canvas, 210, 110);
    expect(onDrop).toHaveBeenCalledWith(200, 100);
    expect(onBuild).not.toHaveBeenCalled();
  });

  it("toggling clears any line; in line mode a release never drops one Block", () => {
    const { canvas, placement, onDrop } = draw();
    placement.lineTap(200, 100);
    placement.setLineMode(false);
    expect(placement.linePlan).toBeNull();
    placement.setLineMode(true);
    press(canvas, 210, 110);
    release(canvas, 210, 110);
    placement.dropHere();
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("a new yard (resources changed) guesses the greens again", () => {
    let afford = 1;
    const canvas = new EventTarget() as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
    const placement = new BuildPlacement({
      type: BLOCK,
      yard: yardOf([HALL]),
      camera: { screenToWorld: (point: { x: number; y: number }) => point } as unknown as Camera,
      canvas,
      layer: new Container(),
      worldToYard: (x, y) => ({ x, y }),
      onDrop: () => Promise.resolve("placed"),
      onCancel: () => {},
      repeat: true,
      line: {
        on: true,
        budget: () => ({ afford, room: 10 }),
        unitCost: TWIGS,
        onPlan: () => {},
        onBuild: () => Promise.resolve("placed"),
      },
    });
    open.push(placement);
    placement.lineTap(200, 100);
    placement.lineTap(240, 100);
    expect(placement.linePlan?.build).toHaveLength(1);
    afford = 5;
    placement.rebase(yardOf([HALL]));
    expect(placement.linePlan?.build).toHaveLength(3);
  });
});
