// @vitest-environment jsdom
import { compute2DProjection } from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import { Camera } from "@/game/Camera";
import { mapRoomGrid } from "@/game/HexGrid";
import { pickCell } from "./ground";
import { MapInput } from "./MapInput";
import { MR2_TILT_KEY, readMr2Tilt, Tilt, tiltFor, type TiltStrength } from "./tilt";

const W = 1600;
const H = 900;
const STRENGTHS: TiltStrength[] = ["off", "light", "medium", "strong"];
const flat = (): number => 0;

/** The map's camera at a near zoom over a spot in the middle of the world. */
const cameraAt = (zoom: number): Camera => {
  const camera = new Camera({ bounds: mapRoomGrid.worldBounds(WORLD_WIDTH, WORLD_HEIGHT), zoom });
  camera.resize(W, H);
  camera.centreOn(mapRoomGrid.cellToPixel(400, 400));
  return camera;
};

/** Where a cell's middle is drawn on the canvas: world, flat screen, then the tilt. */
const drawnAt = (camera: Camera, tilt: Tilt | null, col: number, row: number) => {
  const onFlat = camera.worldToScreen(mapRoomGrid.cellToPixel(col, row));
  return tilt ? tilt.toScreen(onFlat) : onFlat;
};

/** The cell under a canvas point: undo the tilt, then today's hex rule. */
const cellUnder = (camera: Camera, tilt: Tilt | null, point: { x: number; y: number }) => {
  const world = camera.screenToWorld(tilt ? tilt.toFlat(point) : point);
  return pickCell(world.x, world.y, flat);
};

describe("Tilt maths", () => {
  it("is off unless a strength is named", () => {
    expect(tiltFor("off", W, H)).toBeNull();
    expect(tiltFor("strong", W, H)).toBeInstanceOf(Tilt);
  });

  it.each(["light", "medium", "strong"] as const)("%s: un-tilting a tilted point gives it back", (strength) => {
    const tilt = tiltFor(strength, W, H)!;
    for (const point of [
      { x: 0, y: 0 },
      { x: 800, y: 450 },
      { x: 1600, y: 900 },
      { x: 37, y: 811 },
      { x: 1500, y: 120 },
    ]) {
      const back = tilt.toScreen(tilt.toFlat(point));
      expect(back.x).toBeCloseTo(point.x, 6);
      expect(back.y).toBeCloseTo(point.y, 6);
    }
  });

  it("keeps the middle of the screen where it was", () => {
    const tilt = tiltFor("strong", W, H)!;
    expect(tilt.toScreen({ x: 800, y: 450 })).toEqual({ x: 800, y: 450 });
  });

  it("draws far land smaller, more so the stronger the tilt", () => {
    const ratio = (strength: TiltStrength): number => {
      const tilt = tiltFor(strength, W, H)!;
      return tilt.scaleAt(H) / tilt.scaleAt(0);
    };
    expect(ratio("light")).toBeGreaterThan(1.2);
    expect(ratio("medium")).toBeGreaterThan(ratio("light"));
    expect(ratio("strong")).toBeGreaterThan(ratio("medium"));
    // Strong: a cell at the bottom edge is about twice as wide as one at the top.
    expect(ratio("strong")).toBeCloseTo(1.96, 1);
  });

  it("sees more of the map at the top than the flat screen does", () => {
    const bounds = tiltFor("medium", W, H)!.flatBounds();
    expect(bounds.left).toBeLessThan(0);
    expect(bounds.right).toBeGreaterThan(W);
    expect(bounds.top).toBeLessThan(0);
  });

  it.each(["light", "medium", "strong"] as const)(
    "%s: matches the warp Pixi's PerspectiveMesh draws from the four corners",
    (strength) => {
      const tilt = tiltFor(strength, W, H)!;
      const b = tilt.flatBounds();
      const width = b.right - b.left;
      const height = b.bottom - b.top;
      const at = (x: number, y: number) => tilt.toScreen({ x: b.left + x, y: b.top + y });
      const [p0, p1, p2, p3] = [at(0, 0), at(width, 0), at(width, height), at(0, height)];
      const m = compute2DProjection(
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        0, 0, p0.x, p0.y,
        width, 0, p1.x, p1.y,
        width, height, p2.x, p2.y,
        0, height, p3.x, p3.y,
      );
      for (const [x, y] of [
        [width / 3, height / 5],
        [width / 2, height / 2],
        [width * 0.9, height * 0.7],
      ] as const) {
        const w = m[6]! * x + m[7]! * y + m[8]!;
        const expected = at(x, y);
        expect((m[0]! * x + m[1]! * y + m[2]!) / w).toBeCloseTo(expected.x, 3);
        expect((m[3]! * x + m[4]! * y + m[5]!) / w).toBeCloseTo(expected.y, 3);
      }
    },
  );
});

