// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TestReport } from "@/game/baiter/testReport";
import { TestReportPanel, type TestReportOptions } from "./TestReport";

/** A Baiter test's report panel (#22, WP4): three tabs, tappable towers, four ways on. */

const REPORT: TestReport = {
  result: "held",
  resultLine: "Your yard held",
  damagePercent: 23.7,
  buildingsDestroyed: 2,
  buildingsTotal: 14,
  time: "1:42",
  attackersSent: 21,
  attackersBeaten: 21,
  champions: [{ name: "Korath", survived: false, health: 0, fellAt: "1:30" }],
  hint: "1 tower never fired.",
  towers: [
    { id: 7, name: "Cannon Tower L5", damage: 4200, kills: 12, shots: 80, firstShot: "0:04", fired: true, fate: "Standing, 72%" },
    { id: 9, name: "Sniper Tower L2", damage: 0, kills: 0, shots: 0, firstShot: "Never fired", fired: false, fate: "Destroyed at 1:10" },
  ],
  traps: [{ id: 11, name: "Boom Trap", at: "0:20", damage: 600, kills: 3 }],
  bunkers: [],
  cagedChampion: null,
  attackers: [
    { name: "Bandito L3", champion: false, sent: 20, spawned: 0, lost: 20, buildingDamage: 3100 },
    { name: "Korath L4", champion: true, sent: 1, spawned: 0, lost: 1, buildingDamage: 900 },
  ],
};

const mountPanel = (extra: Partial<TestReportOptions> = {}) => {
  const options = {
    report: REPORT,
    onBuilding: vi.fn(),
    onAgain: vi.fn(),
    onChangeArmy: vi.fn(),
    onBack: vi.fn(),
    ...extra,
  };
  const panel = new TestReportPanel(options).mount(document.body);
  return { panel, options };
};

const visibleView = (): HTMLElement =>
  [...document.querySelectorAll<HTMLElement>("[role=tabpanel]")].find((view) => !view.hidden)!;

describe("a Baiter test's report panel", () => {
  afterEach(() => document.body.replaceChildren());

  it("opens on the Summary: the result, the figures, the champion's fate and the hint", () => {
    mountPanel();
    const tabs = [...document.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Summary", "Towers", "Attackers"]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    const summary = visibleView();
    expect(summary.querySelector(".test-report__result")!.textContent).toBe("Your yard held");
    expect(summary.textContent).toContain("23%");
    expect(summary.textContent).toContain("2 of 14");
    expect(summary.textContent).toContain("1:42");
    expect(summary.textContent).toContain("21 of 21");
    expect(summary.textContent).toContain("Fell at 1:30");
    expect(summary.querySelector(".test-report__hint")!.textContent).toBe("1 tower never fired.");
    expect(document.activeElement).toBe(document.querySelector(".test-report__back"));
  });

  it("switches tabs by click and by arrow keys", () => {
    mountPanel();
    const tabs = [...document.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    tabs[1]!.click();
    expect(visibleView().id).toBe("test-report-towers");
    tabs[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(visibleView().id).toBe("test-report-attackers");
    expect(document.activeElement).toBe(tabs[2]);
    tabs[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(visibleView().id).toBe("test-report-summary");
  });

  it("lists the towers in order, and a tap on a row, or its name, shows that tower", () => {
    const { options } = mountPanel();
    document.querySelector<HTMLButtonElement>("#test-report-tab-towers")!.click();
    const rows = [...visibleView().querySelectorAll<HTMLTableRowElement>("tbody tr")];
    expect(rows.map((row) => row.querySelector("th")!.textContent)).toEqual(["Cannon Tower L5", "Sniper Tower L2", "Boom Trap"]);
    expect(rows[0]!.textContent).toContain("4,200");
    expect(rows[0]!.textContent).toContain("Standing, 72%");
    expect(rows[1]!.textContent).toContain("Never fired");
    expect(rows[1]!.classList.contains("test-report__row--muted")).toBe(true);

    rows[0]!.querySelector("td")!.click();
    expect(options.onBuilding).toHaveBeenLastCalledWith(7);
    rows[1]!.querySelector<HTMLButtonElement>(".test-report__show")!.click();
    expect(options.onBuilding).toHaveBeenLastCalledWith(9);
    expect(options.onBuilding).toHaveBeenCalledTimes(2);
  });

  it("lists the attackers with sent, lost and building damage", () => {
    mountPanel();
    document.querySelector<HTMLButtonElement>("#test-report-tab-attackers")!.click();
    const rows = [...visibleView().querySelectorAll("tbody tr")].map((row) => row.textContent);
    expect(rows).toEqual(["Bandito L320 / 203,100", "Korath L41 / 1900"]);
  });

  it("offers Test again, Change army and Back to yard, and Watch replay only when it can", () => {
    const { options } = mountPanel();
    expect(document.querySelector(".test-report__replay")).toBeNull();
    document.querySelector<HTMLButtonElement>(".test-report__again")!.click();
    document.querySelector<HTMLButtonElement>(".test-report__change")!.click();
    document.querySelector<HTMLButtonElement>(".test-report__back")!.click();
    expect(options.onAgain).toHaveBeenCalledTimes(1);
    expect(options.onChangeArmy).toHaveBeenCalledTimes(1);
    expect(options.onBack).toHaveBeenCalledTimes(1);

    document.body.replaceChildren();
    const onReplay = vi.fn();
    mountPanel({ onReplay });
    document.querySelector<HTMLButtonElement>(".test-report__replay")!.click();
    expect(onReplay).toHaveBeenCalledTimes(1);
  });
});
