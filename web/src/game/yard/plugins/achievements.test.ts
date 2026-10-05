// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AchievementsSeenReport } from "@/api/achievements";
import type { AchievementUnlock, BaseLoadResponse, GuideState, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import { NetworkError } from "@/api/http";
import { setAchievementsOpener } from "@/game/achievements/achievementsView";
import { UnlockInbox } from "@/game/achievements/unlockInbox";
import { outpostTarget, type OwnYardTarget } from "@/game/yard/ownYards";
import { YardStore } from "@/game/yard/YardStore";
import { CARD_MS, GAP_MS } from "@/ui/achievements/UnlockPopup";
import type { YardMounts } from "../yardPlugins";
import { guideOpen, UnlockPopupDoor } from "./achievements";

/**
 * The unlock pop-up on the own yard (#204, WP6), against a real store: the
 * load's and each answer's `achievements`, `seen`, the guided start's hold.
 */

const T0 = 2_000_000;

const unlock = (id: number, shiny = 10): AchievementUnlock => ({ id, name: `Ach ${id}`, shiny });

const onboarding = (state: GuideState) => ({ guide: { state }, camp: "none", goalsReady: 0, tips: {} });

/** A yard answer, with `extra` (achievements, onboarding) on top. */
const answer = <Report>(report: Report, extra: Record<string, unknown> = {}): YardResponse<Report> =>
  ({ error: 0, savetime: T0, currenttime: T0, completed: [], report, ...extra }) as unknown as YardResponse<Report>;

let inbox: UnlockInbox;
let content: HTMLElement;
let doors: UnlockPopupDoor[];

const setup = (
  save: Partial<BaseLoadResponse> = {},
  send = vi.fn((ids: readonly number[], _baseid?: string) =>
    Promise.resolve(answer<AchievementsSeenReport>({ seen: [...ids] })),
  ),
  target?: OwnYardTarget,
) => {
  const store = new YardStore({
    save: {
      error: 0,
      currenttime: T0,
      savetime: T0,
      resources: {},
      buildingdata: {},
      buildinghealthdata: {},
      storedata: {},
      onboarding: onboarding("done"),
      ...save,
    } as unknown as BaseLoadResponse,
    ...(target && { target }),
    api: { state: vi.fn(() => Promise.resolve(answer(null))) } as unknown as YardApi,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  const door = new UnlockPopupDoor({ store, overlay: { content } as YardMounts["overlay"] }, inbox, send);
  doors.push(door);
  /** Runs a yard action whose answer carries `extra`. */
  const act = (extra: Record<string, unknown>) =>
    store.run({ key: "test:1", send: () => Promise.resolve(answer(null, extra)) });
  return { store, door, send, act };
};

const names = () => [...content.querySelectorAll(".ach-card__name")].map((node) => node.textContent);
/** Lets the store's queue and the `seen` call settle. */
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
  inbox = new UnlockInbox();
  content = document.body.appendChild(document.createElement("div"));
  doors = [];
});

afterEach(() => {
  for (const door of doors) door.destroy();
  content.remove();
  vi.useRealTimers();
});

describe("guideOpen", () => {
  it("is open while the guided start is still to run or running", () => {
    expect(guideOpen({ guide: { state: "pending" } } as never)).toBe(true);
    expect(guideOpen({ guide: { state: "active" } } as never)).toBe(true);
    for (const state of ["done", "skipped", "legacy"] as const) {
      expect(guideOpen({ guide: { state } } as never)).toBe(false);
    }
    expect(guideOpen(undefined)).toBe(false);
  });
});

describe("UnlockPopupDoor", () => {
  it("shows nothing and sends nothing when no answer carries achievements (rewards off)", async () => {
    const { send, act } = setup();
    await act({});
    await settle();
    expect(content.querySelector(".ach-card")).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("shows the load's unlocks and says seen for each card", async () => {
    const { send } = setup({ achievements: [unlock(2), unlock(5)] });
    expect(names()).toEqual(["Ach 2"]);
    await settle();
    expect(send).toHaveBeenCalledWith([2]);
    vi.advanceTimersByTime(CARD_MS + GAP_MS);
    expect(names()).toEqual(["Ach 5"]);
    await settle();
    expect(send).toHaveBeenLastCalledWith([5]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("shows an action answer's unlock once, though the next answers carry it too", async () => {
    const { send, act } = setup();
    await act({ achievements: [unlock(3)] });
    expect(names()).toEqual(["Ach 3"]);
    await act({ achievements: [unlock(3)] });
    await settle();
    vi.advanceTimersByTime(CARD_MS + GAP_MS);
    expect(names()).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("holds the cards back during the guided start and shows them once it ends", async () => {
    const { send, act } = setup({ onboarding: onboarding("active"), achievements: [unlock(2)] } as never);
    await act({ achievements: [unlock(2), unlock(3)], onboarding: onboarding("active") });
    await settle();
    expect(names()).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    await act({ onboarding: onboarding("done") });
    await settle();
    expect(names()).toEqual(["Ach 2"]);
    expect(send).toHaveBeenCalledWith([2]);
  });

  it("asks seen again after the next answer when the call got none", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new NetworkError("down", null))
      .mockImplementation((ids: number[]) => Promise.resolve(answer({ seen: ids })));
    const { act } = setup({ achievements: [unlock(4)] }, send);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(inbox.toConfirm()).toEqual([4]);
    await act({});
    await settle();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith([4]);
    expect(inbox.toConfirm()).toEqual([]);
  });

  it("a yard opened later confirms what an earlier one showed and never confirmed", async () => {
    const first = setup({ achievements: [unlock(4)] }, vi.fn().mockRejectedValue(new NetworkError("down", null)));
    await settle();
    first.door.destroy();
    const { send } = setup();
    await settle();
    expect(send).toHaveBeenCalledWith([4]);
  });

  it("sends the outpost's baseid on an outpost", async () => {
    const send = vi.fn((ids: readonly number[], _baseid?: string) =>
      Promise.resolve(answer<AchievementsSeenReport>({ seen: [...ids] })),
    );
    setup({ achievements: [unlock(6)] }, send, outpostTarget("2001"));
    await settle();
    expect(send).toHaveBeenCalledWith([6], "2001");
  });

  it("shows a takeover's unlocks, queued before the yard opened", async () => {
    inbox.add([unlock(8)]);
    const { send } = setup({ achievements: [unlock(8)] });
    expect(names()).toEqual(["Ach 8"]);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("shows View only while the achievements screen has registered", () => {
    const undo = setAchievementsOpener(vi.fn());
    setup({ achievements: [unlock(1)] });
    expect(content.querySelector(".ach-card__view")).not.toBeNull();
    undo();
    vi.advanceTimersByTime(CARD_MS);
    inbox.add([unlock(2)]);
    vi.advanceTimersByTime(GAP_MS);
    expect(names()).toEqual(["Ach 2"]);
    expect(content.querySelector(".ach-card__view")).toBeNull();
  });
});
