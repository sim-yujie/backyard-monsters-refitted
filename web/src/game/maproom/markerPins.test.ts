// @vitest-environment jsdom
import { Container, Sprite } from "pixi.js";
import { afterEach, describe, expect, it } from "vitest";
import { Camera } from "@/game/Camera";
import { mapRoomGrid, setHexShape, type HexShape } from "@/game/HexGrid";
import { pickCell } from "./ground";
import { MarkerPins, markerFit, uprightPlacement, uprightProjector, type Projector } from "./markerPins";
import { Tilt, TILT_PITCH_DEG } from "./tilt";

/**
 * Upright markers on the tilted map (MR2 look plan step 4, second round): each
 * cell's markers are pinned to a foot that goes through the camera and the
 * tilt like the ground, and scaled evenly there, so they stand straight.
 */

const W = 1600;
const H = 900;
const tilt = new Tilt(TILT_PITCH_DEG.medium, W, H);

const cameraAt = (zoom: number, position: { x: number; y: number }) => ({ zoom, position });

afterEach(() => {
  setHexShape("flat");
});

describe("uprightPlacement", () => {
  it("puts the foot where the tilted ground shows it, scaled by the zoom and the local size", () => {
    const camera = cameraAt(0.8, { x: 1000, y: 2000 });
    for (const foot of [
      { x: 1500, y: 2100 },
      { x: 2500, y: 2600 },
      { x: 1200, y: 2900 },
    ]) {
      const at = uprightPlacement(tilt, camera, foot)!;
      const flat = { x: (foot.x - 1000) * 0.8, y: (foot.y - 2000) * 0.8 };
      const expected = tilt.toScreen(flat);
      expect(at.x).toBeCloseTo(expected.x, 6);
      expect(at.y).toBeCloseTo(expected.y, 6);
      expect(at.scale).toBeCloseTo(0.8 * tilt.scaleAt(expected.y), 9);
    }
  });

  it("is smaller at the top of the screen than at the bottom, and the zoom at the middle", () => {
    const camera = cameraAt(1, { x: 0, y: 0 });
    const top = uprightPlacement(tilt, camera, { x: W / 2, y: 0 })!;
    const middle = uprightPlacement(tilt, camera, { x: W / 2, y: H / 2 })!;
    const bottom = uprightPlacement(tilt, camera, { x: W / 2, y: H })!;
    expect(top.scale).toBeLessThan(middle.scale);
    expect(middle.scale).toBeCloseTo(1, 9);
    expect(bottom.scale).toBeGreaterThan(middle.scale);
    // Medium: far cells about two thirds the size of near ones.
    expect(top.scale / bottom.scale).toBeGreaterThan(0.55);
    expect(top.scale / bottom.scale).toBeLessThan(0.8);
  });

  it("shrinks markers on flat-top's short rows so they fit under the cell behind, not on pointy-top", () => {
    setHexShape("flat");
    const flatFit = markerFit(tilt, mapRoomGrid.rowStep);
    expect(flatFit).toBeCloseTo(Math.cos((TILT_PITCH_DEG.medium * Math.PI) / 180), 9);
    setHexShape("pointy");
    expect(markerFit(tilt, mapRoomGrid.rowStep)).toBe(1);

    const camera = cameraAt(1, { x: 0, y: 0 });
    const foot = { x: 300, y: 200 };
    expect(uprightPlacement(tilt, camera, foot, flatFit)!.scale).toBeCloseTo(
      uprightPlacement(tilt, camera, foot)!.scale * flatFit,
      9,
    );
    // On flat-top at the middle of the screen, a fitted marker takes about
    // the same share of the row behind it on screen as on the flat map.
    const row = 75;
    const middle = { x: W / 2, y: H / 2 };
    const near = uprightPlacement(tilt, camera, middle, flatFit)!;
    const rowOnScreen = near.y - tilt.toScreen({ x: middle.x, y: middle.y - row }).y;
    expect((near.scale * row) / rowOnScreen).toBeGreaterThan(0.97);
    expect((near.scale * row) / rowOnScreen).toBeLessThan(1.05);
  });

  it("leaves out feet whose markers would be off the screen, keeping those just past the edge", () => {
    const camera = cameraAt(1, { x: 0, y: 0 });
    expect(uprightPlacement(tilt, camera, { x: -400, y: H / 2 })).toBeNull();
    expect(uprightPlacement(tilt, camera, { x: W + 400, y: H / 2 })).toBeNull();
    expect(uprightPlacement(tilt, camera, { x: W / 2, y: H + 400 })).toBeNull();
    // A tower standing just below the bottom edge still reaches onto the screen.
    expect(uprightPlacement(tilt, camera, { x: W / 2, y: H + 20 })).not.toBeNull();
    expect(uprightPlacement(tilt, camera, { x: -40, y: H / 2 })).not.toBeNull();
  });

  it("refuses a point behind the camera", () => {
    const camera = cameraAt(1, { x: 0, y: 0 });
    expect(uprightPlacement(tilt, camera, { x: W / 2, y: H * 10 })).toBeNull();
  });
});

