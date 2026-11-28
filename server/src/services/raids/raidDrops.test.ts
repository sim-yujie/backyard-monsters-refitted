import { describe, expect, test } from "bun:test";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import type { RaidEvent } from "../../game-rules/combat/types.js";
import {
  bearingGap,
  championRaider,
  dropGroupEvents,
  dropTicks,
  pickSideBearings,
  raidSpawnsUntilOf,
  RAID_CHAMPION_TYPES,
  splitEvenly,
  splitRoster,
  spreadBearings,
  stagedRaidEvents,
} from "./raidDrops.js";

/** Beta 10: armies from several sides in timed groups, and wild champions. */

const total = (events: readonly RaidEvent[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const event of events) {
    for (const [monster, count] of Object.entries(event.monsters)) out[monster] = (out[monster] ?? 0) + count;
  }
  return out;
};

describe("splitting", () => {
  test("splitEvenly gives near-equal whole shares, the larger first", () => {
    expect(splitEvenly(10, 3)).toEqual([4, 3, 3]);
    expect(splitEvenly(2, 4)).toEqual([1, 1, 0, 0]);
    expect(splitEvenly(0, 2)).toEqual([0, 0]);
    expect(splitEvenly(7, 0)).toEqual([7]);
  });

  test("splitRoster spreads every type and loses none", () => {
    const parts = splitRoster({ C2: 7, C10: 2 }, 3);
    expect(parts).toEqual([{ C2: 3, C10: 1 }, { C2: 2, C10: 1 }, { C2: 2 }]);
  });
});

describe("sides", () => {
  test("bearing gaps wrap round", () => {
    expect(bearingGap(10, 350)).toBe(20);
    expect(bearingGap(0, 180)).toBe(180);
  });

  test("spreadBearings goes evenly round from the first", () => {
    expect(spreadBearings(45, 4)).toEqual([45, 135, 225, 315]);
    expect(spreadBearings(300, 3)).toEqual([300, 60, 180]);
  });

  test("pickSideBearings keeps the best first, then the next best 90 degrees clear", () => {
    const ranked = [0, 22.5, 45, 90, 180, 270, 135];
    expect(pickSideBearings(ranked, 1)).toEqual([0]);
    expect(pickSideBearings(ranked, 2)).toEqual([0, 90]);
    expect(pickSideBearings(ranked, 4)).toEqual([0, 90, 180, 270]);
  });

  test("with too few 90-degree ways it settles for 45, then any, never a repeat", () => {
    expect(pickSideBearings([0, 45, 22.5], 3)).toEqual([0, 45, 22.5]);
    expect(pickSideBearings([0], 3)).toEqual([0]);
  });
});

describe("champions", () => {
  test("championRaider draws one of Gorgo, Drull, Fomor and Korath at the asked level", () => {
    const seen = new Set<number>();
    const rng = mulberry32(42);
    for (let draw = 0; draw < 200; draw += 1) {
      const champion = championRaider(rng, 9, 7);
      expect(RAID_CHAMPION_TYPES).toContain(champion.t);
      expect(champion.l).toBe(6);
      expect(champion.pl).toBe(3);
      seen.add(champion.t);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  test("the same stream draws the same champion", () => {
    expect(championRaider(mulberry32(5), 3, 1)).toEqual(championRaider(mulberry32(5), 3, 1));
  });
});

describe("timed groups", () => {
  test("one side, one drop: one disc per type at tick 0, in monster order", () => {
    const events = stagedRaidEvents({
      bearings: [90],
      army: { C10: 4, C2: 3 },
      distances: { C2: 200, C10: 300 },
      drops: 1,
      dropGapTicks: 800,
    });
    expect(events.map((event) => [event.t, Object.keys(event.monsters)[0]])).toEqual([
      [0, "C2"],
      [0, "C10"],
    ]);
    expect(raidSpawnsUntilOf(events)).toBe(0);
  });

  test("several sides and drops: every monster lands once, the sides take turns inside each gap", () => {
    const army = { C2: 20, C7: 9, C16: 3 };
    const events = stagedRaidEvents({
      bearings: [0, 90, 180, 270],
      army,
      drops: 3,
      dropGapTicks: dropTicks(12),
    });
    expect(total(events)).toEqual(army);
    const times = [...new Set(events.map((event) => event.t))];
    // Drop d on side s lands at d x 960 + s x 240.
    expect(times).toEqual([0, 240, 480, 720, 960, 1200, 1440, 1680, 1920, 2160, 2400, 2640]);
    expect(raidSpawnsUntilOf(events)).toBe(2640);
    // In tick order.
    expect(events.map((event) => event.t)).toEqual([...events.map((event) => event.t)].sort((a, b) => a - b));
    // Each side lands on its own bearing.
    const firstOfSide = (t: number) => events.find((event) => event.t === t)!;
    const angle = (event: RaidEvent) => (Math.round((Math.atan2(event.y, event.x) * 180) / Math.PI) + 360) % 360;
    expect([0, 240, 480, 720].map((t) => angle(firstOfSide(t)))).toEqual([0, 90, 180, 270]);
  });

  test("the champion lands alone with the last group on the first side", () => {
    const events = stagedRaidEvents({
      bearings: [45, 225],
      army: { C2: 4 },
      drops: 2,
      dropGapTicks: 800,
      champion: { t: 4, l: 3, pl: 1 },
    });
    const withChampion = events.filter((event) => event.champion);
    expect(withChampion).toHaveLength(1);
    expect(withChampion[0]!.t).toBe(800);
    expect(withChampion[0]!.monsters).toEqual({});
    expect(withChampion[0]!.champion).toEqual({ t: 4, l: 3, pl: 1 });
    expect(Math.round((Math.atan2(withChampion[0]!.y, withChampion[0]!.x) * 180) / Math.PI)).toBe(45);
  });

  test("Kozu's swarm lands in threes 8 degrees apart within each group", () => {
    const events = dropGroupEvents({ bearing: 0, t: 0, monsters: { C1: 7 }, swarm: true });
    expect(events.map((event) => event.monsters.C1)).toEqual([3, 3, 1]);
  });

  test("a group's strength rides on its monsters' discs only", () => {
    const events = dropGroupEvents({ bearing: 0, t: 0, monsters: { C1: 1 }, strength: 0.5, champion: { t: 1, l: 1 } });
    expect(events[0]!.strength).toBe(0.5);
    expect(events[1]!.strength).toBeUndefined();
  });
});
