// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { resetWeekend, setWeekend, type WeekendRun } from "@/game/weekend";
import { openWeekendPopup, studySeconds, WeekendBanner, weekendAmount, weekendChip } from "./weekendUi";

const NOW = 1_794_614_400 + 3_600;
const STUDY: WeekendRun = {
  id: "study",
  title: "Study Weekend",
  line: "Academy and Lab 30% faster",
  percent: 30,
  key: "2026-11-14",
  startsAt: NOW - 3_600,
  endsAt: NOW - 3_600 + 172_800,
  announceAt: NOW - 3_600 - 86_400,
  forced: false,
};

afterEach(() => {
  resetWeekend();
  document.body.replaceChildren();
});

describe("weekend chips", () => {
  it("−30% for lowered prices and times, +30% for loot", () => {
    expect(weekendAmount(STUDY)).toBe("−30%");
    expect(weekendAmount({ id: "plunder", percent: 30 })).toBe("+30%");
  });

  it("a chip and shorter times only while that event runs", () => {
    setWeekend({ active: STUDY, next: null }, NOW);
    expect(weekendChip("study", NOW)?.textContent).toBe("−30%");
    expect(weekendChip("study", NOW)?.querySelector("img")?.getAttribute("aria-label")).toBe(
      "Study Weekend: Academy and Lab 30% faster",
    );
    expect(weekendChip("hatch", NOW)).toBeNull();
    expect(studySeconds(36_000, NOW)).toBe(25_200);
    expect(studySeconds(36_000, STUDY.endsAt)).toBe(36_000);
  });
});

describe("WeekendBanner", () => {
  it("shows icon, title, amount and time left; hides with no run; opens the pop-up", () => {
    const opened: WeekendRun[] = [];
    const banner = new WeekendBanner((run) => opened.push(run));
    banner.update(STUDY, NOW);
    expect(banner.element.hidden).toBe(false);
    expect(banner.element.querySelector(".weekend-banner__title")?.textContent).toBe("Study Weekend");
    expect(banner.element.querySelector(".weekend-banner__amount")?.textContent).toBe("−30%");
    expect(banner.element.querySelector(".weekend-banner__left")?.textContent).toBe("1d 23h");
    expect(banner.element.dataset["event"]).toBe("study");
    banner.element.click();
    expect(opened).toEqual([STUDY]);
    banner.update(null, NOW);
    expect(banner.element.hidden).toBe(true);
  });
});

describe("openWeekendPopup", () => {
  it("Friday: starts in; while it runs: ends in; OK closes", () => {
    let closed = false;
    openWeekendPopup({ container: document.body, run: STUDY, now: STUDY.startsAt - 7_200, onClose: () => (closed = true) });
    expect(document.querySelector(".weekend-popup__title")?.textContent).toBe("Study Weekend");
    expect(document.querySelector(".weekend-popup__line")?.textContent).toBe("Academy and Lab 30% faster");
    expect(document.querySelector(".weekend-popup__when")?.textContent).toBe("Starts in 2h 0m");
    document.querySelector<HTMLButtonElement>(".weekend-popup__done")!.click();
    expect(closed).toBe(true);

    openWeekendPopup({ container: document.body, run: STUDY, now: NOW });
    expect(document.querySelector(".weekend-popup__when")?.textContent).toBe("Ends in 1d 23h");
  });
});
