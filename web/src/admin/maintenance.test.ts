// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MaintenanceChange, MaintenancePanelView } from "./api";

const sent: MaintenanceChange[] = [];
let answer: MaintenancePanelView;

vi.mock("./api", () => ({
  fetchMaintenancePanel: vi.fn(async () => answer),
  changeMaintenance: vi.fn(async (change: MaintenanceChange) => {
    sent.push(change);
    return answer;
  }),
}));

const { MaintenanceView, clock, maintenanceSentence } = await import("./maintenance");

const LIMITS = { minutes: [1, 5, 10, 15], defaultMinutes: 5, defaultMessage: "Server maintenance. Back soon!", messageMax: 140 };
const off: MaintenancePanelView = {
  now: 0,
  on: false,
  message: "",
  backAt: null,
  startedAt: null,
  cutoffAt: null,
  remainingMs: 0,
  cutOff: false,
  updatedAt: null,
  updatedBy: null,
  limits: LIMITS,
};
const onPanel = (remainingMs: number): MaintenancePanelView => ({
  ...off,
  on: true,
  message: "Moving",
  startedAt: 1,
  cutoffAt: 2,
  remainingMs,
  cutOff: remainingMs === 0,
});

afterEach(() => {
  sent.length = 0;
});

describe("the dashboard's maintenance panel", () => {
  it("says in one sentence whether players can play", () => {
    expect(maintenanceSentence(off, 0)).toBe("Off. Everyone can play.");
    expect(maintenanceSentence(onPanel(299_000), 299_000)).toContain("signed out in 4:59");
    expect(maintenanceSentence(onPanel(0), 0)).toBe("On. Players are signed out. Only you can play.");
    expect(clock(61_000)).toBe("1:01");
  });

  it("Off: picks a countdown (5 by default) and turns on with the message and back-at time", async () => {
    answer = off;
    const view = new MaintenanceView({ say: vi.fn(), confirm: () => true });
    await view.refresh();
    const turnOn = [...view.element.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Turn on"))!;
    expect(turnOn.textContent).toBe("Turn on (5 min)");
    view.element.querySelector<HTMLButtonElement>('[data-minutes="15"]')!.click();
    expect(turnOn.textContent).toBe("Turn on (15 min)");
    view.element.querySelector<HTMLInputElement>("#maint-message")!.value = "Moving";
    view.element.querySelector<HTMLInputElement>("#maint-back")!.value = "2026-11-22T15:30";
    answer = onPanel(900_000);
    turnOn.click();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({
      action: "on",
      message: "Moving",
      backAt: new Date("2026-11-22T15:30").toISOString(),
      minutes: 15,
    });
  });

  it("On: Turn off cancels; nothing is sent when the owner says no", async () => {
    answer = onPanel(120_000);
    let yes = false;
    const view = new MaintenanceView({ say: vi.fn(), confirm: () => yes });
    await view.refresh();
    expect(view.element.classList.contains("is-on")).toBe(true);
    const offButton = [...view.element.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Turn off"))!;
    expect(offButton.textContent).toBe("Turn off (cancel countdown)");
    offButton.click();
    expect(sent).toHaveLength(0);
    yes = true;
    answer = off;
    offButton.click();
    await vi.waitFor(() => expect(sent).toEqual([{ action: "off" }]));
  });
});
