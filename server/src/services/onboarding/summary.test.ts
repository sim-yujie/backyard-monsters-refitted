import { describe, expect, test } from "bun:test";
import type { Save } from "../../database/models/save.model.js";
import { onboardingSummary } from "./summary.js";

/** What the client is told about `save.onboarding` (issue #227, `docs/design/tutorial.md` §8.1). */

const saveWith = (onboarding: unknown): Save => ({ onboarding }) as unknown as Save;

describe("onboardingSummary", () => {
  test("a legacy save: no step, no camp, nothing to claim yet", () => {
    expect(onboardingSummary(saveWith(null))).toEqual({
      guide: { state: "legacy" },
      camp: "none",
      goalsReady: 0,
      tips: {},
    });
  });

  test("a running guide: its step, and the building it paid for and has not finished", () => {
    const summary = onboardingSummary(
      saveWith({
        v: 1,
        guide: { state: "active", step: "finish-housing" },
        grants: {
          "fund:21": { id: 7, at: 100 },
          "finish:21": { id: 7, at: 110 },
          "fund:15": { id: 9, at: 200 },
          army: [{ added: 15, at: 50 }],
        },
        camp: { state: "none" },
        tips: { mail: 5 },
        counters: { mushrooms: 99 },
      })
    );

    expect(summary).toEqual({
      guide: { state: "active", step: "finish-housing", building: 9 },
      camp: "none",
      goalsReady: 0,
      tips: { mail: 5 },
    });
  });

  test("never leaks the ledger or the counters, and drops the step once the guide is over", () => {
    const summary = onboardingSummary(
      saveWith({
        v: 1,
        guide: { state: "done", step: "protection", endedAt: 9 },
        grants: { "fund:5": { id: 3, at: 1 } },
        camp: { state: "removed" },
      })
    );

    expect(summary).toEqual({ guide: { state: "done" }, camp: "removed", goalsReady: 0, tips: {} });
  });
});
