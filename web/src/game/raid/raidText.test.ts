import { describe, expect, it } from "vitest";
import {
  alertMonsters,
  anyStolen,
  frequencyTitle,
  healthText,
  raidTribe,
  raiderCount,
  tribeTitle,
} from "./raidText";

/** The raid's words and pictures (issue #226 WP4). */

describe("raid text", () => {
  it("names the tribe, with Flash's splash art", () => {
    expect(tribeTitle("Kozu")).toBe("Kozu Tribe");
    expect(raidTribe("Kozu").splash).toMatch(/^\/assets\/popups\/tribe_.+\.png$/);
  });

  it("shows the three most numerous monster types, ties in id order", () => {
    const shown = alertMonsters({ C4: 5, C2: 10, C3: 5, C1: 1, C9: 0 });
    expect(shown.map((one) => [one.id, one.count])).toEqual([
      ["C2", 10],
      ["C3", 5],
      ["C4", 5],
    ]);
    expect(shown[0]!.picture).toBe("/assets/monsters/C2-portrait.jpg");
    expect(shown[0]!.fallback).toBe("/assets/monsters/C2-small.png");
    expect(shown[0]!.name.length).toBeGreaterThan(0);
  });

  it("counts every raider", () => {
    expect(raiderCount({ C2: 10, C4: 5 })).toBe(15);
  });

  it("rounds the yard's health down, so 89.9% never reads as 90%", () => {
    expect(healthText(0.899)).toBe("89%");
    expect(healthText(0.9)).toBe("90%");
    expect(healthText(1.2)).toBe("100%");
    expect(healthText(-1)).toBe("0%");
  });

  it("says whether anything was stolen", () => {
    expect(anyStolen({ stolen: { r1: 0, r2: 0, r3: 0, r4: 0 } })).toBe(false);
    expect(anyStolen({ stolen: { r1: 0, r2: 3, r3: 0, r4: 0 } })).toBe(true);
  });

  it("calls the attack repelled only after a good defence", () => {
    expect(frequencyTitle(true)).toBe("ATTACK REPELLED");
    expect(frequencyTitle(false)).toBe("THE RAIDERS HAVE GONE");
  });
});
