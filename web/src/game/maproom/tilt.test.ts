// @vitest-environment jsdom
import { compute2DProjection } from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ZOOM, MIN_ZOOM, WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import { Camera } from "@/game/Camera";
import { mapRoomGrid } from "@/game/HexGrid";
import { pickCell } from "./ground";
import { MapInput } from "./MapInput";
import {
  decideTilt,
  DEFAULT_TILT,
  MR2_TILT_KEY,
  readTiltOverride,
  Tilt,
  tiltFor,
  tiltMinZoom,
  tiltTextureResolution,
  tiltViewQuad,
  type TiltStrength,
} from "./tilt";

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

describe("the testing override (?mr2tilt=, bymr.mr2Tilt, VITE_MR2_TILT)", () => {
  const store = (value: string | null) => ({ getItem: (key: string) => (key === MR2_TILT_KEY ? value : null) });

  it("is absent by default", () => {
    expect(readTiltOverride("", store(null), undefined)).toBeNull();
  });

  it("reads the page address first, then this browser, then the build", () => {
    expect(readTiltOverride("?mr2tilt=light", store("strong"), "medium")).toBe("light");
    expect(readTiltOverride("", store("strong"), "medium")).toBe("strong");
    expect(readTiltOverride("", store(null), "medium")).toBe("medium");
    expect(readTiltOverride("?mr2tilt=off", store("strong"), "medium")).toBe("off");
  });

  it("ignores names it does not know", () => {
    expect(readTiltOverride("?mr2tilt=huge", store("yes"), "1")).toBeNull();
  });
});

describe("which tilt the map opens at (opt-out, owner 3 Nov 2026)", () => {
  const allowed = { allowed: true, tilted: true };

  it("is the medium tilt when the server allows it and the player has not switched it off", () => {
    expect(DEFAULT_TILT).toBe("medium");
    expect(decideTilt({ classic: false, override: null, choice: allowed })).toBe("medium");
  });

  it("is flat when the player switched the map flat", () => {
    expect(decideTilt({ classic: false, override: null, choice: { allowed: true, tilted: false } })).toBe("off");
  });

  it("is flat while the server's switch is off, whatever the player chose", () => {
    expect(decideTilt({ classic: false, override: null, choice: { allowed: false, tilted: true } })).toBe("off");
  });

  it("is always flat in Classic, even with a testing override", () => {
    expect(decideTilt({ classic: true, override: null, choice: allowed })).toBe("off");
    expect(decideTilt({ classic: true, override: "strong", choice: allowed })).toBe("off");
  });

  it("lets a testing override win over the account in Modern", () => {
    expect(decideTilt({ classic: false, override: "strong", choice: { allowed: false, tilted: false } })).toBe("strong");
    expect(decideTilt({ classic: false, override: "off", choice: allowed })).toBe("off");
  });
});

describe("the tilted camera's edge limits and zoom floor", () => {
  const world = mapRoomGrid.worldBounds(WORLD_WIDTH, WORLD_HEIGHT);
  const tilt = tiltFor("medium", W, H)!;

  /** A camera set up the way the scene sets it for the tilt. */
  const tiltedCamera = (zoom: number): Camera => {
    const camera = new Camera({ bounds: world, zoom });
    camera.resize(W, H);
    camera.setMinZoom(tiltMinZoom(tilt, world, MIN_ZOOM));
    camera.setViewExtent(tilt.flatBounds());
    return camera;
  };

  /** The world point seen at a real screen point. */
  const seenAt = (camera: Camera, x: number, y: number) => camera.screenToWorld(tilt.toFlat({ x, y }));

  const insideWorld = (point: { x: number; y: number }): boolean =>
    point.x >= -0.01 && point.y >= -0.01 && point.x <= world.width + 0.01 && point.y <= world.height + 0.01;

  it("shows no empty space above the world's top edge", () => {
    const camera = tiltedCamera(0.6);
    camera.setPosition(5000, -10_000);
    // Flat, the top of the screen would sit on the world's top edge; tilted
    // it sees further, so the camera stops lower.
    expect(seenAt(camera, W / 2, 0).y).toBeCloseTo(0, 6);
    for (const [x, y] of [[0, 0], [W, 0], [W / 2, 0]] as const) {
      expect(insideWorld(seenAt(camera, x, y))).toBe(true);
    }
  });

  it("keeps all four screen corners on the map at every world edge", () => {
    const camera = tiltedCamera(0.6);
    for (const [px, py] of [[-1e6, -1e6], [1e6, -1e6], [1e6, 1e6], [-1e6, 1e6]] as const) {
      camera.setPosition(px, py);
      for (const [x, y] of [[0, 0], [W, 0], [W, H], [0, H]] as const) {
        expect(insideWorld(seenAt(camera, x, y))).toBe(true);
      }
    }
  });

  it("stops zooming out before the far edge would leave the world (no empty band at the top)", () => {
    const floor = tiltMinZoom(tilt, world, MIN_ZOOM);
    expect(floor).toBeGreaterThan(MIN_ZOOM);
    const camera = tiltedCamera(DEFAULT_ZOOM);
    camera.zoomAt(MIN_ZOOM, { x: W / 2, y: H / 2 });
    expect(camera.zoom).toBeCloseTo(floor, 9);
    for (const [x, y] of [[0, 0], [W, 0], [W, H], [0, H]] as const) {
      expect(insideWorld(seenAt(camera, x, y))).toBe(true);
    }
  });

  it("leaves the flat camera's limits as they were", () => {
    const camera = new Camera({ bounds: world, zoom: 0.6 });
    camera.resize(W, H);
    camera.setPosition(-500, -500);
    expect(camera.position).toEqual({ x: 0, y: 0 });
    camera.setViewExtent({ left: -100, top: -100, right: W, bottom: H });
    expect(camera.position.x).toBeCloseTo(100 / 0.6, 9);
    camera.setViewExtent(null);
    camera.setPosition(-500, -500);
    expect(camera.position).toEqual({ x: 0, y: 0 });
  });
});

describe("the minimap's view box when tilted", () => {
  it("is a trapezoid, wider at the far top than at the near bottom", () => {
    const camera = cameraAt(0.6);
    const tilt = tiltFor("medium", W, H)!;
    const [topLeft, topRight, bottomRight, bottomLeft] = tiltViewQuad(tilt, (flat) => camera.screenToWorld(flat));
    const top = topRight!.x - topLeft!.x;
    const bottom = bottomRight!.x - bottomLeft!.x;
    expect(top).toBeGreaterThan(bottom * 1.3);
    expect(topLeft!.y).toBeCloseTo(topRight!.y, 6);
    expect(bottomLeft!.y).toBeCloseTo(bottomRight!.y, 6);
    // It sees further up than the flat screen's own top.
    expect(topLeft!.y).toBeLessThan(camera.screenToWorld({ x: 0, y: 0 }).y);
  });
});

describe("the tilted picture's resolution", () => {
  it("is halved on Quality Low only", () => {
    expect(tiltTextureResolution(2, "high")).toBe(2);
    expect(tiltTextureResolution(2, "medium")).toBe(2);
    expect(tiltTextureResolution(2, "low")).toBe(1);
  });
});
