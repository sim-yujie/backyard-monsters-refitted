// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { BOMBS, TICKS_PER_SECOND } from "@/game/combat/rules";
import { Camera } from "@/game/Camera";
import { readYard, type Yard } from "@/game/yard/yardModel";
import { toIso } from "@/game/yard/YardGrid";
import {
  ATTACK_TAP_CLAIMS,
  AttackInput,
  DECOY_CLEARANCE,
  dropZoneOf,
  judgeDrop,
  obstaclesOf,
  overlappingBuildings,
  parseSiegeStock,
  siegeWeapon,
  unusedToolCount,
  type ToolInventory,
} from "./AttackInput";
import { AttackSession } from "./AttackSession";
import type { AttackTarget } from "./attackTarget";
import { Bucket } from "./bucket";

/**
 * The drop rules (§F3, §F4) on a fixture yard: one Cannon Tower at the
 * origin and a Town Hall off to the side, enough to see a centre refused for
 * touching a footprint and accepted on open ground, in the shape the
 * fling-log contract fixes (`docs/design/server-combat.md` §3.10).
 */

/** A Cannon Tower (20) at the origin and a Town Hall (1) at (300, 300). */
const fixtureLoad = (): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "3502",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: {
      "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 1, l: 1, X: 300, Y: 300 },
    },
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 0, r3: 0, r4: 0 },
    attackid: 77,
  }) as unknown as BaseLoadResponse;

const targetOf = (overrides: Partial<AttackTarget> = {}): AttackTarget => ({
  baseid: "3502",
  kind: "wild",
  cell: { col: 241, row: 208 },
  name: "Kozu",
  roster: {
    monsters: { C1: 10 },
    levels: {},
    champions: [],
    flingerLevel: 4,
    catapultLevel: 2,
  },
  ...overrides,
});

interface Rig {
  session: AttackSession;
  bucket: Bucket;
  yard: Yard;
  input: AttackInput;
  canvas: HTMLCanvasElement;
  camera: Camera;
  previews: unknown[];
  refusals: string[];
  toolsUsed: string[];
}

const rig = (overrides: Partial<AttackTarget> = {}): Rig => {
  const load = fixtureLoad();
  const session = new AttackSession({ target: targetOf({ ...overrides, load }), seed: 1 });
  session.start();
  const yard = readYard(load);
  const bucket = new Bucket(session, { storage: null });
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const camera = new Camera({ zoom: 1 });
  camera.resize(800, 600);
  const previews: unknown[] = [];
  const refusals: string[] = [];
  const toolsUsed: string[] = [];
  const input = new AttackInput({
    canvas,
    camera,
    renderer: { worldToYard: (x, y) => ({ x, y }) },
    yard,
    session,
    bucket,
    onPreview: (preview) => previews.push(preview),
    onRefuse: (reason) => refusals.push(reason),
    onToolUsed: (tool) => toolsUsed.push(tool.kind),
  });
  input.attach();
  return { session, bucket, yard, input, canvas, camera, previews, refusals, toolsUsed };
};

/** A spot well away from both buildings. */
const OPEN = { x: -400, y: 200 };

