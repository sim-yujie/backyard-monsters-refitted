import { describe, expect, test } from "bun:test";
import { championsAfterDefence } from "./defenderChampion.js";

/** The defender's caged champions after the battle (issues #195, #310). */

const stored = [
  { t: 1, l: 2, hp: 5000, pl: 0, status: 0 },
  { t: 3, l: 4, hp: 900, pl: 1, status: 1 },
];

describe("championsAfterDefence", () => {
  test("lowers the one that fought to the battle's health, and leaves the rest", () => {
    expect(championsAfterDefence(stored, [{ t: 1, hp: 3210.7 }])).toEqual([{ ...stored[0]!, hp: 3210 }, stored[1]!]);
  });

  test("writes 0 for one that died, and never raises one above what it had", () => {
    expect(championsAfterDefence(stored, [{ t: 1, hp: 0 }])?.[0]?.hp).toBe(0);
    expect(championsAfterDefence(stored, [{ t: 1, hp: 9999 }])?.[0]?.hp).toBe(5000);
  });

  test("saves each of a basic champion and a Krallen that both defended (#310)", () => {
    const both = [
      { t: 5, l: 5, hp: 9000, pl: 2, status: 0 },
      { t: 2, l: 3, hp: 700, pl: 0, status: 1 },
      { t: 3, l: 6, hp: 4000, pl: 1, status: 0 },
    ];
    expect(
      championsAfterDefence(both, [
        { t: 5, hp: 0 },
        { t: 3, hp: 1234.5 },
      ])
    ).toEqual([{ ...both[0]!, hp: 0 }, both[1]!, { ...both[2]!, hp: 1234 }]);
  });

  test("changes nothing when none defended, or the type is not held", () => {
    expect(championsAfterDefence(stored, [])).toBe(stored);
    expect(championsAfterDefence(stored, [{ t: 5, hp: 1 }])).toEqual(stored);
    expect(championsAfterDefence(undefined, [{ t: 1, hp: 1 }])).toBeUndefined();
  });
});

/**
 * Follow-up to Reii's report (25 Nov 2026): a caged champion the battle
 * leaves on under 1 health (0.5) is saved as 0, exactly as one that died: it
 * sits out the next defence, then heals back from 0 like any hurt champion.
 * Not stuck; in Flash its health is whole, so 0.5 would have been 1.
 */
describe("a caged champion left on under 1 health", () => {
  test("is saved as 0, sits out the next defence, and heals back from 0", async () => {
    const { cagedChampions } = await import("../../../game-rules/combat/defence.js");
    const { championsHealedTo } = await import("../../yard/catchUpChampions.js");
    const after = championsAfterDefence(stored, [{ t: 1, hp: 0.5 }]);
    expect(after?.[0]?.hp).toBe(0);
    expect(cagedChampions(after)).toEqual([]);
    // An hour of heals later it has health again and defends.
    const healed = championsHealedTo(after, 1_000_000, 1_000_000 + 3600);
    expect(healed[0]?.hp).toBeGreaterThan(0);
    expect(cagedChampions(healed)).toHaveLength(1);
  });
});
