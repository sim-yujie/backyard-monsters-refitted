import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { derivedDestroyed } from "../../../game-rules/combat/damagePercent.js";
import { replayAttack } from "../../../game-rules/combat/replay.js";
import { ticks, VICTORY_THRESHOLD } from "../../../game-rules/combat/stats.js";
import type { CombatBuildingDataMap, ResourceAmounts } from "../../../game-rules/combat/types.js";
import { tutorial } from "./tutorial.js";

/**
 * The proof that the guided start's practice camp is always won
 * (`docs/design/tutorial.md` §5.3, issue #227).
 *
 * The player is made to send all 15 level 1 Pokeys in one drop inside the
 * glowing box (§5.2, `web/src/game/attack/plugins/practice.ts`). For every
 * drop point on a 10-unit grid over the box (13 x 13 = 169 points) and seeds
 * 1 to 10, the real engine replays that one fling over the camp as the server
 * fights a Map Room 1 tribe (kind `"tribe"`, `scaledMR1Tribes.ts`), and every
 * run must flatten it.
 *
 * Beyond the win, margins catch a rule change before it bites: every run is
 * at 100% within 90 seconds of the drop (the attack allows 300), and at most
 * 8 of the 15 Pokeys die. Measured when the camp was laid out (Bun, 2026-10-01):
 * 100% by 53 s at worst, 90% by 42.5 s, the tower down by 19.5 s, at most 4
 * Pokeys lost.
 *
 * If this fails after a combat change, retune the camp
 * (`game-data/tribes/v1/tutorial.ts`), not the test.
 */

/** The drop box: centres allowed, yard units (§5.2). Kept equal to the web's `PRACTICE_BOX`. */
const PRACTICE_BOX = { minX: 300, maxX: 420, minY: -60, maxY: 60 } as const;

/** The drop ring of a 15-Pokey bucket: `max(200, bucket / 4) / 2`. */
const DROP_RADIUS = 100;

const STEP = 10;
const SEEDS = 10;

/** Must be won by then (the attack allows 300 s). */
const WIN_WITHIN_SECONDS = 90;
/** Of the 15 flung, at most this many may die. */
const MOST_POKEYS_LOST = 8;

const points = (): { x: number; y: number }[] => {
  const out: { x: number; y: number }[] = [];
  for (let x = PRACTICE_BOX.minX; x <= PRACTICE_BOX.maxX; x += STEP) {
    for (let y = PRACTICE_BOX.minY; y <= PRACTICE_BOX.maxY; y += STEP) out.push({ x, y });
  }
  return out;
};

const resources = tutorial.resources as unknown as Partial<ResourceAmounts>;
const buildingdata = tutorial.buildingdata as unknown as CombatBuildingDataMap;

const fight = (x: number, y: number, seed: number) =>
  replayAttack({
    buildingdata,
    resources,
    kind: "tribe",
    levels: { C1: 1 },
    playerLevel: 1,
    tailTicks: ticks(WIN_WITHIN_SECONDS),
    log: {
      v: 1,
      seed,
      events: [{ kind: "fling", t: 0, x, y, r: DROP_RADIUS, monsters: { C1: 15 } }],
    },
  });

/** The web's copy of the camp, which its drop-box test reads (`web/src/game/attack/practiceBox.test.ts`). */
const WEB_FIXTURE = fileURLToPath(new URL("../../../../../web/test/fixtures/practice-camp.json", import.meta.url));

describe("the practice camp", () => {
  test("the web's copy of it is this template", () => {
    const copy = JSON.parse(readFileSync(WEB_FIXTURE, "utf8"));
    expect(copy.baseid).toBe(tutorial.baseid);
    expect(copy.type).toBe(tutorial.type);
    expect(copy.buildingdata).toEqual(tutorial.buildingdata);
    expect(copy.resources).toEqual(tutorial.resources);
    expect(copy.monsters).toEqual(tutorial.monsters);
  });

  test("is laid out as the design says: one level 1 tower, loot buildings, eight walls, no monsters", () => {
    const types = Object.values(tutorial.buildingdata as Record<string, { t: number }>).map((b) => b.t);
    expect(types.filter((t) => t === 21)).toHaveLength(1);
    expect(types.filter((t) => t === 17)).toHaveLength(8);
    expect(types.filter((t) => ![14, 21, 1, 2, 6, 17].includes(t))).toEqual([]);
    expect(tutorial.monsters).toEqual({});
  });

  test(
    "15 level 1 Pokeys win from every point in the box, every seed, with margin",
    () => {
      const grid = points();
      expect(grid).toHaveLength(169);
      let runs = 0;
      let worstDamage = 100;
      let mostKilled = 0;
      const losses: string[] = [];
      for (const { x, y } of grid) {
        for (let seed = 1; seed <= SEEDS; seed++) {
          const out = fight(x, y, seed);
          runs++;
          worstDamage = Math.min(worstDamage, out.damage);
          mostKilled = Math.max(mostKilled, out.creepsKilled);
          if (out.damage < 100 || out.creepsKilled > MOST_POKEYS_LOST) {
            losses.push(`(${x}, ${y}) seed ${seed}: ${out.damage}% with ${out.creepsKilled} lost`);
          }
          // The win the Map Room 1 save records (`scaledMR1Tribes.ts`, `tribeBattle`).
          if (derivedDestroyed(out.damage, "wild") !== 1 || out.damage < VICTORY_THRESHOLD) {
            losses.push(`(${x}, ${y}) seed ${seed}: not destroyed`);
          }
        }
      }
      expect(losses).toEqual([]);
      expect(runs).toBe(169 * SEEDS);
      expect(worstDamage).toBe(100);
      expect(mostKilled).toBeLessThanOrEqual(MOST_POKEYS_LOST);
    },
    300_000
  );
});
