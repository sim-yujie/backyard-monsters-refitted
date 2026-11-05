// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupportPanelOptions } from "@/ui/support/SupportPanel";
import { PLAY_MINUTES, SupportReminder, type SupportReminderDeps } from "./supportReminder";

/**
 * The rare "Support the game" reminder: only after 30 minutes of shown play,
 * only where the own yard offers a spot, never over another popup, at most
 * once a visit, and never when this device or the server says no.
 */

const MINUTE = 60_000;
const DAY = 86_400_000;

let clock: number;
let visible: boolean;
let popupOpen: boolean;
let local: { off?: boolean; shownAt?: number };
let deps: SupportReminderDeps & {
  fetchDue: ReturnType<typeof vi.fn>;
  record: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
};
const container = document.createElement("div");

beforeEach(() => {
  vi.useFakeTimers();
  clock = Date.UTC(2030, 0, 10);
  visible = true;
  popupOpen = false;
  local = {};
  deps = {
    now: () => clock,
    visible: () => visible,
    popupOpen: () => popupOpen,
    fetchDue: vi.fn(async () => true),
    record: vi.fn(async () => ({})),
    open: vi.fn(),
    load: () => local,
    save: (record) => {
      local = record;
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
});

/** Plays `minutes`, one tick a minute. */
const play = async (reminder: SupportReminder, minutes: number): Promise<void> => {
  for (let i = 0; i < minutes; i += 1) {
    clock += MINUTE;
    await reminder.tick();
  }
};

const openedWith = (): SupportPanelOptions => deps.open.mock.calls[0]?.[0] as SupportPanelOptions;

describe("SupportReminder", () => {
  it("waits for 30 minutes of play, then asks the server once and shows", async () => {
    const reminder = new SupportReminder(deps);
    reminder.offer(() => container);
    await play(reminder, PLAY_MINUTES - 1);
    expect(deps.fetchDue).not.toHaveBeenCalled();
    await play(reminder, 1);
    expect(deps.fetchDue).toHaveBeenCalledTimes(1);
    expect(deps.open).toHaveBeenCalledTimes(1);
    expect(openedWith().container).toBe(container);
    expect(deps.record).toHaveBeenCalledWith("shown");
    expect(local.shownAt).toBe(clock);
    // Once a visit, whatever comes next.
    await play(reminder, 120);
    expect(deps.open).toHaveBeenCalledTimes(1);
    reminder.stop();
  });

  it("does not count time while the tab is hidden", async () => {
    const reminder = new SupportReminder(deps);
    reminder.offer(() => container);
    visible = false;
    await play(reminder, 60);
    expect(reminder.playedMinutes).toBe(0);
    expect(deps.fetchDue).not.toHaveBeenCalled();
    reminder.stop();
  });

  it("counts a long sleep as one minute at most", async () => {
    const reminder = new SupportReminder(deps);
    reminder.offer(() => container);
    clock += 5 * 60 * MINUTE;
    await reminder.tick();
    expect(reminder.playedMinutes).toBe(1);
    reminder.stop();
  });

  it("waits while there is no spot (an attack, a visit, the guide) or another popup is open", async () => {
    const reminder = new SupportReminder(deps);
    const take = reminder.offer(() => container);
    take();
    await play(reminder, PLAY_MINUTES + 5);
    expect(deps.fetchDue).not.toHaveBeenCalled();
    let guide = true;
    reminder.offer(() => (guide ? null : container));
    await play(reminder, 1);
    expect(deps.fetchDue).not.toHaveBeenCalled();
    guide = false;
    popupOpen = true;
    await play(reminder, 1);
    expect(deps.fetchDue).not.toHaveBeenCalled();
    popupOpen = false;
    await play(reminder, 1);
    expect(deps.open).toHaveBeenCalledTimes(1);
    reminder.stop();
  });

  it("an old offer taken back does not remove a newer one", async () => {
    const reminder = new SupportReminder(deps);
    const takeOld = reminder.offer(() => container);
    reminder.offer(() => container);
    takeOld();
    await play(reminder, PLAY_MINUTES);
    expect(deps.open).toHaveBeenCalledTimes(1);
    reminder.stop();
  });

  it("shows nothing when the server says it is not due, or cannot be asked", async () => {
    deps.fetchDue.mockResolvedValueOnce(false);
    const first = new SupportReminder(deps);
    first.offer(() => container);
    await play(first, PLAY_MINUTES + 10);
    expect(deps.fetchDue).toHaveBeenCalledTimes(1);
    expect(deps.open).not.toHaveBeenCalled();

    deps.fetchDue.mockRejectedValueOnce(new Error("offline"));
    const second = new SupportReminder(deps);
    second.offer(() => container);
    await play(second, PLAY_MINUTES);
    expect(deps.open).not.toHaveBeenCalled();
  });

  it("does not ask the server when this device said never, or showed it in the last 7 days", async () => {
    local = { off: true };
    const never = new SupportReminder(deps);
    never.offer(() => container);
    await play(never, PLAY_MINUTES);
    local = { shownAt: clock - 6 * DAY };
    const recent = new SupportReminder(deps);
    recent.offer(() => container);
    await play(recent, PLAY_MINUTES);
    expect(deps.fetchDue).not.toHaveBeenCalled();
  });

  it("Don't show again is saved on the server and on this device", async () => {
    const reminder = new SupportReminder(deps);
    reminder.offer(() => container);
    await play(reminder, PLAY_MINUTES);
    openedWith().reminder?.onNever();
    expect(deps.record).toHaveBeenCalledWith("never");
    expect(local.off).toBe(true);
  });

  it("does not show if the player left the yard while the server answered", async () => {
    let here = true;
    deps.fetchDue.mockImplementationOnce(async () => {
      here = false;
      return true;
    });
    const reminder = new SupportReminder(deps);
    reminder.offer(() => (here ? container : null));
    await play(reminder, PLAY_MINUTES);
    expect(deps.fetchDue).toHaveBeenCalledTimes(1);
    expect(deps.open).not.toHaveBeenCalled();
    expect(deps.record).not.toHaveBeenCalled();
  });
});
