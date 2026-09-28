import { describe, expect, test } from "bun:test";
import type { ChampionData } from "../../schemas/ChampionSchema.js";
import { catchUpChampions } from "./catchUpChampions.js";
import { catchUpYard } from "./catchUp.js";

/**
 * Catch-up step 5: healing and starving in the cage
 * (`champions/ChampionBase.as:1043-1109`, decision D11).
 */

const NOW = 1_800_000_000;
const HOUR = 3_600;

const gorgo = (overrides: Partial<ChampionData> = {}): ChampionData => ({
  t: 1,
  hp: 40_000,
  l: 1,
  ft: NOW + HOUR,
  fd: 0,
  fb: 0,
  pl: 1,
  status: 0,
  ...overrides,
});

describe("catchUpChampions: healing", () => {
  test("heals int(max × 5 / healtime) every 5 seconds, up to full", () => {
    // Level 1 Gorgo: int(40,000 × 5 / 3,600) = 55 per 5 s.
    const save = { champion: [gorgo({ hp: 10_000 })] };
    catchUpChampions(save, NOW - 50, NOW);
    expect((save.champion as ChampionData[])[0]!.hp).toBe(10_000 + 55 * 10);

    const long = { champion: [gorgo({ hp: 10_000 })] };
    catchUpChampions(long, NOW - 10 * HOUR, NOW);
    expect((long.champion as ChampionData[])[0]!.hp).toBe(40_000);
  });

  test("counts whole clock periods, so one-second requests still heal", () => {
    const save = { champion: [gorgo({ hp: 10_000 })] };
    for (let second = NOW - 20; second < NOW; second++) catchUpChampions(save, second, second + 1);
    expect((save.champion as ChampionData[])[0]!.hp).toBe(10_000 + 55 * 4);
  });

  test("a frozen or juiced champion does nothing", () => {
    const frozen = gorgo({ hp: 1, status: 1, ft: HOUR });
    const juiced = gorgo({ t: 2, hp: 1, status: 2, ft: 0 });
    const save = { champion: [frozen, juiced] };
    expect(catchUpChampions(save, NOW - 100 * HOUR, NOW)).toEqual([]);
    expect(save.champion).toEqual([frozen, juiced]);
  });

  test("is idempotent", () => {
    const save = { champion: [gorgo({ hp: 10_000, ft: NOW - 30 * HOUR, fd: 2 })] };
    catchUpChampions(save, NOW - 100, NOW);
    const once = structuredClone(save.champion);
    expect(catchUpChampions(save, NOW, NOW)).toEqual([]);
    expect(save.champion).toEqual(once);
  });
});

describe("catchUpChampions: starving (23 h + 24 h grace)", () => {
  test("hungry but inside the grace: nothing is lost", () => {
    const save = { champion: [gorgo({ ft: NOW - 23 * HOUR, fd: 2 })] };
    expect(catchUpChampions(save, NOW - HOUR, NOW)).toEqual([]);
    expect((save.champion as ChampionData[])[0]).toMatchObject({ fd: 2, ft: NOW - 23 * HOUR });
  });

  test("past the grace below level 6: one feed lost, the feed timer restarts now", () => {
    const save = { champion: [gorgo({ ft: NOW - 25 * HOUR, fd: 2 })] };
    const jobs = catchUpChampions(save, NOW - 2 * HOUR, NOW);
    expect(jobs).toEqual([
      { kind: "starve", id: "G1", t: null, at: NOW, detail: { level: 1, feeds: 1, foodBonus: 0 } },
    ]);
    expect((save.champion as ChampionData[])[0]).toMatchObject({ fd: 1, ft: NOW + 23 * HOUR });
  });

  test("at most one loss per catch-up, however long the player was away", () => {
    const ft = NOW - 30 * 24 * HOUR;
    const save = { champion: [gorgo({ ft, fd: 5, l: 3 })] };
    const jobs = catchUpChampions(save, ft, NOW);
    expect(jobs.map((job) => job.detail.feeds)).toEqual([4]);
    expect((save.champion as ChampionData[])[0]).toMatchObject({ l: 3, fd: 4, ft: NOW + 23 * HOUR });
    // Idempotent: the restarted timer is not starving again at the same moment.
    expect(catchUpChampions(save, NOW, NOW)).toEqual([]);
  });

  test("with no feeds to lose nothing is reported, but the timer still restarts", () => {
    const save = { champion: [gorgo({ ft: NOW - 50 * HOUR, fd: 0 })] };
    expect(catchUpChampions(save, NOW - HOUR, NOW)).toEqual([]);
    expect((save.champion as ChampionData[])[0]).toMatchObject({ fd: 0, ft: NOW + 23 * HOUR });
  });

  test("at level 6 one food-bonus rank is lost and health comes down to the new full", () => {
    const save = { champion: [gorgo({ l: 6, fb: 3, hp: 250_000, ft: NOW - 100 * 24 * HOUR })] };
    const jobs = catchUpChampions(save, NOW - 100 * 24 * HOUR, NOW);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.detail).toEqual({ level: 6, feeds: 0, foodBonus: 2 });
    expect((save.champion as ChampionData[])[0]).toMatchObject({ l: 6, fb: 2, hp: 227_500, ft: NOW + 23 * HOUR });
  });
});

describe("catchUpYard runs step 5", () => {
  test("a starving champion shows in completed", () => {
    const save = {
      savetime: NOW - 2 * HOUR,
      buildingdata: {},
      champion: [gorgo({ ft: NOW - 25 * HOUR, fd: 1 })],
    };
    const completed = catchUpYard(save as Parameters<typeof catchUpYard>[0], NOW);
    expect(completed.map((job) => job.kind)).toContain("starve");
  });
});
