import { describe, expect, it } from "vitest";
import { replayAttack } from "./replay.js";
import { COMPATIBLE_RULES_VERSIONS, rulesPlay } from "./rulesCompat.js";
import type { ChampionStance } from "./stance.js";
import type { CombatBuildingDataMap, FlingLog } from "./types.js";

/**
 * Older rules versions these rules still play the same (`rulesCompat.ts`).
 * The digests below were recorded with the v2.0.0-beta.7.10/7.11 rules
 * (3cb9cc66416d5eda, run from that commit's rules folder; re-recorded 21 Nov
 * 2026, when 7.7.2's b4f0c156a8d2afee had left the list and these four had
 * stopped running): Fomor attacking in each Mode, with and without habits,
 * called back, and Fomor defending from its cage, each with and without the
 * lesson watching. If a change moves one, 3cb9cc66416d5eda no longer plays the
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
  /** The digest, and the last checkpoint's, under 3cb9cc66416d5eda. */
  readonly digest: string;
  readonly last: { tick: number; digest: string };
}

const CASES: Record<string, Case> = {
  "Fomor, Offensive": {
    champion: { t: FOMOR, l: 3, s: "offensive" },
    digest: "6a5409f05e56d4e2",
    last: { tick: 5600, digest: "2c2f487837a15816" },
  },
  "Fomor, Defensive with habits": {
    champion: { t: FOMOR, l: 6, s: "defensive", hv: 1, h: { big: 120, crowd: -80, aerial: 60 } },
    digest: "50ec37bc061ad0de",
    last: { tick: 5600, digest: "e62ae09b9622c125" },
  },
  "Fomor, Hybrid with habits, called back": {
    champion: { t: FOMOR, l: 4, s: "hybrid", hv: 1, h: { big: -60, tower: 40 } },
    extra: [{ kind: "championRetreat", t: 600, c: FOMOR }],
    digest: "c38a5456c908e80c",
    last: { tick: 6400, digest: "211aa2ce541bc4b4" },
  },
  "Fomor defending from its cage": {
    champion: { t: 1, l: 4, s: "hybrid" },
    defenders: [{ t: FOMOR, l: 5, hp: 40000 }],
    digest: "433b14b59c04e67f",
    last: { tick: 5600, digest: "f0fefdc9abdd0793" },
  },
};

describe("older rules versions that still play the same (patch 7.8)", () => {
  it("plays a stamp listed as compatible, or its own, and no other", () => {
    expect(rulesPlay("abc", "abc")).toBe(true);
    for (const stamp of COMPATIBLE_RULES_VERSIONS) expect(rulesPlay(stamp, "abc")).toBe(true);
    expect(rulesPlay("0123456789abcdef", "abc")).toBe(false);
  });

  describe.runIf(COMPATIBLE_RULES_VERSIONS.includes("3cb9cc66416d5eda"))("3cb9cc66416d5eda (v2.0.0-beta.7.10, 7.11)", () => {
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
