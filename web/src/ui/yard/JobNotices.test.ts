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

/** The starter base the catch-up put in an empty main yard (issue #154). */
const starter = (resources = { r1: 1600, r2: 1600, r3: 0, r4: 0 }): CompletedJob => ({
  kind: "starterBase",
  id: 1,
  t: 14,
  at: 100,
  detail: {
    buildings: [
      { id: 1, t: 14, x: -70, y: 0, level: 1 },
      { id: 2, t: 1, x: 60, y: 0, level: 1 },
      { id: 3, t: 2, x: 60, y: 70, level: 1 },
      { id: 4, t: 12, x: 60, y: -70, level: 1 },
    ],
    resources,
  },
});

const READY = "Your yard is ready: a Town Hall and three starter buildings were placed";
const READY_WITH_GRANT = `${READY}. You also got 1,600 Twigs and 1,600 Pebbles`;

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

  it("says a Map Room the server added to a Map Room 2 yard that had none (owner 2026-09-28)", () => {
    const added: CompletedJob = {
      kind: "mapRoomAdded",
      id: 601,
      t: 11,
      at: 100,
      detail: { level: 2, x: -90, y: -50 },
    };
    const groups = groupCompletedJobs([added]);
    expect(noticeText(groups[0]!)).toBe("A Map Room was added to your yard");
    expect(groups[0]!.items[0]!.buildingId).toBe(601);
    expect(awayNoticeText(groups)).toBe("While you were away: a Map Room was added to your yard");
    expect(awayNoticeText(groupCompletedJobs([upgrade(1, CANNON, 5), added]))).toBe(
      `While you were away: upgrade finished: ${typeName(CANNON)} 5; a Map Room was added to your yard`,
    );
  });

  it("says the starter base as a sentence of its own, ahead of the away lead-in (#154)", () => {
    const added: CompletedJob = {
      kind: "mapRoomAdded",
      id: 5,
      t: 11,
      at: 100,
      detail: { level: 2, x: 0, y: 150 },
    };
    const groups = groupCompletedJobs([starter(), added]);
    expect(groups.map((group) => group.kind)).toEqual(["starterBase", "mapRoomAdded"]);
    expect(noticeText(groups[0]!)).toBe(READY_WITH_GRANT);
    expect(groups[0]!.items[0]!.buildingId).toBe(1);
    expect(awayNoticeText(groupCompletedJobs([starter()]))).toBe(READY_WITH_GRANT);
    expect(awayNoticeText(groups)).toBe(
      `${READY_WITH_GRANT}. While you were away: a Map Room was added to your yard`,
    );
  });

  it("leaves the resources out of the starter sentence when the storage took none", () => {
    const [group] = groupCompletedJobs([starter({ r1: 0, r2: 0, r3: 0, r4: 0 })]);
    expect(noticeText(group!)).toBe(READY);
    const [partial] = groupCompletedJobs([starter({ r1: 500, r2: 0, r3: 0, r4: 0 })]);
    expect(noticeText(partial!)).toBe(`${READY}. You also got 500 Twigs`);
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

  it("names a trained monster with its new level, pointing at its academy (#116)", () => {
    const groups = groupCompletedJobs([
      { kind: "train", id: "C2", t: null, at: 1, detail: { level: 4, academy: 12 } },
      { kind: "train", id: "C5", t: null, at: 2, detail: { level: 2, academy: null } },
    ]);
    expect(noticeText(groups[0]!)).toBe("2 trainings finished: Octo-ooze 4, Eye-ra 2");
    expect(groups[0]!.items.map((item) => item.buildingId)).toEqual([12, null]);
  });

  it("names a researched ability with its rank, pointing at the Lab (#118)", () => {
    const [group] = groupCompletedJobs([
      { kind: "research", id: "C3", t: null, at: 1, detail: { rank: 2, lab: 9 } },
    ]);
    expect(noticeText(group!)).toBe("Research finished: Bolt: Teleportation 2");
    expect(group!.items[0]!.buildingId).toBe(9);
  });

  it("says a champion starved and what it lost (#123)", () => {
    const [one] = groupCompletedJobs([
      { kind: "starve", id: "G2", t: null, at: 1, detail: { level: 3, feeds: 1, foodBonus: 0 } },
    ]);
    expect(noticeText(one!)).toBe("Your champion starved: Drull lost a feed");
    const [two] = groupCompletedJobs([
      { kind: "starve", id: "G1", t: null, at: 1, detail: { level: 6, feeds: 0, foodBonus: 2 } },
      { kind: "starve", id: "G1", t: null, at: 2, detail: { level: 6, feeds: 0, foodBonus: 1 } },
    ]);
    expect(noticeText(two!)).toBe("Your champion starved 2 times: Gorgo lost a food bonus, Gorgo lost a food bonus");
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

  it("says the added Map Room in the away toast, the Map Room a button that selects it", () => {
    jobs.showAway([{ kind: "mapRoomAdded", id: 601, t: 11, at: 100, detail: { level: 2, x: -90, y: -50 } }]);
    const text = toasts()[0]!.querySelector(".notice__text")!;
    expect(text.textContent).toBe("While you were away: a Map Room was added to your yard");
    text.querySelector<HTMLButtonElement>(".job-notice__building")!.click();
    expect(select).toHaveBeenCalledWith(601);
  });

  it("puts the starter base first in the away toast, its Town Hall a button that selects it", () => {
    jobs.showAway([upgrade(7, CANNON, 2), starter()]);
    expect(toasts()).toHaveLength(1);
    const text = toasts()[0]!.querySelector(".notice__text")!;
    expect(text.textContent).toBe(
      `${READY_WITH_GRANT}. While you were away: upgrade finished: ${typeName(CANNON)} 2`,
    );
    const buttons = [...text.querySelectorAll<HTMLButtonElement>(".job-notice__building")];
    expect(buttons.map((one) => one.textContent)).toEqual(["Town Hall", `${typeName(CANNON)} 2`]);
    buttons[0]!.click();
    expect(select).toHaveBeenCalledWith(1);
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
