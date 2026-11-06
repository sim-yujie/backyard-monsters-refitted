// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WeekendChange, WeekendPanelView } from "./api";

const calls: WeekendChange[] = [];
let answer: WeekendPanelView;

vi.mock("./api", () => ({
  fetchWeekend: vi.fn(async () => answer),
  changeWeekend: vi.fn(async (change: WeekendChange) => {
    calls.push(change);
    return answer;
  }),
}));

const { WeekendView, isSaturday, moveInRotation, numberProblem, planChange, saturdayLabel, weekendSentence } =
  await import("./weekend");

const NOW = 1_794_614_400 - 3_600; // Friday 13 Nov 2026 23:00 UTC
const EVENTS = [
  { id: "builders", title: "Builder's Weekend", line: "Upgrades cost {p}% less" },
  { id: "plunder", title: "Tribe Plunder", line: "Wild tribes give {p}% more loot" },
  { id: "study", title: "Study Weekend", line: "Academy and Lab {p}% faster" },
  { id: "hatch", title: "Hatch Rush", line: "Hatching {p}% faster" },
] as const;

const panelOf = (patch: Partial<WeekendPanelView> = {}): WeekendPanelView => ({
  now: NOW,
  settings: {
    enabled: true,
    rotation: ["builders", "plunder", "study", "hatch"],
    percent: { builders: 30, plunder: 30, study: 30, hatch: 30 },
    firstWeekend: "2026-11-14",
    utcOffsetMinutes: 0,
    lengthHours: 48,
    announceHours: 24,
    overrides: {},
    forced: null,
  },
  updatedAt: null,
  updatedBy: null,
  state: {
    active: null,
    next: {
      id: "builders",
      title: "Builder's Weekend",
      line: "Upgrades cost 30% less",
      percent: 30,
      key: "2026-11-14",
      startsAt: NOW + 3_600,
      endsAt: NOW + 3_600 + 172_800,
      announceAt: NOW + 3_600 - 86_400,
      forced: false,
    },
  },
  plan: [
    { key: "2026-11-14", startsAt: NOW + 3_600, rotation: "builders", override: null, runs: "builders" },
    { key: "2026-11-21", startsAt: NOW + 608_400, rotation: "plunder", override: "skip", runs: null },
  ],
  envForced: null,
  events: EVENTS.map((e) => ({ ...e })),
  limits: {
    minPercent: 1,
    maxPercent: 90,
    minOffsetMinutes: -720,
    maxOffsetMinutes: 840,
    minLengthHours: 1,
    maxLengthHours: 72,
    maxAnnounceHours: 72,
    maxForceHours: 72,
  },
  ...patch,
});

afterEach(() => {
  calls.length = 0;
});

describe("weekend helpers", () => {
  it("one sentence: next, on now, off", () => {
    expect(weekendSentence(panelOf())).toMatch(/^Next: Builder's Weekend \(Upgrades cost 30% less\), starts in 1/);
    const off = panelOf();
    off.settings.enabled = false;
    off.state.next = null;
    expect(weekendSentence(off)).toMatch(/^Weekend events are off/);
    const on = panelOf();
    on.state.active = { ...on.state.next!, startsAt: NOW - 60, forced: true };
    expect(weekendSentence(on)).toMatch(/^On now: Builder's Weekend .* \(run by hand\)\. Ends in /);
    // The time left never splits on a narrow screen: no-break spaces only.
    expect(weekendSentence(on).split("Ends in ")[1]).toMatch(/^\d+\u00a0[dhms](\u00a0\d+\u00a0[hm])?\.$/);
    expect(weekendSentence(panelOf()).split("starts in ")[1]).not.toContain(" ");
  });

  it("saturday labels, the choice's change, rotation moves and number checks", () => {
    expect(saturdayLabel("2026-11-14")).toBe("Sat 14 Nov");
    expect(isSaturday("2026-11-14")).toBe(true);
    expect(isSaturday("2026-11-15")).toBe(false);
    expect(planChange("2026-11-21", "")).toEqual({ action: "weekend", weekend: "2026-11-21", event: null });
    expect(planChange("2026-11-21", "skip")).toEqual({ action: "weekend", weekend: "2026-11-21", event: "skip" });
    expect(moveInRotation(["builders", "plunder", "study"], 1, -1)).toEqual(["plunder", "builders", "study"]);
    expect(moveInRotation(["builders", "plunder"], 0, -1)).toEqual(["builders", "plunder"]);
    expect(numberProblem("30", 1, 90, "x")).toBeNull();
    expect(numberProblem("0", 1, 90, "x")).toBe("x: between 1 and 90.");
    expect(numberProblem("3.5", 1, 90, "x")).toBe("x: type a whole number.");
  });
});

describe("WeekendView", () => {
  it("draws the sentence, the 8-weekend plan with each choice, and sends a swap", async () => {
    answer = panelOf();
    const view = new WeekendView({ say: () => {} });
    await view.refresh();
    const el = view.element;
    expect(el.querySelector(".weekend-sentence")?.textContent).toMatch(/^Next: Builder's Weekend/);
    const selects = [...el.querySelectorAll<HTMLSelectElement>(".weekend-plan select")];
    expect(selects.map((s) => s.value)).toEqual(["", "skip"]);
    expect(selects[0]!.options[0]!.textContent).toBe("Rotation: Builder's Weekend");

    selects[0]!.value = "hatch";
    selects[0]!.dispatchEvent(new Event("change"));
    await Promise.resolve();
    expect(calls).toEqual([{ action: "weekend", weekend: "2026-11-14", event: "hatch" }]);
  });

  it("Run now sends the event and hours; the switch turns events off", async () => {
    answer = panelOf();
    const view = new WeekendView({ say: () => {} });
    await view.refresh();
    const el = view.element;
    el.querySelector<HTMLSelectElement>("#weekend-force-event")!.value = "study";
    el.querySelector<HTMLInputElement>("#weekend-force-hours")!.value = "2";
    [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Run now")!.click();
    await Promise.resolve();
    expect(calls).toEqual([{ action: "force", event: "study", hours: 2 }]);
    await Promise.resolve();

    const toggle = view.element.querySelector<HTMLInputElement>("#weekend-enabled")!;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    await Promise.resolve();
    expect(calls[1]).toEqual({ action: "settings", enabled: false });
  });

  it("a forced run offers Stop", async () => {
    answer = panelOf();
    answer.settings.forced = { id: "plunder", since: NOW - 60, until: NOW + 7_200 };
    const view = new WeekendView({ say: () => {} });
    await view.refresh();
    const stop = [...view.element.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Stop Tribe Plunder",
    );
    stop!.click();
    await Promise.resolve();
    expect(calls).toEqual([{ action: "stopForce" }]);
  });
});
