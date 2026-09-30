import { describe, expect, it } from "vitest";
import {
  ballCount,
  DEFAULT_SPOUT,
  flightPose,
  flightEnds,
  flightsEnd,
  flightTotals,
  MAX_FLIGHT_S,
  MIN_FLIGHT_S,
  planFlights,
  SHADOW_START_ALPHA,
  spoutOf,
  type BankSource,
} from "./collectFx";

/**
 * A bank's resource balls (#208), against the numbers in
 * `client/scripts/ResourcePackages.as` and `ResourcePackage.as`.
 */

const hall = { x: 1000, y: 500 };
const snapper = (overrides: Partial<BankSource> = {}): BankSource => ({
  type: 1,
  x: 400,
  y: 300,
  resource: "r1",
  amount: 25_000,
  ...overrides,
});

describe("ballCount", () => {
  it("throws more balls the more is banked, as ResourcePackages.Create did", () => {
    const cases: [number, number][] = [
      [1, 1],
      [100, 1],
      [101, 2],
      [200, 2],
      [201, 3],
      [400, 3],
      [401, 4],
      [1_000, 4],
      [1_001, 5],
      [5_000, 5],
      [5_001, 7],
      [10_000, 7],
      [10_001, 9],
      [20_000, 9],
      [20_001, 12],
      [9_000_000, 12],
    ];
    for (const [amount, count] of cases) expect(ballCount(amount), String(amount)).toBe(count);
  });
});

describe("planFlights", () => {
  it("throws nothing with no Town Hall", () => {
    expect(planFlights([snapper()], null)).toEqual([]);
  });

  it("throws nothing for a harvester that banked nothing", () => {
    expect(planFlights([snapper({ amount: 0 })], hall)).toEqual([]);
  });

  it("flies from the harvester's spout to the Town Hall's, a twelfth of a second apart", () => {
    const flights = planFlights([snapper()], hall, () => 0);
    expect(flights).toHaveLength(12);
    expect(flights.map((flight) => flight.delay)).toEqual(flights.map((_, index) => index / 12));
    for (const flight of flights) {
      expect([flight.fromX, flight.fromY, flight.fromHeight]).toEqual([400 - 23, 300 - 20, 45]);
      expect([flight.toX, flight.toY, flight.toHeight]).toEqual([1000 + 1, 500 - 67, 135]);
    }
  });

  it("takes (distance + 0..50) / 300 seconds, twice Flash's speed, between 0.5 and 1.5", () => {
    const mid = planFlights([snapper({ x: 800, y: 400, amount: 50 })], hall, () => 1)[0]!;
    const distance = Math.hypot(1001 - 777, 433 - 380);
    expect(mid.duration).toBeCloseTo((distance + 50) / 300, 10);

    const near = planFlights([snapper({ x: 1020, y: 450, amount: 50 })], hall, () => 0)[0]!;
    expect(near.duration).toBe(MIN_FLIGHT_S);
    expect(MIN_FLIGHT_S).toBe(0.5);

    const far = planFlights([snapper({ x: -2000, y: 1500, amount: 50 })], hall, () => 1)[0]!;
    expect(far.duration).toBe(MAX_FLIGHT_S);
    expect(MAX_FLIGHT_S).toBe(1.5);
  });

  it("lands the last ball of the biggest bank within 2.5 s, however far the harvester", () => {
    const flights = planFlights([snapper({ x: -3000, y: 2000 })], hall);
    expect(flightsEnd(flights)).toBeLessThanOrEqual(2.5);
  });

  it("splits the amount so the balls add up to it exactly", () => {
    const flights = planFlights(
      [snapper({ amount: 20_005 }), snapper({ type: 4, resource: "r4", amount: 7 })],
      hall,
    );
    expect(flights.filter((flight) => flight.resource === "r1")).toHaveLength(12);
    expect(flightTotals(flights)).toEqual({ r1: 20_005, r4: 7 });
    expect(flights.every((flight) => flight.share > 0)).toBe(true);
  });

  it("uses each harvester's own spout, and a plain one for anything else", () => {
    expect(spoutOf(3)).toEqual({ x: 28, y: -17, height: 50 });
    expect(spoutOf(99)).toBe(DEFAULT_SPOUT);
  });
});

describe("flightPose", () => {
  const flight = planFlights([snapper({ amount: 50 })], hall, () => 0)[0]!;
  const { duration } = flight;

  it("is hidden until its delay is up", () => {
    const late = planFlights([snapper({ amount: 1_000 })], hall, () => 0)[3]!;
    expect(flightPose(late, 0.24).visible).toBe(false);
    expect(flightPose(late, 0.26).visible).toBe(true);
  });

  it("starts at the spout with its shadow on the ground below and to the right", () => {
    const pose = flightPose(flight, 0);
    expect([pose.x, pose.y, pose.lift]).toEqual([377, 280, 0]);
    expect([pose.shadowX, pose.shadowY]).toEqual([22.5, 45]);
    expect(pose.shadowAlpha).toBeCloseTo(SHADOW_START_ALPHA, 10);
    expect(pose.landed).toBe(false);
  });

  it("is highest at half-time, 240 px per second of flight, its shadow slid away and gone", () => {
    const pose = flightPose(flight, duration / 2);
    expect(pose.lift).toBeCloseTo(duration * 240, 6);
    expect(pose.x).toBeCloseTo((377 + 1001) / 2, 6);
    expect(pose.shadowX).toBeCloseTo(22.5 + duration * 200, 6);
    expect(pose.shadowAlpha).toBeCloseTo(0, 10);
  });

  it("lands on the Town Hall's spout, its shadow back under it", () => {
    const pose = flightPose(flight, duration);
    expect(pose.x).toBeCloseTo(1001, 6);
    expect(pose.y).toBeCloseTo(433, 6);
    expect(pose.lift).toBeCloseTo(0, 6);
    expect(pose.shadowX).toBeCloseTo(67.5, 6);
    expect(pose.shadowY).toBeCloseTo(135, 6);
    expect(pose.shadowAlpha).toBeCloseTo(1, 10);
    expect(pose.landed).toBe(true);
  });

  it("eases in and out along the line", () => {
    const early = flightPose(flight, duration * 0.1);
    // Sine.easeInOut covers 2.4% of the way in the first tenth.
    expect((early.x - 377) / (1001 - 377)).toBeCloseTo(0.5 - Math.cos(Math.PI * 0.1) / 2, 6);
  });
});

describe("flightsEnd", () => {
  it("is the last ball's delay plus its flight", () => {
    const flights = planFlights([snapper()], hall, () => 0);
    expect(flightsEnd(flights)).toBeCloseTo(11 / 12 + flights[11]!.duration, 10);
    expect(flightsEnd([])).toBe(0);
  });
});

describe("flightEnds", () => {
  it("is when each resource's last ball lands", () => {
    const flights = planFlights(
      [snapper({ amount: 50 }), snapper({ type: 4, resource: "r4", x: 900, y: 450, amount: 30_000 })],
      hall,
      () => 0,
    );
    const ends = flightEnds(flights);
    expect(ends.r1).toBeCloseTo(flights[0]!.duration, 10);
    expect(ends.r4).toBeCloseTo(11 / 12 + flights[12]!.duration, 10);
    expect(ends.r2).toBeUndefined();
  });
});
