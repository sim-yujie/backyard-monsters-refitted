// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { resetWeekend, setWeekend, setWeekendCheckin, type WeekendCheckin, type WeekendRun } from "@/game/weekend";
import {
  checkinNextText,
  openWeekendPopup,
  studySeconds,
  WEEKEND_CHECKIN_BUTTON,
  weekendAmount,
  weekendCheckinBlock,
  weekendChip,
} from "./weekendUi";

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

/** Saturday of STUDY, not checked in yet. */
const SATURDAY_CHECKIN: WeekendCheckin = {
  key: "2026-11-14",
  amount: 50,
  day: 1,
  days: 2,
  claimedToday: false,
  marks: [
    { day: 1, claimed: false },
    { day: 2, claimed: false },
  ],
  nextAt: STUDY.startsAt + 86_400,
};
const SATURDAY_DONE: WeekendCheckin = {
  ...SATURDAY_CHECKIN,
  claimedToday: true,
  marks: [
    { day: 1, claimed: true },
    { day: 2, claimed: false },
  ],
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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

  it("Friday: what the check-in pays, no button yet, never the word boost", () => {
    openWeekendPopup({ container: document.body, run: STUDY, now: STUDY.startsAt - 7_200, onCheckIn: async () => null });
    const block = document.querySelector<HTMLElement>(".weekend-checkin")!;
    expect(block.dataset["checkin"]).toBe("unknown");
    expect(block.textContent).toBe("50each day");
    expect(document.querySelector(`.${WEEKEND_CHECKIN_BUTTON}`)).toBeNull();
    expect(document.querySelector(".weekend-popup")?.textContent).not.toMatch(/boost|played/i);
  });

  it("while it runs: Check in [glimmer] 50, focused; done turns it to a tick and the next day's time", async () => {
    setWeekend({ active: STUDY, next: null }, NOW);
    setWeekendCheckin(SATURDAY_CHECKIN);
    let calls = 0;
    openWeekendPopup({
      container: document.body,
      run: STUDY,
      now: NOW,
      onCheckIn: async () => {
        calls++;
        setWeekendCheckin(SATURDAY_DONE);
        return null;
      },
    });
    const button = document.querySelector<HTMLButtonElement>(`.${WEEKEND_CHECKIN_BUTTON}`)!;
    expect(button.textContent).toBe("Check in50");
    expect(button.getAttribute("aria-label")).toBe("Check in: 50 Glimmers");
    expect(document.activeElement).toBe(button);
    const days = [...document.querySelectorAll<HTMLElement>(".weekend-checkin__day")].map((d) => d.className);
    expect(days).toEqual([
      "weekend-checkin__day weekend-checkin__day--today",
      "weekend-checkin__day weekend-checkin__day--later",
    ]);
    button.click();
    // A second click while it is on its way does nothing.
    document.querySelector<HTMLButtonElement>(`.${WEEKEND_CHECKIN_BUTTON}`)?.click();
    await flush();
    expect(calls).toBe(1);
    expect(document.querySelector(`.${WEEKEND_CHECKIN_BUTTON}`)).toBeNull();
    expect(document.querySelector<HTMLElement>(".weekend-checkin")!.dataset["checkin"]).toBe("done");
    expect(document.querySelector(".weekend-checkin__next")?.textContent).toMatch(/^Next in 2[23]h/);
    expect(document.querySelector(".weekend-checkin__day--claimed")?.getAttribute("title")).toBe("Day 1: checked in");
  });

  it("a refused check-in says why under the button", async () => {
    setWeekend({ active: STUDY, next: null }, NOW);
    setWeekendCheckin(SATURDAY_CHECKIN);
    openWeekendPopup({ container: document.body, run: STUDY, now: NOW, onCheckIn: async () => "Could not reach the server." });
    document.querySelector<HTMLButtonElement>(`.${WEEKEND_CHECKIN_BUTTON}`)!.click();
    await flush();
    expect(document.querySelector(".weekend-checkin__error")?.textContent).toBe("Could not reach the server.");
    expect(document.querySelector<HTMLButtonElement>(`.${WEEKEND_CHECKIN_BUTTON}`)?.disabled).toBe(false);
  });

  it("an outpost or the Inferno: no button, it says where", () => {
    setWeekend({ active: STUDY, next: null }, NOW);
    setWeekendCheckin(SATURDAY_CHECKIN);
    openWeekendPopup({ container: document.body, run: STUDY, now: NOW });
    expect(document.querySelector(`.${WEEKEND_CHECKIN_BUTTON}`)).toBeNull();
    expect(document.querySelector(".weekend-checkin__info")?.textContent).toBe("50Check in on your main yard");
  });
});

describe("weekendCheckinBlock", () => {
  it("Sunday after a missed Saturday: day 1 missed, day 2 ticked, Done", () => {
    const block = weekendCheckinBlock({
      checkin: {
        ...SATURDAY_CHECKIN,
        day: 2,
        claimedToday: true,
        marks: [
          { day: 1, claimed: false },
          { day: 2, claimed: true },
        ],
        nextAt: null,
      },
      now: NOW + 86_400,
      onCheckIn: () => {},
    });
    expect([...block.querySelectorAll(".weekend-checkin__day")].map((d) => d.className.split("--")[1])).toEqual([
      "missed",
      "claimed",
    ]);
    expect(block.querySelector(".weekend-checkin__next")?.textContent).toBe("Done");
    expect(checkinNextText(1_000 + 3_600, 1_000)).toBe("Next in 1h 0m");
  });
});
