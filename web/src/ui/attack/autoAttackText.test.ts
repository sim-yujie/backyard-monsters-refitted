import { describe, expect, it } from "vitest";
import type { AutoAttackPlanResponse, PlanSummary } from "@/api/autoAttack";
import { ApiError, NetworkError } from "@/api/http";
import {
  agoText,
  autoAttackErrorText,
  includesText,
  monstersText,
  planSourceText,
  repeatRefusal,
  shortfallText,
} from "./autoAttackText";

/** What auto-attack says (issue #221). */

const PLAN: PlanSummary = {
  tribe: "Kozu",
  level: 35,
  recordedOn: { baseid: "1000240208", x: 240, y: 208 },
  recordedAt: 1_000_000,
  monsters: { C1: 300, C5: 40 },
  champions: [{ t: 1, l: 5 }],
  bombs: ["tw1", "pb1", "pu0"],
  siege: false,
};

const answer = (overrides: Partial<AutoAttackPlanResponse> = {}): AutoAttackPlanResponse => ({
  error: 0,
  baseid: "1000241208",
  plan: PLAN,
  missing: [],
  outOfRange: false,
  underAttack: false,
  damage: 41,
  ...overrides,
});

describe("autoAttackText", () => {
  it("says which attack a camp repeats, and when", () => {
    expect(planSourceText(PLAN, "1000241208", 1_000_000 + 7_300)).toBe(
      "Repeats your attack on the Kozu camp at 240, 208, 2 h ago",
    );
    expect(planSourceText(PLAN, "1000240208", 1_000_030)).toBe("Repeats your attack on this camp, just now");
    expect(agoText(90)).toBe("1 min ago");
    expect(agoText(86_400 * 3)).toBe("3 days ago");
  });

  it("names the army, biggest first, and what it brings besides", () => {
    expect(monstersText(PLAN.monsters)).toBe("300 Pokey, 40 Eye-ra");
    expect(includesText(PLAN)).toBe("Includes Gorgo L5 and 3 bombs");
    expect(includesText({ champions: [], bombs: ["tw0"] })).toBe("Includes 1 bomb");
    expect(includesText({ champions: [], bombs: [] })).toBeNull();
  });

  it("lists exactly what is missing", () => {
    expect(shortfallText({ kind: "monster", id: "C1", need: 300, have: 288 })).toBe(
      "Pokey: 12 short (you have 288 of 300 in range)",
    );
    expect(shortfallText({ kind: "champion", t: 1, reason: "hurt" })).toBe("Gorgo has no health left");
    expect(shortfallText({ kind: "bomb", id: "tw1", reason: "catapult" })).toBe("Big twig bomb: your Catapult is too low");
  });

  it("greys Repeat attack out for what the server says", () => {
    expect(repeatRefusal(answer())).toBeNull();
    expect(repeatRefusal(answer({ plan: null }))).toBeNull();
    expect(repeatRefusal(answer({ underAttack: true }))).toContain("attacking this camp");
    expect(repeatRefusal(answer({ outOfRange: true }))).toContain("out of your Flingers' range");
    expect(repeatRefusal(answer({ missing: [{ kind: "monster", id: "C1", need: 2, have: 1 }] }))).toContain("missing");
  });

  it("turns the server's refusal into words, with the missing list", () => {
    const refused = new ApiError("You do not have everything that attack used.", {
      status: 409,
      details: { data: { reason: "missing", missing: [{ kind: "monster", id: "C1", need: 2, have: 1 }] } } as never,
    });
    expect(autoAttackErrorText(refused)).toEqual({
      message: "You do not have everything that attack used.",
      missing: [{ kind: "monster", id: "C1", need: 2, have: 1 }],
    });
    expect(autoAttackErrorText(new ApiError("slow", { status: 429 })).message).toContain("ten auto-attacks");
    expect(autoAttackErrorText(new NetworkError("down", null)).message).toContain("Nothing was spent");
  });
});
