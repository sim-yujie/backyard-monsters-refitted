// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompletedJob } from "@/api/types";
import { typeName } from "@/game/yard/planner/summary";
import { Notices } from "@/ui/maproom/Notices";
import {
  AWAY_NOTICE_TIMEOUT_MS,
  awayNoticeText,
  groupCompletedJobs,
  JOB_NOTICE_TIMEOUT_MS,
  JobNotices,
  noticeText,
} from "./JobNotices";

/** The yard's job toasts (design §3.1 "Notices"): one per kind, grouped, each building a button. */

const CANNON = 20;
const SNIPER = 21;
const SILO = 6;

const upgrade = (id: number, t: number, level: number, at = 100): CompletedJob => ({
  kind: "upgrade",
  id,
  t,
  at,
  detail: { from: level - 1, level, points: 10 },
});

describe("groupCompletedJobs", () => {
  it("says a Radio Tower the server took down, and what came back (D15)", () => {
    const radio: CompletedJob = {
      kind: "radioRemoved",
      id: 9,
      t: 113,
      at: 100,
      detail: { refund: { r1: 2000, r2: 2000, r3: 500, r4: 0 } },
    };
    const groups = groupCompletedJobs([radio]);
    expect(noticeText(groups[0]!)).toBe(
      "The Radio Tower is gone: 2,000 Twigs, 2,000 Pebbles, 500 Putty refunded",
    );
    expect(groups[0]!.items[0]!.buildingId).toBeNull();
    expect(awayNoticeText(groups)).toBe(
      "While you were away: the Radio Tower is gone: 2,000 Twigs, 2,000 Pebbles, 500 Putty refunded",
    );
    expect(
      noticeText(groupCompletedJobs([{ ...radio, detail: { refund: { r1: 0, r2: 0, r3: 0, r4: 0 } } }])[0]!),
    ).toBe("The Radio Tower is gone: nothing refunded (your storage is full)");
  });

  it("groups the upgrades that land together into one line, in the order they finished", () => {
    const groups = groupCompletedJobs([upgrade(1, CANNON, 5), upgrade(2, SNIPER, 3), upgrade(3, SILO, 7)]);
    expect(groups).toHaveLength(1);
    expect(noticeText(groups[0]!)).toBe(
      `3 upgrades finished: ${typeName(CANNON)} 5, ${typeName(SNIPER)} 3, ${typeName(SILO)} 7`,
    );
    expect(groups[0]!.items.map((item) => item.buildingId)).toEqual([1, 2, 3]);
  });

  it("says a single job in the singular", () => {
    const [group] = groupCompletedJobs([upgrade(4, CANNON, 2)]);
    expect(noticeText(group!)).toBe(`Upgrade finished: ${typeName(CANNON)} 2`);
  });

  it("keeps each kind apart: builds without a level 1, fortifications, and store buffs running out", () => {
    const groups = groupCompletedJobs([
      { kind: "build", id: 7, t: SILO, at: 1, detail: { from: 0, level: 1, points: 5 } },
      upgrade(8, CANNON, 6),
      { kind: "build", id: 9, t: CANNON, at: 2, detail: { from: 0, level: 3, points: 5 } },
      { kind: "fortify", id: 10, t: SNIPER, at: 3, detail: { from: 4, level: 4, fort: 2, points: 0 } },
      { kind: "storeItem", id: "BST", t: null, at: 4, detail: {} },
    ]);
    expect(groups.map(noticeText)).toEqual([
      `2 builds finished: ${typeName(SILO)}, ${typeName(CANNON)} 3`,
      `Upgrade finished: ${typeName(CANNON)} 6`,
      `Fortification finished: ${typeName(SNIPER)} (fortification 2)`,
      "Ran out: Sharper Tools",
    ]);
    expect(groups[3]!.items[0]!.buildingId).toBeNull();
  });

  it("names an unlocked monster (#104)", () => {
    const [group] = groupCompletedJobs([{ kind: "unlock", id: "C5", t: null, at: 1, detail: {} }]);
    expect(noticeText(group!)).toBe("Unlock finished: Eye-ra");
    expect(group!.items[0]!.buildingId).toBeNull();
  });

  it("reads a kind a later phase adds through its common keys", () => {
    const [group] = groupCompletedJobs([{ kind: "hatch", id: "C5", t: null, at: 1, detail: {} }]);
    expect(noticeText(group!)).toBe("Hatch finished: C5");
  });

  it("makes nothing of nothing", () => {
    expect(groupCompletedJobs([])).toEqual([]);
  });
});

