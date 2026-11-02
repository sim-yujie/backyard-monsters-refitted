import { describe, expect, it } from "vitest";
import {
  JUICE_DROP_TICKS,
  JUICE_MIN_FLY_ALTITUDE,
  juiceTrip,
  reconcileWalkers,
  stepWalker,
  walkerGone,
  type TripRoute,
  type Walker,
} from "./yardLifeModel";

const walker = (overrides: Partial<Walker> = {}): Walker => ({
  key: "m:5:C1:0",
  monsterId: "C1",
  sheetLevel: 1,
  champion: false,
  area: { x: 0, y: 0, width: 50, height: 50 },
  x: 10,
  y: 10,
  targetX: 10,
  targetY: 10,
  moving: false,
  heading: 0,
  age: 0,
  speed: 1,
  odds: 200,
  trip: null,
  leaving: false,
  ...overrides,
});

const straight: TripRoute = (from, to) => [from, to];
const noWay: TripRoute = () => null;
const never = () => 0.5;

describe("juiceTrip (CreepBase changeModeJuice)", () => {
  it("walks a monster to the Juicer's door and is gone there", () => {
    const pokey = walker();
    expect(juiceTrip(pokey, 77, { x: 100, y: 10 }, straight, false, 108)).toBe(true);
    expect(pokey.juice?.juicer).toBe(77);
    expect(walkerGone(pokey)).toBe(false);
    let ticks = 0;
    while (!walkerGone(pokey) && ticks < 1000) {
      stepWalker(pokey, never);
      ticks++;
    }
    expect(pokey.x).toBeCloseTo(100);
    // 90 units at its pen speed x3 (juice 1.5 over pen 0.5): 30 ticks.
    expect(ticks).toBe(30);
  });

  it("leaves a monster be with no way there", () => {
    const pokey = walker();
    expect(juiceTrip(pokey, 77, { x: 100, y: 10 }, noWay, false, 108)).toBe(false);
    expect(pokey.juice).toBeUndefined();
    expect(pokey.leaving).toBe(false);
  });

  it("takes a flyer up before it moves, and drops it into the Juicer before it is gone", () => {
    const flyer = walker({ monsterId: "C14" });
    juiceTrip(flyer, 77, { x: 100, y: 10 }, straight, true, 108);
    stepWalker(flyer, never);
    expect(flyer.x).toBe(10);
    while (flyer.juice!.altitude < JUICE_MIN_FLY_ALTITUDE) {
      expect(flyer.x).toBe(10);
      stepWalker(flyer, never);
    }
    while (flyer.trip !== null) stepWalker(flyer, never);
    expect(walkerGone(flyer)).toBe(false);
    const high = flyer.juice!.altitude;
    expect(high).toBeGreaterThan(JUICE_MIN_FLY_ALTITUDE);
    for (let i = 0; i < JUICE_DROP_TICKS - 1; i++) stepWalker(flyer, never);
    expect(walkerGone(flyer)).toBe(false);
    stepWalker(flyer, never);
    expect(flyer.juice!.altitude).toBeCloseTo(0);
    expect(walkerGone(flyer)).toBe(true);
  });

  it("keeps a monster on its way to the Juicer through a redraw that no longer has it", () => {
    const pokey = walker({ key: "j:0:m:5:C1:0" });
    juiceTrip(pokey, 77, { x: 100, y: 10 }, straight, false, 108);
    const next = reconcileWalkers(new Map([[pokey.key, pokey]]), [], never);
    expect(next.get(pokey.key)).toBe(pokey);
  });
});
