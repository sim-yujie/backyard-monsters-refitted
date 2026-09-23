import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import {
  busyWorkers,
  SHARPER_TOOLS_MULTIPLIER,
  sharperToolsActive,
  sharperToolsMultiplier,
  WORKER_CAP,
  workerCount,
} from "./workers.js";

/**
 * The same sandbox capture the other Yard Planner service tests read: a 575
 * building save with `BEW.q = 4`, so five workers, and no countdown anywhere
 * (`docs/design/yard-planner-phase1-remainder.md` §4.1).
 */
const FIXTURE = "../../../../web/test/fixtures/baseload-sandbox-yard.json";

const loadFixture = (): { buildingdata: BuildingDataMap; storedata: Record<string, unknown> } =>
  JSON.parse(readFileSync(new URL(FIXTURE, import.meta.url), "utf8"));

/** A yard of one building, so a rule can be read off a single field. */
const oneBuilding = (extra: Record<string, number>): BuildingDataMap => ({
  "1": { x: 0, y: 0, t: 20, id: 1, ...extra },
});

describe("workerCount", () => {
  test("a yard with no store purchases has the one worker it started with", () => {
    expect(workerCount(null)).toBe(1);
    expect(workerCount(undefined)).toBe(1);
    expect(workerCount({})).toBe(1);
    expect(workerCount({ ENL: { q: 6 } })).toBe(1);
  });

  test("each extra worker bought adds one", () => {
    expect(workerCount({ BEW: { q: 1 } })).toBe(2);
    expect(workerCount({ BEW: { q: 2 } })).toBe(3);
    expect(workerCount({ BEW: { q: 4 } })).toBe(WORKER_CAP);
  });

  test("clamps a save that claims more purchases than the store sells", () => {
    expect(workerCount({ BEW: { q: 9 } })).toBe(WORKER_CAP);
    expect(workerCount({ BEW: { q: 1000 } })).toBe(WORKER_CAP);
  });

  test("treats an unreadable or negative quantity as none", () => {
    expect(workerCount({ BEW: {} })).toBe(1);
    expect(workerCount({ BEW: { q: "many" } })).toBe(1);
    expect(workerCount({ BEW: { q: -3 } })).toBe(1);
  });

  test("rounds a fractional quantity down rather than inventing a worker", () => {
    expect(workerCount({ BEW: { q: 2.9 } })).toBe(3);
  });

  test("reads five workers off the sandbox capture", () => {
    expect(workerCount(loadFixture().storedata)).toBe(5);
  });
});

describe("busyWorkers", () => {
  test("an empty or absent yard has nobody working", () => {
    expect(busyWorkers(null)).toBe(0);
    expect(busyWorkers(undefined)).toBe(0);
    expect(busyWorkers({})).toBe(0);
  });

  test("counts a build, an upgrade and a fortify countdown", () => {
    expect(busyWorkers(oneBuilding({ cB: 600 }))).toBe(1);
    expect(busyWorkers(oneBuilding({ cU: 900 }))).toBe(1);
    expect(busyWorkers(oneBuilding({ cF: 120 }))).toBe(1);
  });

  test("counts a building once however many countdowns it carries", () => {
    expect(busyWorkers(oneBuilding({ cB: 10, cU: 20, cF: 30 }))).toBe(1);
  });

  test("ignores a repair flag and a damage reading", () => {
    expect(busyWorkers(oneBuilding({ rE: 1, hp: 100 }))).toBe(0);
    expect(busyWorkers(oneBuilding({ cR: 300 }))).toBe(0);
  });

  test("ignores a countdown that has run out", () => {
    expect(busyWorkers(oneBuilding({ cU: 0 }))).toBe(0);
    expect(busyWorkers(oneBuilding({ cU: -5 }))).toBe(0);
  });

  test("adds up across the yard", () => {
    const yard: BuildingDataMap = {
      "1": { x: 0, y: 0, t: 20, id: 1, cU: 900 },
      "2": { x: 0, y: 0, t: 20, id: 2, cB: 60 },
      "3": { x: 0, y: 0, t: 20, id: 3 },
      "4": { x: 0, y: 0, t: 17, id: 4, cF: 5 },
    };
    expect(busyWorkers(yard)).toBe(3);
  });

  test("the sandbox capture has no job running", () => {
    expect(busyWorkers(loadFixture().buildingdata)).toBe(0);
  });
});

describe("sharper tools", () => {
  const now = 1_000_000;

  test("is active while the expiry is still ahead", () => {
    expect(sharperToolsActive({ BST: { e: now + 1 } }, now)).toBe(true);
    expect(sharperToolsMultiplier({ BST: { e: now + 3600 } }, now)).toBe(SHARPER_TOOLS_MULTIPLIER);
  });

  test("is over at the expiry and after it", () => {
    expect(sharperToolsActive({ BST: { e: now } }, now)).toBe(false);
    expect(sharperToolsMultiplier({ BST: { e: now - 1 } }, now)).toBe(1);
  });

  test("is off for a save that never bought it", () => {
    expect(sharperToolsActive(null, now)).toBe(false);
    expect(sharperToolsActive({}, now)).toBe(false);
    expect(sharperToolsMultiplier({ BST: {} }, now)).toBe(1);
    expect(sharperToolsMultiplier({ BST: { e: "soon" } }, now)).toBe(1);
  });

  test("a 900 second step is written as 720 while the buff runs", () => {
    const seconds = Math.floor(900 * sharperToolsMultiplier({ BST: { e: now + 10 } }, now));
    expect(seconds).toBe(720);
  });
});
