// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestsView, QuestView } from "@/api/quests";
import { QuestsPanel, resetText, type QuestsPanelView } from "./QuestsPanel";

/** The Quests window: its tabs, rows, Claim, Swap, bonus and countdowns (beta 6). */

const NOW = Date.UTC(2026, 10, 2, 18, 0) / 1000;
const NEXT_DAY = Date.UTC(2026, 10, 3) / 1000;
const NEXT_WEEK = Date.UTC(2026, 10, 9) / 1000;

const quest = (slot: number, kind: string, over: Partial<QuestView> = {}): QuestView => ({
  slot,
  kind,
  need: 2,
  have: 0,
  claimed: false,
  ready: false,
  rewards: [{ kind: "resources", amounts: { r1: 4000 } }],
  ...over,
});

const questsView = (over: Partial<QuestsView> = {}): QuestsView => ({
  now: NOW,
  nextDayAt: NEXT_DAY,
  nextWeekAt: NEXT_WEEK,
  claimable: 3,
  login: { day: 3, claimedToday: false, onCard: 2, shiny: [2, 2, 3, 3, 5, 5, 10] },
  daily: {
    quests: [
      quest(0, "destroyTribe", { variant: "kozu", have: 2, ready: true }),
      quest(1, "hatchMonster", { variant: "C1", need: 3, have: 1 }),
      quest(2, "mushroom", { need: 1, have: 1, claimed: true }),
      quest(3, "juice", { need: 5, have: 0 }),
      quest(4, "feedChampion", { need: 1 }),
    ],
    bonus: { shiny: 5, ready: false, claimed: false },
    swapsLeft: 1,
  },
  weekly: {
    quests: [
      quest(0, "weeklyHelpGift", { need: 5, have: 5, ready: true, rewards: [{ kind: "speedup", item: "SP2", count: 1 }, { kind: "shiny", amount: 5 }] }),
      quest(1, "weeklyLootGoo", { need: 1_200_000, have: 300_000 }),
      quest(2, "weeklyFights", { need: 10, have: 4 }),
    ],
    bonus: { shiny: 10, ready: false, claimed: false },
  },
  ...over,
});

const list = (over: Partial<Extract<QuestsPanelView, { kind: "list" }>> = {}): QuestsPanelView => ({
  kind: "list",
  quests: questsView(),
  now: NOW,
  busy: null,
  refusal: null,
  ...over,
});

const panelOf = (tab?: "today" | "weekly") => {
  const options = {
    onClaimLogin: vi.fn(),
    onClaim: vi.fn(),
    onClaimBonus: vi.fn(),
    onSwap: vi.fn(),
    onRetry: vi.fn(),
    onClose: vi.fn(),
    ...(tab && { tab }),
  };
  const panel = new QuestsPanel(options).mount(document.body);
  return { panel, options };
};

const q = <T extends Element = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
const all = (selector: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(selector)];

afterEach(() => {
  document.body.replaceChildren();
});

