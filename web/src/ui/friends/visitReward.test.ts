// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HelpAllSummary } from "@/game/friends/helpAll";
import type { HelpAllLine } from "./HelpAllBar";
import type { HelpFxStage } from "./helpAllFx";
import { HELP_LANDS_DONE_MS, HelpLandsFx } from "./helpLands";
import { rewardNode, VISIT_REWARD_MS } from "./visitReward";

/**
 * A friend's yard without the readouts (`visitReward.ts`; owner's option 1,
 * Review Desk 7, 15 Nov 2026): a help's reward shows in the visit bar's
 * line, never on a counter nobody sees.
 */

const stageWith = (reward?: "bar") => {
  const hud = { hold: vi.fn(), deliver: vi.fn(), floatBelow: vi.fn(), pulse: vi.fn(), releaseHeld: vi.fn() };
  const stage = {
    hud,
    marks: { hold: vi.fn(), leave: vi.fn(), release: vi.fn() },
    bar: { setProgress: vi.fn() },
    reducedMotion: true,
    ...(reward && { reward }),
  };
  return { stage: stage as unknown as HelpFxStage, hud };
};

const each = { r1: 100, r2: 100, r3: 100, r4: 100 };
const summary: HelpAllSummary = {
  helped: 2,
  secondsSaved: 3600,
  reward: { r1: 200, r2: 200, r3: 200, r4: 200 },
  skipped: 0,
  stoppedBy: null,
};
const line: HelpAllLine = { text: "Helped 2", kind: "thanks" };

const play = async (stage: HelpFxStage): Promise<HelpAllLine | null> => {
  const fx = new HelpLandsFx(stage);
  fx.start([1, 2]);
  fx.helped({ id: 1, secondsSaved: 1800, reward: each });
  fx.helped({ id: 2, secondsSaved: 1800, reward: each });
  const result = fx.done(summary, line);
  await vi.advanceTimersByTimeAsync(2000);
  return result;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rewardNode", () => {
  it("shows one amount and the four pictures when all four got the same", () => {
    const node = rewardNode({ r1: 172_800, r2: 172_800, r3: 172_800, r4: 172_800 })!;
    expect(node.querySelectorAll(".visit-reward__amount")).toHaveLength(1);
    expect(node.textContent).toBe("+172.8K");
    expect(node.querySelectorAll(".res-icon")).toHaveLength(4);
  });

  it("shows each picture with its own amount when they differ, and nothing for nothing", () => {
    const node = rewardNode({ r1: 1200, r4: 500 })!;
    expect(node.classList.contains("visit-reward--each")).toBe(true);
    expect([...node.querySelectorAll(".visit-reward__pair")].map((pair) => pair.textContent)).toEqual(["+1.2K", "+500"]);
    expect(rewardNode({})).toBeNull();
  });
});

describe("Help all on a yard without the readouts", () => {
  it("adds the reward without counting a hidden counter up, and shows it in the bar's line", async () => {
    const { stage, hud } = stageWith("bar");
    const result = await play(stage);
    expect(hud.deliver).toHaveBeenCalledWith("r1", 200, 0);
    expect(hud.floatBelow).not.toHaveBeenCalled();
    expect(hud.pulse).not.toHaveBeenCalled();
    expect(result?.node?.querySelector(".visit-reward")?.textContent).toBe("+200");
    expect(result?.ms).toBe(VISIT_REWARD_MS);
  });

  it("with the readouts, the counters count up as before", async () => {
    const { stage, hud } = stageWith();
    expect((await play(stage))?.ms).toBe(HELP_LANDS_DONE_MS);
    expect(hud.floatBelow).toHaveBeenCalledWith("r1", 200);
  });
});