describe("overlap rule", () => {
  it("refuses a fling centre on a footprint and accepts open ground, per DROPZONE.as:64", () => {
    const yard = readYard(fixtureLoad());
    const obstacles = obstaclesOf(yard);
    const zone = dropZoneOf({ kind: "fling" }, 100);
    expect(zone).toEqual({ size: 200, target: "ground" });

    expect(overlappingBuildings({ x: 0, y: 0 }, zone.size, obstacles).map((o) => o.id)).toEqual([1]);
    expect(overlappingBuildings(OPEN, zone.size, obstacles)).toEqual([]);

    expect(judgeDrop(zone, { x: 0, y: 0 }, obstacles, 0).legal).toBe(false);
    expect(judgeDrop(zone, OPEN, obstacles, 0).legal).toBe(true);
  });

  it("tests in isometric pixels with the 0.8 squash, so the edge is where Flash put it", () => {
    // Along the isometric x axis the zone's semi-axis is size/2 and the
    // tower's is size/4 (props size 64): overlap ends at 100 + 16 = 116 px.
    const yard = readYard(fixtureLoad());
    const obstacles = obstaclesOf(yard);
    const towerMiddle = obstacles[0]!.middle;
    const along = (isoX: number): boolean => {
      // A yard point whose isometric projection is (isoX, towerMiddle).
      const x = isoX / 2 + towerMiddle;
      const y = towerMiddle - isoX / 2;
      const iso = toIso(x, y);
      expect(Math.abs(iso.x - isoX)).toBeLessThanOrEqual(1);
      return overlappingBuildings({ x, y }, 200, obstacles).length > 0;
    };
    expect(along(110)).toBe(true);
    expect(along(122)).toBe(false);
  });

  it("stops counting a building once the battle has flattened it, and never counts a trap or decoration", () => {
    const yard = readYard(fixtureLoad());
    expect(overlappingBuildings({ x: 0, y: 0 }, 200, obstaclesOf(yard, [1]))).toEqual([]);
    const withTrap = {
      buildings: [
        ...yard.buildings,
        { ...yard.buildings[0]!, id: 9, type: 24, footprint: [30, 30] as const },
      ],
    };
    expect(
      overlappingBuildings({ x: 0, y: 0 }, 200, obstaclesOf(withTrap, [1])).map((o) => o.id),
    ).toEqual([]);
  });

  it("wants a building under a damage bomb and a tower under Jars, and the Decoy clear within 30", () => {
    const yard = readYard(fixtureLoad());
    const obstacles = obstaclesOf(yard);
    const twig = BOMBS.find((bomb) => bomb.id === "tw0")!;
    const bombZone = dropZoneOf({ kind: "bomb", bomb: twig }, 100);
    expect(bombZone).toEqual({ size: 200, target: "buildings" });
    expect(judgeDrop(bombZone, { x: 0, y: 0 }, obstacles, 0).legal).toBe(true);
    expect(judgeDrop(bombZone, OPEN, obstacles, 0).legal).toBe(false);

    const jars = siegeWeapon("jars")!;
    const jarsZone = dropZoneOf({ kind: "siege", weapon: jars, level: 1 }, 100);
    expect(jarsZone).toEqual({ size: 200, target: "tower" });
    expect(judgeDrop(jarsZone, { x: 0, y: 0 }, obstacles, 0).legal).toBe(true);
    // Over the Town Hall, which is not a tower.
    expect(judgeDrop(jarsZone, { x: 300, y: 300 }, obstacles, 0).legal).toBe(false);

    const decoy = siegeWeapon("decoy")!;
    const decoyZone = dropZoneOf({ kind: "siege", weapon: decoy, level: 1 }, 100);
    expect(decoyZone).toEqual({ size: 250, target: "clear-special" });
    // Clear within 30 px even though the 250 ring would touch the tower.
    const near = { x: 120, y: 120 };
    expect(overlappingBuildings(near, 250, obstacles).length).toBeGreaterThan(0);
    expect(overlappingBuildings(near, DECOY_CLEARANCE, obstacles)).toEqual([]);
    expect(judgeDrop(decoyZone, near, obstacles, 0).legal).toBe(true);
  });

  it("lets a putty bomb go only while something is on the field", () => {
    const putty = BOMBS.find((bomb) => bomb.id === "pu0")!;
    const zone = dropZoneOf({ kind: "bomb", bomb: putty }, 100);
    expect(zone.target).toBe("monsters");
    expect(judgeDrop(zone, OPEN, [], 0).legal).toBe(false);
    expect(judgeDrop(zone, OPEN, [], 3).legal).toBe(true);
  });
});