describe("awayNoticeText", () => {
  it("heads the jobs the load finished with 'While you were away' (#135)", () => {
    expect(awayNoticeText(groupCompletedJobs([upgrade(1, CANNON, 5), upgrade(2, SILO, 7)]))).toBe(
      `While you were away: 2 upgrades finished: ${typeName(CANNON)} 5, ${typeName(SILO)} 7`,
    );
  });

  it("puts every kind in the one line, each heading carried on mid-sentence", () => {
    const groups = groupCompletedJobs([
      upgrade(1, CANNON, 5),
      { kind: "storeItem", id: "BST", t: null, at: 200, detail: {} },
    ]);
    expect(awayNoticeText(groups)).toBe(
      `While you were away: upgrade finished: ${typeName(CANNON)} 5; ran out: Sharper Tools`,
    );
  });

  it("is empty when nothing finished", () => {
    expect(awayNoticeText([])).toBe("");
  });
});

describe("JobNotices", () => {
  let notices: Notices;
  let select: ReturnType<typeof vi.fn<(id: number) => void>>;
  let jobs: JobNotices;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    notices = new Notices().mount(document.body);
    select = vi.fn<(id: number) => void>();
    jobs = new JobNotices(notices, select);
  });

  afterEach(() => {
    notices.destroy();
    vi.useRealTimers();
  });

  const toasts = (): HTMLElement[] => [...notices.element.querySelectorAll<HTMLElement>(".notice")];

  it("shows one info toast per kind, each building a button that selects it", () => {
    jobs.show([upgrade(1, CANNON, 5), upgrade(2, SNIPER, 3)]);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]!.classList.contains("notice--info")).toBe(true);
    const buttons = [...toasts()[0]!.querySelectorAll<HTMLButtonElement>(".job-notice__building")];
    expect(buttons.map((one) => one.textContent)).toEqual([`${typeName(CANNON)} 5`, `${typeName(SNIPER)} 3`]);
    buttons[1]!.click();
    expect(select).toHaveBeenCalledWith(2);
  });

  it("stacks a second batch beside the first rather than overwriting it, and clears both on time", () => {
    jobs.show([upgrade(1, CANNON, 5)]);
    jobs.show([upgrade(2, SNIPER, 3)]);
    expect(toasts()).toHaveLength(2);
    vi.advanceTimersByTime(JOB_NOTICE_TIMEOUT_MS + 1);
    expect(toasts()).toHaveLength(0);
  });

  it("shows nothing for an answer where nothing finished", () => {
    jobs.show([]);
    expect(toasts()).toHaveLength(0);
  });

  it("shows what finished while the player was away as one toast, buildings still buttons", () => {
    jobs.showAway([
      upgrade(1, CANNON, 5),
      { kind: "build", id: 2, t: SILO, at: 150, detail: { from: 0, level: 1, points: 5 } },
    ]);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]!.querySelector(".notice__text")!.textContent).toBe(
      `While you were away: upgrade finished: ${typeName(CANNON)} 5; build finished: ${typeName(SILO)}`,
    );
    const buttons = [...toasts()[0]!.querySelectorAll<HTMLButtonElement>(".job-notice__building")];
    expect(buttons).toHaveLength(2);
    buttons[1]!.click();
    expect(select).toHaveBeenCalledWith(2);
  });

  it("keeps the away toast up longer than a job toast, then clears it", () => {
    jobs.showAway([upgrade(1, CANNON, 5)]);
    vi.advanceTimersByTime(JOB_NOTICE_TIMEOUT_MS + 1);
    expect(toasts()).toHaveLength(1);
    vi.advanceTimersByTime(AWAY_NOTICE_TIMEOUT_MS - JOB_NOTICE_TIMEOUT_MS);
    expect(toasts()).toHaveLength(0);
  });

  it("shows no away toast when nothing finished while the player was away", () => {
    jobs.showAway([]);
    expect(toasts()).toHaveLength(0);
  });
});
