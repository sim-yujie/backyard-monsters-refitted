// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MonsterMadnessPanelView } from "./api";

const calls: string[] = [];
let answer: MonsterMadnessPanelView;
let refusal: Error | null = null;

vi.mock("./api", () => ({
  fetchMonsterMadness: vi.fn(async () => answer),
  changeMonsterMadness: vi.fn(async (action: "start" | "stop") => {
    calls.push(action);
    if (refusal) throw refusal;
    return answer;
  }),
}));

const { MonsterMadnessView, monsterMadnessGoalsLine, monsterMadnessSentence } = await import("./monsterMadness");

const NOW = 1_794_614_400;
const DAY = 86_400;

const panelOf = (patch: Partial<MonsterMadnessPanelView> = {}): MonsterMadnessPanelView => ({
  now: NOW,
  running: null,
  last: null,
  days: 4,
  goals: [42_000_000, 94_500_000, 160_125_000],
  updatedAt: null,
  updatedBy: null,
  ...patch,
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

afterEach(() => {
  calls.length = 0;
  refusal = null;
});

describe("the Monster Madness box", () => {
  it("says whether it is on, in one sentence", () => {
    expect(monsterMadnessSentence(panelOf())).toBe("Off. It has never run.");
    const running = { startsAt: NOW - DAY, endsAt: NOW + 3 * DAY };
    expect(monsterMadnessSentence(panelOf({ running, last: running }))).toBe("On now. Ends in 3\u00a0d\u00a00\u00a0h.");
    expect(monsterMadnessSentence(panelOf({ last: { startsAt: NOW - 5 * DAY, endsAt: NOW - DAY } }))).toMatch(/^Off\. Last run ended /);
    expect(monsterMadnessGoalsLine(panelOf())).toBe(
      "Goals 42M / 94.5M / 160.125M points: Korath's Burn, Breath of Fire, Fists of Doom.",
    );
  });

  it("starts a run after asking, and offers Stop once it is on", async () => {
    answer = panelOf();
    const said: string[] = [];
    const asked: string[] = [];
    const view = new MonsterMadnessView({ say: (words) => said.push(words), confirm: (q) => (asked.push(q), true) });
    await view.refresh();
    const start = view.element.querySelector<HTMLButtonElement>("button")!;
    expect(start.textContent).toBe("Start 4 days");

    answer = panelOf({ running: { startsAt: NOW, endsAt: NOW + 4 * DAY } });
    start.click();
    await flush();
    expect(asked[0]).toContain("for 4 days");
    expect(calls).toEqual(["start"]);
    expect(said).toEqual(["Monster Madness started"]);
    expect(view.element.querySelector("button")!.textContent).toBe("Stop");
    expect(view.element.querySelector(".weekend-sentence.is-on")).not.toBeNull();
  });

  it("does nothing when the owner says no", async () => {
    answer = panelOf({ running: { startsAt: NOW, endsAt: NOW + DAY } });
    const view = new MonsterMadnessView({ say: () => undefined, confirm: () => false });
    await view.refresh();
    view.element.querySelector<HTMLButtonElement>("button")!.click();
    await flush();
    expect(calls).toEqual([]);
  });

  it("says the server's refusal and shows the state again", async () => {
    answer = panelOf();
    refusal = new Error("Monster Madness is already on.");
    const said: string[] = [];
    const view = new MonsterMadnessView({ say: (words) => said.push(words), confirm: () => true });
    await view.refresh();
    view.element.querySelector<HTMLButtonElement>("button")!.click();
    await flush();
    expect(said).toEqual(["Monster Madness is already on."]);
    expect(view.element.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
  });
});