describe("AttackInput taps", () => {
  it("flings the composition at the tapped yard point, then tells the bucket", () => {
    const { session, bucket, input } = rig();
    bucket.setCount("C1", 4);
    const appendFling = vi.spyOn(session, "appendFling");
    const afterDrop = vi.spyOn(bucket, "afterDrop");

    expect(input.tapAt(OPEN, null)).toBe(true);

    expect(appendFling).toHaveBeenCalledTimes(1);
    expect(appendFling.mock.calls[0]![0]).toEqual({ monsters: { C1: 4 }, x: OPEN.x, y: OPEN.y });
    expect(afterDrop).toHaveBeenCalledTimes(1);
    expect(appendFling.mock.invocationCallOrder[0]!).toBeLessThan(
      afterDrop.mock.invocationCallOrder[0]!,
    );
    const log = session.flingLog();
    expect(log.events).toHaveLength(1);
    expect(log.events[0]).toMatchObject({ kind: "fling", x: OPEN.x, y: OPEN.y, monsters: { C1: 4 } });
    expect(session.state().creepsFlung).toBe(4);
    // The composition is not cleared (§F3).
    expect(bucket.count("C1")).toBe(4);
  });

  it("refuses a centre on a footprint and says why, without spending anything", () => {
    const { session, bucket, input, refusals } = rig();
    bucket.setCount("C1", 4);
    expect(input.tapAt({ x: 0, y: 0 }, null)).toBe(true);
    expect(refusals).toEqual(["Too close to a building. Drop on open ground."]);
    expect(session.state().creepsFlung).toBe(0);
  });

  it("leaves a tap on a building, or with an empty bucket, to the scene", () => {
    const { session, bucket, input, yard } = rig();
    expect(input.tapAt(OPEN, null)).toBe(false);
    bucket.setCount("C1", 4);
    expect(input.tapAt({ x: 300, y: 300 }, yard.buildings[1]!)).toBe(false);
    expect(session.state().creepsFlung).toBe(0);
  });

  it("drops a pending bomb where the tap lands, logs it and clears the tool", () => {
    const { session, bucket, input, toolsUsed: used } = rig();
    bucket.setCount("C1", 4);
    const twig = BOMBS.find((bomb) => bomb.id === "tw0")!;

    input.setTool({ kind: "bomb", bomb: twig });
    expect(input.tapAt({ x: 0, y: 0 }, null)).toBe(true);

    const log = session.flingLog();
    expect(log.events).toHaveLength(1);
    expect(log.events[0]).toEqual({ kind: "bomb", t: 0, x: 0, y: 0, id: "tw0" });
    expect(input.pendingTool()).toBeNull();
    expect(used).toEqual(["bomb"]);
    // The bucket is untouched by a bomb (§F4).
    expect(bucket.count("C1")).toBe(4);
    expect(session.state().creepsFlung).toBe(0);
  });

  it("logs a siege drop with the weapon's id and keeps the roster whole", () => {
    const { session, bucket, input } = rig();
    bucket.setCount("C1", 4);
    input.setTool({ kind: "siege", weapon: siegeWeapon("decoy")!, level: 1 });
    expect(input.tapAt(OPEN, null)).toBe(true);
    expect(session.flingLog().events[0]).toEqual({
      kind: "siege",
      t: 0,
      x: OPEN.x,
      y: OPEN.y,
      weapon: "decoy",
    });
    expect(input.pendingTool()).toBeNull();
    expect(session.remaining()).toEqual({ C1: 10 });
  });

  it("is asked before the scene through ATTACK_TAP_CLAIMS, and steps out on detach", () => {
    const before = ATTACK_TAP_CLAIMS.length;
    const { session, input, bucket, canvas } = rig();
    // Attaching puts this input's claim first in line.
    expect(ATTACK_TAP_CLAIMS).toHaveLength(before + 1);
    const claim = ATTACK_TAP_CLAIMS[0]!;
    bucket.setCount("C1", 2);
    // The last hover is where the scene's tap lands: over the tower it is
    // refused but still claimed, and nothing is sent.
    canvas.dispatchEvent(pointerEvent("pointermove", { clientX: 0, clientY: 0, pointerType: "mouse" }));
    expect(claim(null)).toBe(true);
    expect(session.state().creepsFlung).toBe(0);
    input.detach();
    expect(ATTACK_TAP_CLAIMS).toHaveLength(before);
    expect(ATTACK_TAP_CLAIMS).not.toContain(claim);
  });

  it("does nothing once the attack has ended", () => {
    const { session, bucket, input } = rig();
    bucket.setCount("C1", 4);
    session.retreat();
    expect(input.tapAt(OPEN, null)).toBe(false);
    expect(session.flingLog().events.map((event) => event.kind)).toEqual(["retreat"]);
  });
});