const sprite = (x: number, y: number, scale = 1): Sprite => {
  const s = new Sprite();
  s.position.set(x, y);
  s.scale.set(scale);
  return s;
};

describe("MarkerPins", () => {
  it("stands markers upright: offsets from the foot keep their shape instead of squashing", () => {
    const pins = new MarkerPins();
    const foot = { x: 1200, y: 2300 };
    // A tower's top (straight above the foot) and a badge to its lower right.
    const top = sprite(1200, 2300 - 60, 0.5);
    const badge = sprite(1218, 2311, 0.25);
    pins.add(foot, top);
    pins.add(foot, badge);

    const camera = cameraAt(0.9, { x: 900, y: 2000 });
    pins.place(uprightProjector(tilt, camera), "a");
    const at = uprightPlacement(tilt, camera, foot)!;

    expect(top.position.x).toBeCloseTo(at.x, 6);
    expect(top.position.y).toBeCloseTo(at.y - 60 * at.scale, 6);
    expect(top.scale.x).toBeCloseTo(0.5 * at.scale, 9);
    expect(top.scale.y).toBeCloseTo(top.scale.x, 9);
    // Same ratio across and down as on the flat map: upright, not squashed.
    expect((badge.position.y - at.y) / (badge.position.x - at.x)).toBeCloseTo(11 / 18, 6);
    expect(badge.scale.x).toBeCloseTo(0.25 * at.scale, 9);

    // The warped texture would have squashed the same height by the tilt's cos(pitch).
    const flatTop = tilt.toScreen({ x: (1200 - 900) * 0.9, y: (2240 - 2000) * 0.9 });
    const squashed = at.y - flatTop.y;
    expect(at.y - top.position.y).toBeGreaterThan(squashed * 1.1);
  });

  it("puts every marker back exactly where the flat map draws it", () => {
    const pins = new MarkerPins();
    const items = [sprite(100, 80, 0.4), sprite(130, 95, 1.2), sprite(90, 60)];
    for (const item of items) pins.add({ x: 100, y: 100 }, item);
    pins.place(uprightProjector(tilt, cameraAt(1.3, { x: 0, y: 0 })), "a");
    expect(pins.tilted).toBe(true);
    pins.place(null, "");
    expect(pins.tilted).toBe(false);
    expect(items.map((s) => [s.position.x, s.position.y, s.scale.x, s.scale.y])).toEqual([
      [100, 80, 0.4, 0.4],
      [130, 95, 1.2, 1.2],
      [90, 60, 1, 1],
    ]);
  });

  it("does nothing on the flat map, and nothing again for the same view", () => {
    const pins = new MarkerPins();
    const item = sprite(10, 20);
    pins.add({ x: 10, y: 30 }, item);
    let calls = 0;
    const project: Projector = () => {
      calls += 1;
      return { x: 500, y: 400, scale: 2 };
    };
    pins.place(null, "");
    expect(item.position.x).toBe(10);
    pins.place(project, "view");
    pins.place(project, "view");
    expect(calls).toBe(1);
    expect(item.position.y).toBe(400 - 10 * 2);
    // A new marker, or a new view, places them again.
    pins.add({ x: 10, y: 30 }, sprite(10, 30), "text");
    pins.place(project, "view");
    expect(calls).toBe(2);
    pins.place(project, "moved");
    expect(calls).toBe(3);
  });

  it("asks once per foot, not once per marker", () => {
    const pins = new MarkerPins();
    for (let i = 0; i < 5; i++) pins.add({ x: 0, y: 0 }, sprite(i, 0));
    for (let i = 0; i < 3; i++) pins.add({ x: 200, y: 0 }, sprite(200 + i, 0));
    let calls = 0;
    pins.place(() => {
      calls += 1;
      return { x: 0, y: 0, scale: 1 };
    }, "k");
    expect(calls).toBe(2);
  });

  it("hides a marker the camera cannot show and gives it back its own visibility", () => {
    const pins = new MarkerPins();
    const shown = sprite(0, 0);
    const hidden = sprite(0, 0);
    hidden.visible = false;
    pins.add({ x: 0, y: 0 }, shown);
    pins.add({ x: 0, y: 0 }, hidden);
    pins.place(() => null, "k");
    expect(shown.visible).toBe(false);
    pins.place(() => ({ x: 0, y: 0, scale: 1 }), "k2");
    expect(shown.visible).toBe(true);
    expect(hidden.visible).toBe(false);
    pins.place(() => null, "k3");
    pins.place(null, "");
    expect(shown.visible).toBe(true);
    expect(hidden.visible).toBe(false);
  });

  it("gives a forgotten marker its own visibility back, so pooled text is not lent out hidden", () => {
    const pins = new MarkerPins();
    const text = sprite(0, 0);
    pins.add({ x: 0, y: 0 }, text, "text");
    pins.place(() => null, "off screen");
    expect(text.visible).toBe(false);
    pins.clear("text");
    expect(text.visible).toBe(true);
  });

  it("forgets text on its own, keeping the sprites", () => {
    const pins = new MarkerPins();
    pins.add({ x: 0, y: 0 }, sprite(0, 0));
    pins.add({ x: 0, y: 0 }, new Container(), "text");
    expect(pins.size).toBe(2);
    pins.clear("text");
    expect(pins.size).toBe(1);
    pins.clear();
    expect(pins.size).toBe(0);
  });
});

