import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { clampDropPoint, dropZoneOf, judgeDrop, obstaclesOf } from "@/game/attack/AttackInput";
import { practiceDropFilter } from "@/game/attack/plugins/practice";
import { dropRadius, flingCost } from "@/game/combat/rules";
import { inPracticeBox, PRACTICE_BOX, PRACTICE_CAMP_BASEID } from "@/game/guide/practiceBox";
import { readYard } from "@/game/yard/yardModel";

/**
 * The camp as the server serves it (`server/src/game-data/tribes/v1/tutorial.ts`;
 * the server's `practiceCamp.test.ts` checks this copy equals it). Read as data:
 * importing the server module would pull its database layer into the web's type check.
 */
const tutorial = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../test/fixtures/practice-camp.json"), "utf8"),
) as BaseLoadResponse & { baseid: string };

/**
 * The guided start's drop box is all legal ground (issue #227,
 * `docs/design/tutorial.md` §5.3, proof 2): for every point on the 10-unit
 * grid over the box (169 points), the attack screen's own rule
 * (`judgeDrop`, Flash's `DROPZONE.Drop`) says a 15-Pokey fling may land
 * there, on the camp the server serves. So the box never shows a red ring.
 * Proof 1, that every such drop wins, is the server's `practiceCamp.test.ts`.
 */

const camp = readYard(tutorial);
const obstacles = obstaclesOf(camp);
const radius = dropRadius(flingCost({ monsters: { C1: 15 } }, { C1: 1 }));
const zone = dropZoneOf({ kind: "fling" }, radius);

const grid = (): { x: number; y: number }[] => {
  const points: { x: number; y: number }[] = [];
  for (let x = PRACTICE_BOX.minX; x <= PRACTICE_BOX.maxX; x += 10) {
    for (let y = PRACTICE_BOX.minY; y <= PRACTICE_BOX.maxY; y += 10) points.push({ x, y });
  }
  return points;
};

describe("the practice camp's drop box", () => {
  it("is the camp the server serves, with the ring the server's proof assumes", () => {
    expect(String(tutorial.baseid)).toBe(PRACTICE_CAMP_BASEID);
    expect(camp.buildings.some((building) => building.type === 21)).toBe(true);
    // `max(200, bucket / 4) / 2` for 15 level 1 Pokeys: the `r` practiceCamp.test.ts flings with.
    expect(radius).toBe(100);
  });

  it("every one of its 169 points is a legal 15-Pokey drop", () => {
    const points = grid();
    expect(points).toHaveLength(169);
    const refused = points.filter((point) => {
      // The point the tap lands on is the point judged; the box is well inside the grid.
      const landing = clampDropPoint(point, zone.size / 2);
      expect(landing).toEqual(point);
      return !judgeDrop(zone, landing, obstacles, []).legal;
    });
    expect(refused).toEqual([]);
  });

  it("the practice filter allows the box and refuses outside it", () => {
    for (const point of grid()) expect(practiceDropFilter(point, { kind: "fling" })).toBeNull();
    for (const point of [
      { x: PRACTICE_BOX.minX - 1, y: 0 },
      { x: PRACTICE_BOX.maxX + 1, y: 0 },
      { x: 360, y: PRACTICE_BOX.minY - 1 },
      { x: 360, y: PRACTICE_BOX.maxY + 1 },
      { x: 0, y: 0 },
    ]) {
      expect(inPracticeBox(point)).toBe(false);
      expect(practiceDropFilter(point, { kind: "fling" })).toBe("Inside the glowing box, please!");
    }
  });
});