describe("AttackInput preview", () => {
  it("previews on mouse hover, and on touch only between press and release", () => {
    const { input, bucket, canvas, previews } = rig();
    bucket.setCount("C1", 2);
    previews.length = 0;

    canvas.dispatchEvent(pointerEvent("pointermove", { clientX: 10, clientY: 10, pointerType: "mouse" }));
    expect(previews.at(-1)).toMatchObject({ legal: expect.any(Boolean), zone: { target: "ground" } });

    previews.length = 0;
    canvas.dispatchEvent(pointerEvent("pointermove", { clientX: 20, clientY: 20, pointerType: "touch" }));
    expect(previews).toEqual([]);

    canvas.dispatchEvent(pointerEvent("pointerdown", { clientX: 20, clientY: 20, pointerType: "touch" }));
    expect(previews.at(-1)).not.toBeNull();
    canvas.dispatchEvent(pointerEvent("pointermove", { clientX: 30, clientY: 30, pointerType: "touch" }));
    expect(previews.at(-1)).not.toBeNull();
    canvas.dispatchEvent(pointerEvent("pointerup", { clientX: 30, clientY: 30, pointerType: "touch" }));
    expect(previews.at(-1)).toBeNull();
    input.detach();
  });

  it("hides the ring while there is nothing to drop and shows the armed tool's zone", () => {
    const { input, bucket, canvas, previews } = rig();
    canvas.dispatchEvent(pointerEvent("pointermove", { clientX: 10, clientY: 10, pointerType: "mouse" }));
    expect(previews.at(-1)).toBeNull();
    const twig = BOMBS.find((bomb) => bomb.id === "tw1")!;
    input.setTool({ kind: "bomb", bomb: twig });
    expect(previews.at(-1)).toMatchObject({ zone: { size: 200, target: "buildings" } });
    input.cancel();
    expect(previews.at(-1)).toBeNull();
    bucket.setCount("C1", 1);
    expect(previews.at(-1)).toMatchObject({ zone: { target: "ground" } });
    input.detach();
  });

  it("cancels a pending tool on Escape and on right-click", () => {
    const { input, canvas } = rig();
    const twig = BOMBS.find((bomb) => bomb.id === "tw0")!;
    input.setTool({ kind: "bomb", bomb: twig });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(input.pendingTool()).toBeNull();
    input.setTool({ kind: "bomb", bomb: twig });
    const menu = new MouseEvent("contextmenu", { cancelable: true, bubbles: true });
    canvas.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    expect(input.pendingTool()).toBeNull();
    input.detach();
  });
});

describe("tool accounting", () => {
  const base: ToolInventory = {
    catapultLevel: 3,
    pool: { r1: 1_000_000, r2: 1_000_000, r3: 1_000_000 },
    bombsUsed: new Set(),
    creepsAlive: 0,
    siege: [],
    siegeUsed: {},
  };

  it("counts one bomb per resource still fireable, putty only with a field, plus siege left", () => {
    expect(unusedToolCount(base)).toBe(2);
    expect(unusedToolCount({ ...base, creepsAlive: 1 })).toBe(3);
    expect(unusedToolCount({ ...base, bombsUsed: new Set([1]) })).toBe(1);
    expect(unusedToolCount({ ...base, pool: { r1: 5000, r2: 0, r3: 0 } })).toBe(0);
    expect(unusedToolCount({ ...base, pool: null })).toBe(0);
    expect(unusedToolCount({ ...base, catapultLevel: 0 })).toBe(0);
    expect(
      unusedToolCount({
        ...base,
        catapultLevel: 0,
        siege: [
          { id: "decoy", level: 1, quantity: 2 },
          { id: "jars", level: 3, quantity: 1 },
        ],
        siegeUsed: { decoy: 1 },
      }),
    ).toBe(2);
  });

  it("reads the own save's siege blob and shrugs at anything else", () => {
    expect(parseSiegeStock(null)).toEqual([]);
    expect(parseSiegeStock({ decoy: { level: 2, quantity: 3 }, vacuum: { level: 0, quantity: 5 } })).toEqual([
      { id: "decoy", level: 2, quantity: 3 },
    ]);
    expect(parseSiegeStock({ jars: { level: "x" } })).toEqual([]);
  });

  it("keeps the session's exhausted rule honest: tools left, field empty, nothing housed", () => {
    const { session, bucket, input } = rig({
      roster: { monsters: { C1: 1 }, levels: {}, champions: [], flingerLevel: 4, catapultLevel: 1 },
    });
    session.setUnusedTools(1);
    bucket.setCount("C1", 1);
    expect(input.tapAt(OPEN, null)).toBe(true);
    // One Pokey against a Cannon Tower dies well inside a minute.
    for (let frame = 0; frame < 60 * TICKS_PER_SECOND; frame += 1) session.advance(1 / 60);
    expect(session.state().creepsAlive).toBe(0);
    expect(session.state().phase).toBe("running");
    session.setUnusedTools(0);
    expect(session.state().phase).toBe("ended");
    expect(session.state().endReason).toBe("exhausted");
    input.detach();
  });
});

/** A pointer event jsdom can build, with `pointerType` where it lacks PointerEvent. */
const pointerEvent = (
  type: string,
  init: { clientX: number; clientY: number; pointerType: string; button?: number },
): Event => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    clientY: init.clientY,
    button: init.button ?? 0,
  });
  Object.defineProperty(event, "pointerType", { value: init.pointerType });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
};
