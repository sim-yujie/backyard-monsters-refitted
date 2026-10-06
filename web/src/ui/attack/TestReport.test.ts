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
  champions: [{ name: "Korath", survived: false, retreated: false, health: 0, fellAt: "1:30" }],
  hint: "1 tower never fired.",
  towers: [
    { id: 7, name: "Cannon Tower L5", damage: 4200, kills: 12, shots: 80, firstShot: "0:04", fired: true, fate: "Standing, 72%" },
    { id: 9, name: "Sniper Tower L2", damage: 0, kills: 0, shots: 0, firstShot: "Never fired", fired: false, fate: "Destroyed at 1:10" },
  ],
  traps: [{ id: 11, name: "Boom Trap", at: "0:20", damage: 600, kills: 3 }],
  bunkers: [],
  cagedChampions: [],
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

  it("says a champion that left the field retreated, with its health (#308)", () => {
    mountPanel({
      report: {
        ...REPORT,
        champions: [
          { name: "Gorgo", survived: true, retreated: true, health: 4210, fellAt: null },
          { name: "Krallen", survived: true, retreated: false, health: 900, fellAt: null },
        ],
      },
    });
    const summary = visibleView().textContent ?? "";
    expect(summary).toContain("Retreated with 4,210 health");
    expect(summary).toContain("Survived with 900 health");
  });

  it("gives focus back to what opened it on close (#308)", () => {
    const opener = document.body.appendChild(document.createElement("button"));
    opener.focus();
    const { panel } = mountPanel({ onBack: () => panel.close() });
    expect(document.activeElement).toBe(document.querySelector(".test-report__back"));
    document.querySelector<HTMLButtonElement>(".test-report__back")!.click();
    expect(document.querySelector(".test-report")).toBeNull();
    expect(document.activeElement).toBe(opener);

    // An opener gone meanwhile is left alone.
    opener.focus();
    const again = mountPanel().panel;
    opener.remove();
    expect(() => again.close()).not.toThrow();
    expect(document.activeElement).toBe(document.body);
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

  it("steps aside for a tapped tower, with a bar that brings the report back (#308)", () => {
    const onLeaveBuilding = vi.fn();
    const { panel, options } = mountPanel({ onLeaveBuilding });
    const backdrop = panel.element;
    const bar = backdrop.querySelector<HTMLElement>(".test-report__peek")!;
    // The same large window as the setup, on a dimming scrim.
    expect(backdrop.querySelector(".test-report")!.classList.contains("baiter-window")).toBe(true);
    expect(backdrop.classList.contains("popup-backdrop")).toBe(true);
    expect(bar.hidden).toBe(true);

    document.querySelector<HTMLButtonElement>("#test-report-tab-towers")!.click();
    const show = visibleView().querySelector<HTMLButtonElement>(".test-report__show")!;
    show.click();
    expect(options.onBuilding).toHaveBeenLastCalledWith(7);
    expect(panel.peeking).toBe(true);
    expect(backdrop.classList.contains("test-report__backdrop--peek")).toBe(true);
    expect(bar.hidden).toBe(false);
    expect(bar.textContent).toContain("Showing Cannon Tower L5");
    const back = bar.querySelector<HTMLButtonElement>(".test-report__peek-back")!;
    expect(document.activeElement).toBe(back);

    back.click();
    expect(panel.peeking).toBe(false);
    expect(backdrop.classList.contains("test-report__backdrop--peek")).toBe(false);
    expect(onLeaveBuilding).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(show);

    // Escape on the bar comes back too.
    show.click();
    back.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panel.peeking).toBe(false);
    expect(onLeaveBuilding).toHaveBeenCalledTimes(2);
  });

  it("names each caged champion that defended on its own row (#310)", () => {
    mountPanel({
      report: {
        ...REPORT,
        cagedChampions: [
          { name: "Krallen", damage: 1500, kills: 4, health: 0 },
          { name: "Gorgo", damage: 2300, kills: 6, health: 1800 },
        ],
      },
    });
    document.querySelector<HTMLButtonElement>("#test-report-tab-towers")!.click();
    const caged = [...visibleView().querySelectorAll("table")].at(-1)!;
    expect(caged.textContent).toContain("Caged champions");
    const rows = [...caged.querySelectorAll("tbody tr")];
    expect(rows.map((row) => row.querySelector("th")!.textContent)).toEqual(["Krallen", "Gorgo"]);
    expect(rows[0]!.textContent).toBe("Krallen1,50040");
    expect(rows[1]!.textContent).toBe("Gorgo2,30061,800");
  });

  it("calls a lone caged champion by its name, and shows no cage table without one", () => {
    mountPanel({ report: { ...REPORT, cagedChampions: [{ name: "Fomor", damage: 900, kills: 2, health: 3000 }] } });
    document.querySelector<HTMLButtonElement>("#test-report-tab-towers")!.click();
    const caged = [...visibleView().querySelectorAll("table")].at(-1)!;
    expect(caged.textContent).toContain("Caged champion");
    expect(caged.textContent).not.toContain("Caged champions");
    expect([...caged.querySelectorAll("tbody th")].map((cell) => cell.textContent)).toEqual(["Fomor"]);
    document.body.replaceChildren();

    mountPanel();
    document.querySelector<HTMLButtonElement>("#test-report-tab-towers")!.click();
    expect(visibleView().textContent).not.toContain("Caged champion");
  });

  it("lists the attackers with sent, lost and building damage", () => {
    mountPanel();
    document.querySelector<HTMLButtonElement>("#test-report-tab-attackers")!.click();
    const rows = [...visibleView().querySelectorAll("tbody tr")].map((row) => row.textContent);
    expect(rows).toEqual(["Bandito L320 / 203,100", "Korath L41 / 1900"]);
  });

  it("keeps a last column of words on the left and a last column of numbers on the right", () => {
    mountPanel();
    document.querySelector<HTMLButtonElement>("#test-report-tab-towers")!.click();
    const [towers, traps] = [...visibleView().querySelectorAll("table")];
    expect(towers!.classList.contains("test-report__table--text-last")).toBe(true);
    expect(traps!.classList.contains("test-report__table--text-last")).toBe(false);
    document.querySelector<HTMLButtonElement>("#test-report-tab-attackers")!.click();
    expect(visibleView().querySelector("table")!.classList.contains("test-report__table--text-last")).toBe(false);
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

  it("reopened in the yard: plain rows, its own way back, and no Test again or Change army (WP5)", () => {
    const onBack = vi.fn();
    new TestReportPanel({ report: REPORT, onBack, backLabel: "Close", onReplay: vi.fn(), replayLabel: "Watch again" }).mount(
      document.body,
    );
    expect(document.querySelector(".test-report__again")).toBeNull();
    expect(document.querySelector(".test-report__change")).toBeNull();
    expect(document.querySelector(".test-report__replay")!.textContent).toBe("Watch again");
    expect(document.querySelectorAll(".test-report__show")).toHaveLength(0);
    expect(document.querySelector("#test-report-towers caption")!.textContent).not.toContain("Tap one");
    const back = document.querySelector<HTMLButtonElement>(".test-report__back")!;
    expect(back.textContent).toBe("Close");
    back.click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
