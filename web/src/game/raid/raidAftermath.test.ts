import { describe, expect, it, vi } from "vitest";
import type { RaidPreference, RaidResult } from "@/api/raid";
import { runRaidAftermath, type RaidAftermathView } from "./raidAftermath";

/** After a raid has landed (issue #226 WP4): the result, then the frequency question. */

const result = (defended: boolean): RaidResult => ({
  id: "r1",
  tribe: "Abunakki",
  at: 1_000,
  defended,
  health: defended ? 0.93 : 0.4,
  stolen: { r1: defended ? 0 : 500, r2: 0, r3: 0, r4: 0 },
  shiny: defended ? 10 : 0,
  damaged: defended ? [] : [3, 4],
  housedLost: 0,
});

const view = (answer: RaidPreference | null) => {
  const order: string[] = [];
  const notices: string[] = [];
  const shown: RaidAftermathView = {
    result: vi.fn(async () => {
      order.push("result");
    }),
    frequency: vi.fn(async () => {
      order.push("frequency");
      return answer;
    }),
    notice: (message) => notices.push(message),
  };
  return { shown, order, notices };
};

describe("runRaidAftermath", () => {
  it("shows the result, then asks how often, then saves the answer", async () => {
    const { shown, order } = view("more");
    const api = { frequency: vi.fn(async () => ({ error: 0, preference: 1 as const, nextAttack: 0 })) };
    await runRaidAftermath({ api, view: shown }, result(true));
    expect(order).toEqual(["result", "frequency"]);
    expect(shown.frequency).toHaveBeenCalledWith("Abunakki", true);
    expect(api.frequency).toHaveBeenCalledWith("more");
  });

  it("tells the frequency popup the defence was poor", async () => {
    const { shown } = view("same");
    const api = { frequency: vi.fn(async () => ({ error: 0, preference: 0 as const, nextAttack: 0 })) };
    await runRaidAftermath({ api, view: shown }, result(false));
    expect(shown.frequency).toHaveBeenCalledWith("Abunakki", false);
  });

  it("keeps the last choice when the popup is closed without one", async () => {
    const { shown } = view(null);
    const api = { frequency: vi.fn() };
    await runRaidAftermath({ api, view: shown }, result(true));
    expect(api.frequency).not.toHaveBeenCalled();
  });

  it("says so when the choice could not be saved", async () => {
    const { shown, notices } = view("less");
    const api = {
      frequency: vi.fn(async () => {
        throw new Error("offline");
      }),
    };
    await runRaidAftermath({ api, view: shown }, result(true));
    expect(notices).toEqual([expect.stringContaining("could not be saved")]);
  });
});
