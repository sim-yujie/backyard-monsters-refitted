import { describe, expect, it } from "vitest";
import { replayAttack } from "./replay.js";
import { COMPATIBLE_RULES_VERSIONS, rulesPlay } from "./rulesCompat.js";
import type { ChampionStance } from "./stance.js";
import type { CombatBuildingDataMap, FlingLog } from "./types.js";

/**
 * Older rules versions these rules still play the same (`rulesCompat.ts`).
 * The digests below were recorded with the v2.0.0-beta.7.7.2 rules
 * (b4f0c156a8d2afee): Fomor attacking in each Mode, with and without habits,
 * called back, and Fomor defending from its cage, each with and without the
 * lesson watching. If a change moves one, b4f0c156a8d2afee no longer plays the
 * same: take it off the list (this test then stops running).
 */

const FOMOR = 3;
const sniper = (id: number, x: number, y: number, l = 1) => ({ id, t: 21, l, X: x, Y: y });
const YARD: CombatBuildingDataMap = {
  "1": { id: 1, t: 14, l: 5, X: 250, Y: 250 },
  "2": sniper(2, 400, 300, 5),
  "3": sniper(3, 300, 400, 5),
  "4": { id: 4, t: 1, l: 5, X: -350, Y: -350, st: 5000 },
  "5": { id: 5, t: 114, l: 1, X: -300, Y: 300 },
};

interface Case {
  readonly champion: { t: number; l: number; s: ChampionStance; hv?: number; h?: Record<string, number> };
  readonly extra?: FlingLog["events"];
  readonly defenders?: { t: number; l: number; hp: number }[];
  /** The digest, and the last checkpoint's, under b4f0c156a8d2afee. */
  readonly digest: string;
  readonly last: { tick: number; digest: string };
}

const CASES: Record<string, Case> = {
  "Fomor, Offensive": {
    champion: { t: FOMOR, l: 3, s: "offensive" },
    digest: "706a698375ed5e35",
    last: { tick: 5600, digest: "e2df133c2f712a2a" },
  },
  "Fomor, Defensive with habits": {
    champion: { t: FOMOR, l: 6, s: "defensive", hv: 1, h: { big: 120, crowd: -80, aerial: 60 } },
    digest: "024286161ed232e0",
    last: { tick: 5600, digest: "3938c5dba493eecd" },
  },
  "Fomor, Hybrid with habits, called back": {
    champion: { t: FOMOR, l: 4, s: "hybrid", hv: 1, h: { big: -60, tower: 40 } },
    extra: [{ kind: "championRetreat", t: 600, c: FOMOR }],
    digest: "20ec997768829c41",
    last: { tick: 6400, digest: "86ebce6fc1104b49" },
  },
  "Fomor defending from its cage": {
    champion: { t: 1, l: 4, s: "hybrid" },
    defenders: [{ t: FOMOR, l: 5, hp: 40000 }],
    digest: "3d4c7e0a84b92a98",
    last: { tick: 5600, digest: "f241510b9061b5b9" },
  },
};

describe("older rules versions that still play the same (patch 7.8)", () => {
  it("plays a stamp listed as compatible, or its own, and no other", () => {
    expect(rulesPlay("abc", "abc")).toBe(true);
    for (const stamp of COMPATIBLE_RULES_VERSIONS) expect(rulesPlay(stamp, "abc")).toBe(true);
    expect(rulesPlay("0123456789abcdef", "abc")).toBe(false);
  });

  describe.runIf(COMPATIBLE_RULES_VERSIONS.includes("b4f0c156a8d2afee"))("b4f0c156a8d2afee (v2.0.0-beta.7.7.2)", () => {
    for (const [name, one] of Object.entries(CASES)) {
      it(`plays ${name} to the digest it had then`, () => {
        for (const learn of [false, true]) {
          const out = replayAttack({
            buildingdata: YARD,
            buildinghealthdata: {},
            resources: { r1: 1_000_000, r2: 0, r3: 0, r4: 0 },
            kind: "main",
            log: {
              v: 1,
              seed: 22001,
              events: [
                { kind: "fling", t: 0, x: 0, y: 0, r: 100, monsters: { C1: 6, C2: 4, C5: 3 }, champion: one.champion },
                { kind: "fling", t: 300, x: -100, y: 50, r: 100, monsters: { C3: 5 } },
                ...(one.extra ?? []),
              ],
            },
            levels: {},
            playerLevel: 30,
            tailTicks: 6000,
            ...(learn ? { learn: true } : {}),
            ...(one.defenders ? { defenderChampions: one.defenders } : {}),
          });
          expect(out.digest).toBe(one.digest);
          expect(out.checkpoints.at(-1)).toEqual(one.last);
        }
      });
    }
  });
});