describe("hit-testing with the markers on top", () => {
  const camera = new Camera();

  const check = (shape: HexShape): void => {
    setHexShape(shape);
    camera.resize(W, H);
    camera.zoom = 0.7;
    camera.centreOn(mapRoomGrid.cellToPixel(40, 60));
    const flatGround = (): number => 0;
    for (let col = 34; col <= 46; col += 3) {
      for (let row = 54; row <= 66; row += 3) {
        const centre = mapRoomGrid.cellToPixel(col, row);
        // A marker's foot is below the cell's middle (a portrait's 0.24 of a
        // flat-top cell's height), still on the cell.
        const foot = { x: centre.x, y: centre.y + mapRoomGrid.cellHeight * 0.2 };
        const at = uprightPlacement(tilt, camera, foot)!;
        // A press on the screen where the foot stands, un-tilted the way the
        // camera's pointer map does, picks the marker's own cell.
        const world = camera.screenToWorld(tilt.toFlat(at));
        expect(world.x).toBeCloseTo(foot.x, 6);
        expect(world.y).toBeCloseTo(foot.y, 6);
        expect(pickCell(world.x, world.y, flatGround)).toEqual({ col, row });
      }
    }
  };

  it("picks the cell under a marker's foot with flat-top hexes", () => check("flat"));
  it("picks the cell under a marker's foot with pointy-top hexes", () => check("pointy"));
});
