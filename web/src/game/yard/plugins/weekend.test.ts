// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetWeekend, setWeekend, type WeekendRun } from "@/game/weekend";
import { Notices } from "@/ui/maproom/Notices";
import type { YardMounts } from "../yardPlugins";

vi.mock("@/api/weekend", () => ({ refreshWeekend: vi.fn(() => Promise.resolve()) }));
vi.mock("./announcements", () => ({ screenBusy: () => false }));

const { weekendPlugin, WEEKEND_SEEN_KEY } = await import("./weekend");

const NOW = 1_794_614_400 + 3_600;
const BUILDERS: WeekendRun = {
  id: "builders",
  title: "Builder's Weekend",
  line: "Upgrades cost 30% less",
  percent: 30,
  key: "2026-11-14",
  startsAt: NOW - 3_600,
  endsAt: NOW - 3_600 + 172_800,
  announceAt: NOW - 3_600 - 86_400,
  forced: false,
};

const mountsOf = () => {
  const notices = new Notices();
  document.body.append(notices.element);
  const content = document.body.appendChild(document.createElement("div"));
  const modal = document.body.appendChild(document.createElement("div"));
  return {
    store: { kind: "main", save: { onboarding: { guide: { state: "done" } } } },
    overlay: { content, modal },
    notices,
    scene: { plannerOpen: () => false },
  } as unknown as YardMounts;
};

afterEach(() => {
  resetWeekend();
  window.localStorage.clear();
  document.body.replaceChildren();
});

describe("weekend plugin (owner, 13 Nov: no banner on the yard)", () => {
  it("puts nothing on the yard while the event runs; the once-per-weekend pop-up still opens", () => {
    setWeekend({ active: BUILDERS, next: null }, NOW);
    const mounts = mountsOf();
    const before = mounts.notices.element.childElementCount;
    const stop = weekendPlugin(mounts);
    expect(document.querySelector(".weekend-banner")).toBeNull();
    expect(mounts.notices.element.childElementCount).toBe(before);
    expect(mounts.overlay.modal.querySelectorAll(".weekend-popup")).toHaveLength(1);
    expect(window.localStorage.getItem(WEEKEND_SEEN_KEY)).toBe(BUILDERS.key);
    if (typeof stop === "function") stop();
  });

  it("no second pop-up for the same weekend", () => {
    window.localStorage.setItem(WEEKEND_SEEN_KEY, BUILDERS.key);
    setWeekend({ active: BUILDERS, next: null }, NOW);
    const mounts = mountsOf();
    const stop = weekendPlugin(mounts);
    expect(mounts.overlay.modal.querySelector(".weekend-popup")).toBeNull();
    expect(document.querySelector(".weekend-banner")).toBeNull();
    if (typeof stop === "function") stop();
  });
});