describe("screen to cell, tilted and flat", () => {
  it.each(STRENGTHS)("%s: every cell on screen is picked where it is drawn", (strength) => {
    for (const zoom of [0.6, 0.3, 1.5]) {
      const camera = cameraAt(zoom);
      const tilt = tiltFor(strength, W, H);
      let checked = 0;
      for (let col = 370; col <= 430; col += 1) {
        for (let row = 370; row <= 430; row += 1) {
          const point = drawnAt(camera, tilt, col, row);
          if (point.x < 0 || point.y < 0 || point.x > W || point.y > H) continue;
          expect(cellUnder(camera, tilt, point)).toEqual({ col, row });
          checked += 1;
        }
      }
      expect(checked).toBeGreaterThan(10);
    }
  });

  it("puts the top of a tilted screen on cells further away than the flat screen does", () => {
    const camera = cameraAt(0.6);
    const flatTop = cellUnder(camera, null, { x: 800, y: 10 });
    const tiltedTop = cellUnder(camera, tiltFor("strong", W, H), { x: 800, y: 10 });
    expect(tiltedTop.row).toBeLessThan(flatTop.row);
  });
});

describe("MapInput with the tilt", () => {
  let input: MapInput | null = null;
  afterEach(() => {
    input?.detach();
    input = null;
    document.body.replaceChildren();
  });

  it.each(STRENGTHS)("%s: hovering a drawn cell reports that cell", (strength) => {
    const camera = cameraAt(0.6);
    const tilt = tiltFor(strength, W, H);
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: W, bottom: H, width: W, height: H, x: 0, y: 0, toJSON: () => ({}) });
    const onHover = vi.fn();
    input = new MapInput({
      camera,
      canvas,
      onHover,
      onSelect: () => {},
      onZoomToCell: () => {},
      onZoomStep: () => {},
      onCancel: () => {},
      screenToFlat: () => (tilt ? (point) => tilt.toFlat(point) : null),
    });
    input.attach();
    for (const [col, row] of [
      [400, 400],
      [395, 392],
      [407, 404],
    ] as const) {
      const at = drawnAt(camera, tilt, col, row);
      canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: at.x, clientY: at.y }));
      expect(onHover).toHaveBeenLastCalledWith({ col, row });
    }
  });
});

describe("the MR2_TILT switch", () => {
  const store = (value: string | null) => ({ getItem: (key: string) => (key === MR2_TILT_KEY ? value : null) });

  it("is off by default", () => {
    expect(readMr2Tilt("", store(null), undefined)).toBe("off");
  });

  it("reads the page address first, then this browser, then the build", () => {
    expect(readMr2Tilt("?mr2tilt=light", store("strong"), "medium")).toBe("light");
    expect(readMr2Tilt("", store("strong"), "medium")).toBe("strong");
    expect(readMr2Tilt("", store(null), "medium")).toBe("medium");
  });

  it("ignores names it does not know", () => {
    expect(readMr2Tilt("?mr2tilt=huge", store("yes"), "1")).toBe("off");
  });
});