describe("QuestsPanel", () => {
  it("opens on Today: the login card on top, then the five daily quests and the bonus", () => {
    const { panel } = panelOf();
    panel.render(list());
    expect(panel.activeTab).toBe("today");
    const pane = q("#quests-pane")!;
    expect(pane.firstElementChild?.classList.contains("quests-login")).toBe(true);
    expect(all(".quests-day")).toHaveLength(7);
    expect(q(".quests-day--today")?.dataset["day"]).toBe("3");
    expect(all(".quests-day--claimed")).toHaveLength(2);
    const rows = all(".quests-set--daily .quest");
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.querySelector(".quest__title")?.textContent)).toEqual([
      "Destroy 2 Kozu yards",
      "Hatch 3 Pokeys",
      "Pick a mushroom",
      "Juice 5 monsters",
      "Feed your champion",
      "All 5 done",
    ]);
    expect(rows[0]!.querySelector<HTMLImageElement>(".quest__picture")!.src).toContain("tribe_kozu");
  });

  it("shows Claim on a finished quest, a tick on a claimed one, and Swap on the unfinished ones", () => {
    const { panel, options } = panelOf();
    panel.render(list());
    const [tribe, hatch, mushroom] = all(".quests-set--daily .quest");
    tribe!.querySelector<HTMLButtonElement>(".quest__claim")!.click();
    expect(options.onClaim).toHaveBeenCalledWith("daily", 0);
    expect(mushroom!.querySelector(".quest__done")).not.toBeNull();
    expect(mushroom!.querySelector(".quest__swap")).toBeNull();
    hatch!.querySelector<HTMLButtonElement>(".quest__swap")!.click();
    expect(options.onSwap).toHaveBeenCalledWith(1);
    expect(hatch!.querySelector(".quest__count")?.textContent).toBe("1/3");
  });

  it("hides Swap once the day's swap is used", () => {
    const { panel } = panelOf();
    const view = questsView();
    panel.render(list({ quests: { ...view, daily: { ...view.daily, swapsLeft: 0 } } }));
    expect(all(".quest__swap")).toHaveLength(0);
    expect(q(".quests-set__swap-note")).toBeNull();
  });

  it("claims the login day and the ready bonus", () => {
    const { panel, options } = panelOf();
    const view = questsView();
    panel.render(list({ quests: { ...view, daily: { ...view.daily, bonus: { shiny: 5, ready: true, claimed: false } } } }));
    q<HTMLButtonElement>(".quests-login__claim")!.click();
    expect(options.onClaimLogin).toHaveBeenCalled();
    expect(q(".quests-login__claim")?.textContent).toContain("Claim day 3");
    q<HTMLButtonElement>("[data-bonus='daily'] .quest__claim")!.click();
    expect(options.onClaimBonus).toHaveBeenCalledWith("daily");
  });

  it("disables every Claim while one waits, and shows a refusal under its row", () => {
    const { panel } = panelOf();
    panel.render(list({ busy: "daily:0", refusal: { key: "daily:0", message: "Not done yet." } }));
    expect(all(".quests-claim").every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(q(".quest__claim")?.classList.contains("quests-claim--busy")).toBe(true);
    expect(q(".quests-refusal")?.textContent).toBe("Not done yet.");
  });

  it("says when the next login day opens once today's is claimed", () => {
    const { panel } = panelOf();
    const view = questsView();
    panel.render(list({ quests: { ...view, login: { ...view.login, claimedToday: true, onCard: 3 } } }));
    expect(q(".quests-login__claim")).toBeNull();
    expect(q(".quests-login__note")?.textContent).toBe("Next day in 6h 0m");
    panel.tick(NOW + 3600);
    expect(q(".quests-login__note")?.textContent).toBe("Next day in 5h 0m");
  });

  it("switches to Weekly: three quests, the bonus and the countdown to Monday", () => {
    const { panel, options } = panelOf();
    panel.render(list());
    q<HTMLButtonElement>("#quests-tab-weekly")!.click();
    expect(panel.activeTab).toBe("weekly");
    expect(q("#quests-tab-weekly")?.getAttribute("aria-selected")).toBe("true");
    const rows = all(".quests-set--weekly .quest");
    expect(rows).toHaveLength(4);
    expect(rows[1]!.querySelector(".quest__title")?.textContent).toBe("Loot 1.2M Goo");
    expect(rows[1]!.querySelector(".quest__count")?.textContent).toBe("300K/1.2M");
    expect(rows[1]!.querySelector(".res-icon--r4")).not.toBeNull();
    expect(all(".quest__swap")).toHaveLength(0);
    expect(q("[data-resets-at]")?.textContent).toBe(resetText(NEXT_WEEK - NOW));
    rows[0]!.querySelector<HTMLButtonElement>(".quest__claim")!.click();
    expect(options.onClaim).toHaveBeenCalledWith("weekly", 0);
  });

  it("puts each tab's claimable count on its tab", () => {
    const { panel } = panelOf();
    panel.render(list());
    expect(q("#quests-tab-today .quests-tabs__count")?.textContent).toBe("2");
    expect(q<HTMLElement>("#quests-tab-weekly .quests-tabs__count")?.textContent).toBe("1");
  });

  it("opens on the tab it is given, and shows loading and errors with a retry", () => {
    const { panel, options } = panelOf("weekly");
    expect(panel.activeTab).toBe("weekly");
    expect(q(".quests-status")?.textContent).toBe("Loading quests…");
    panel.render({ kind: "error", message: "No connection." });
    q<HTMLButtonElement>(".quests-status__retry")!.click();
    expect(options.onRetry).toHaveBeenCalled();
  });

  it("closes with Escape", () => {
    const { panel, options } = panelOf();
    panel.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(options.onClose).toHaveBeenCalled();
  });
});

describe("resetText", () => {
  it("counts down, and says to reopen once the time is up", () => {
    expect(resetText(3 * 86_400 + 5 * 3600)).toBe("Resets in 3d 5h");
    expect(resetText(0)).toBe("New quests: reopen Quests");
  });
});
