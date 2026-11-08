import { describe, expect, it } from "vitest";
import type { RaidResult } from "@/api/raid";
import { isMolochRaid } from "@/game/inferno/molochRaid";
import { consumeRaidResult, raidSpawnsUntil, setRaidResult, type RaidRun } from "./raidSession";

/** What a raid landed, handed from the raid scene to the yard once. */

const landed = (tribe: string): RaidResult => ({
  id: "r1",
  tribe,
  at: 1,
  defended: false,
  health: 0.5,
  stolen: { r1: 0, r2: 0, r3: 0, r4: 0 },
  shiny: 0,
  damaged: [],
  housedLost: 0,
});

describe("consumeRaidResult", () => {
  it("hands a result over once", () => {
    setRaidResult(landed("legionnaire"));
    expect(consumeRaidResult()?.tribe).toBe("legionnaire");
    expect(consumeRaidResult()).toBeNull();
  });

  it("leaves a result the taker does not want for its own taker", () => {
    setRaidResult(landed("moloch"));
    expect(consumeRaidResult((result) => !isMolochRaid(result))).toBeNull();
    expect(consumeRaidResult(isMolochRaid)?.tribe).toBe("moloch");
    expect(consumeRaidResult()).toBeNull();
  });
});

describe("raidSpawnsUntil", () => {
  const run = (ticks: number[]): RaidRun =>
    ({
      fight: {
        events: ticks.map((t) => ({ kind: "raid", t, x: 0, y: 0, r: 0, monsters: { C1: 1 } })),
      },
    }) as unknown as RaidRun;

  it("is the last wave's tick, as the server held the Trojan Horse's fight open to it", () => {
    expect(raidSpawnsUntil(run([0, 27, 3_666.6, 1_200]))).toBe(3_666);
  });

  it("is 0 for a raid whose waves all land at once", () => {
    expect(raidSpawnsUntil(run([0, 0]))).toBe(0);
    expect(raidSpawnsUntil(run([]))).toBe(0);
  });
});
