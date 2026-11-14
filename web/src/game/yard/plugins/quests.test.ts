// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestsActions, QuestsReport, QuestsView } from "@/api/quests";
import { setQuietLogin } from "@/game/quietLogin";
import type { YardActionResult } from "@/game/yard/YardStore";
import { YardDock } from "@/ui/yard/YardDock";
import type { YardMounts } from "../yardPlugins";
import { POPUP_FIRST_DELAY_MS, POPUP_RETRY_MS, QuestsDoor, questsPlugin } from "./quests";

/** The Quests button, its red number, claims and the login pop-up (beta 6), against stand-in mounts. */

const NOW = Date.UTC(2026, 10, 2, 18, 0) / 1000;

const view = (over: Partial<QuestsView> = {}): QuestsView => ({
  now: NOW,
  nextDayAt: Date.UTC(2026, 10, 3) / 1000,
  nextWeekAt: Date.UTC(2026, 10, 9) / 1000,
  claimable: 2,
  login: { day: 1, claimedToday: false, onCard: 0, shiny: [2, 2, 3, 3, 5, 5, 10] },
  daily: {
    quests: [{ slot: 0, kind: "mushroom", need: 1, have: 1, claimed: false, ready: true, rewards: [{ kind: "resources", amounts: { r3: 400 } }] }],
    bonus: { shiny: 5, ready: false, claimed: false },
    swapsLeft: 1,
  },
  weekly: { quests: [], bonus: { shiny: 10, ready: false, claimed: false } },
  ...over,
});

const ok = (report: QuestsReport): YardActionResult<QuestsReport> => ({ ok: true, report, completed: [] });

const storeOf = (questsClaimable?: number, kind: "main" | "outpost" = "main") => {
  const listeners = new Set<() => void>();
  return {
    kind,
    save: { baseid: "1234", onboarding: { guide: { state: "done" } }, ...(questsClaimable !== undefined && { questsClaimable }) } as Record<string, unknown>,
    now: () => NOW,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    run: vi.fn(),
    notify: () => listeners.forEach((listener) => listener()),
  };
};

const mountsOf = (store: ReturnType<typeof storeOf>) => {
  const dock = new YardDock({ onBuild: vi.fn(), onMap: vi.fn() } as never);
  document.body.append(dock.element);
  const content = document.body.appendChild(document.createElement("div"));
  const modal = document.body.appendChild(document.createElement("div"));
  const notices = { show: vi.fn() };
  const mounts = {
    store,
    dock,
    overlay: { content, modal, guide: content },
    notices,
    scene: { plannerOpen: () => false },
  } as unknown as YardMounts;
  return { mounts, notices, dock };
};

const actionsOf = (state: QuestsView = view()) => {
  const claimed = view({
    claimable: 1,
    daily: { ...state.daily, quests: state.daily.quests.map((one) => ({ ...one, claimed: true, ready: false })) },
  });
  const loginClaimed = view({ claimable: 1, login: { ...state.login, claimedToday: true, onCard: 1 } });
  return {
    state: vi.fn(() => Promise.resolve(ok({ quests: state }))),
    claimLogin: vi.fn(() => Promise.resolve(ok({ quests: loginClaimed, day: 1, granted: [{ kind: "shiny", amount: 2 }] }))),
    claim: vi.fn(() =>
      Promise.resolve(ok({ quests: claimed, granted: [{ kind: "resources", amounts: { r3: 400 }, credited: { r3: 400 }, overflow: {} }] })),
    ),
    claimBonus: vi.fn(() => Promise.resolve(ok({ quests: state }))),
    swap: vi.fn(() =>
      Promise.resolve<YardActionResult<QuestsReport>>({
        ok: false,
        refusal: { reason: "noSwapsLeft", message: "No swaps left today.", detail: {}, status: 409 },
      }),
    ),
  } satisfies QuestsActions;
};

const doors: QuestsDoor[] = [];
const doorOf = (store = storeOf(), actions = actionsOf()) => {
  const parts = mountsOf(store);
  const door = new QuestsDoor(parts.mounts, actions);
  doors.push(door);
  return { door, store, actions, ...parts };
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  for (const door of doors.splice(0)) door.destroy();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("QuestsDoor", () => {
  it("puts the Quests button beside Monsters with the red number from the store", () => {
    const { door, store } = doorOf(storeOf(3));
    expect(door.button.previousElementSibling?.getAttribute("data-dock")).toBe("monsters");
    const badge = door.button.querySelector<HTMLElement>(".quests-badge")!;
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe("3");
    expect(door.button.getAttribute("aria-label")).toBe("Quests. 3 rewards to claim");
    store.save["questsClaimable"] = 0;
    store.notify();
    expect(badge.hidden).toBe(true);
  });

  it("falls back to the window's own count before any answer carries one", async () => {
    const { door } = doorOf(storeOf());
    await door.load();
    expect(door.claimable).toBe(2);
  });

  it("opens the window and claims a quest: the row flips and the count drops, with no toast (owner, 13 Nov 2026)", async () => {
    const { door, actions, notices } = doorOf();
    door.toggle();
    await flush();
    expect(document.querySelector(".quests-panel")).not.toBeNull();
    expect(door.button.getAttribute("aria-expanded")).toBe("true");
    expect(door.claimable).toBe(2);
    document.querySelector<HTMLButtonElement>(".quest__claim")!.click();
    await flush();
    expect(actions.claim).toHaveBeenCalledWith("daily", 0);
    // The 400 Putty floats on the top bar (the yard answer's resources): no "Quest claimed" toast.
    expect(notices.show).not.toHaveBeenCalled();
    expect(document.querySelector(".quest--claimed")).not.toBeNull();
    expect(door.claimable).toBe(1);
    door.toggle();
    expect(document.querySelector(".quests-panel")).toBeNull();
  });

  it("the login day and a bonus paying Shiny raise no toast either", async () => {
    const { door, actions, notices } = doorOf();
    await door.load();
    await door.claimLogin();
    expect(actions.claimLogin).toHaveBeenCalledOnce();
    await door.claimBonus("daily");
    expect(actions.claimBonus).toHaveBeenCalledWith("daily");
    expect(notices.show).not.toHaveBeenCalled();
  });

  it("a claim paying what the bar cannot show (an item, a decoration) still names it", async () => {
    const actions = actionsOf();
    actions.claim.mockImplementation(() =>
      Promise.resolve(
        ok({
          quests: view(),
          granted: [
            { kind: "resources", amounts: { r3: 400 }, credited: { r3: 400 }, overflow: {} },
            { kind: "decoration", type: 41, count: 1, stored: 1 },
          ],
        }),
      ),
    );
    const { door, notices } = doorOf(storeOf(), actions);
    await door.load();
    await door.claim("daily", 0);
    expect(notices.show).toHaveBeenCalledWith("quests", expect.any(HTMLElement), expect.objectContaining({ level: "info" }));
    const line = notices.show.mock.calls[0]![1] as HTMLElement;
    // Only the decoration: the Putty floats on the bar.
    expect(line.getAttribute("aria-label")).toMatch(/^Quest claimed, gained (?!.*Putty)/);
  });

  it("shows a refusal under the row and reads the state again", async () => {
    const { door, actions } = doorOf(storeOf(), actionsOf(view({ daily: { ...view().daily, quests: [{ ...view().daily.quests[0]!, have: 0, ready: false }] } })));
    door.toggle();
    await flush();
    document.querySelector<HTMLButtonElement>(".quest__swap")!.click();
    await flush();
    expect(actions.swap).toHaveBeenCalledWith(0);
    expect(document.querySelector(".quests-refusal")?.textContent).toBe("No swaps left today.");
    expect(actions.state.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("pops up the login card once the screen is free, once a UTC day", async () => {
    vi.useFakeTimers();
    const { door, actions } = doorOf();
    await door.load();
    vi.advanceTimersByTime(POPUP_FIRST_DELAY_MS + POPUP_RETRY_MS);
    expect(document.querySelector(".quests-login-popup")).not.toBeNull();
    expect(window.localStorage.getItem("bymr.quests.loginPopup.1234")).toBe("2026-11-02");
    // The keyboard sits on the window, not Claim: a stray Enter claims nothing (owner, 13 Nov 2026).
    const claim = document.querySelector<HTMLButtonElement>(".quests-login-popup .quests-login__claim")!;
    expect(document.activeElement).not.toBe(claim);
    expect(document.querySelector(".quests-login-popup")!.contains(document.activeElement)).toBe(true);

    claim.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(actions.claimLogin).toHaveBeenCalled();
    expect(document.querySelector(".quests-login-popup .quests-login__note")?.textContent).toMatch(/^Next day in/);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(document.querySelector(".quests-login-popup")).toBeNull();

    // A second yard load the same day: no pop-up.
    door.destroy();
    const again = doorOf();
    await again.door.load();
    vi.advanceTimersByTime(POPUP_FIRST_DELAY_MS * 3);
    expect(document.querySelector(".quests-login-popup")).toBeNull();
  });

  it("waits while another pop-up has the screen", async () => {
    vi.useFakeTimers();
    const { door } = doorOf();
    await door.load();
    const other = document.createElement("div");
    other.className = "guide-bob";
    document.body.append(other);
    vi.advanceTimersByTime(POPUP_FIRST_DELAY_MS + POPUP_RETRY_MS * 5);
    expect(document.querySelector(".quests-login-popup")).toBeNull();
    other.remove();
    vi.advanceTimersByTime(POPUP_RETRY_MS * 2);
    expect(document.querySelector(".quests-login-popup")).not.toBeNull();
  });

  it("a test server's quiet login: no pop-up and nothing remembered, but the card still opens by hand", async () => {
    vi.useFakeTimers();
    setQuietLogin(true);
    try {
      const { door } = doorOf();
      await door.load();
      vi.advanceTimersByTime(POPUP_FIRST_DELAY_MS * 3 + POPUP_RETRY_MS * 5);
      expect(document.querySelector(".quests-login-popup")).toBeNull();
      expect(window.localStorage.getItem("bymr.quests.loginPopup.1234")).toBeNull();
      door.showPopup();
      expect(document.querySelector(".quests-login-popup")).not.toBeNull();
    } finally {
      setQuietLogin(false);
    }
  });

  it("does not pop up when today's day is already claimed", async () => {
    vi.useFakeTimers();
    const claimed = view({ login: { ...view().login, claimedToday: true, onCard: 1 } });
    const { door } = doorOf(storeOf(), actionsOf(claimed));
    await door.load();
    vi.advanceTimersByTime(POPUP_FIRST_DELAY_MS * 3);
    expect(document.querySelector(".quests-login-popup")).toBeNull();
  });

  it("'All quests' on the pop-up opens the window on Today", async () => {
    const { door } = doorOf();
    await door.load();
    door.showPopup();
    document.querySelector<HTMLButtonElement>(".quests-login-popup__more")!.click();
    expect(document.querySelector(".quests-login-popup")).toBeNull();
    expect(document.querySelector<HTMLElement>(".quests-panel")?.dataset["tab"]).toBe("today");
  });
});

describe("questsPlugin", () => {
  it("mounts on the main yard only", () => {
    const outpost = mountsOf(storeOf(undefined, "outpost"));
    expect(questsPlugin(outpost.mounts)).toBeUndefined();
    expect(document.querySelector(".quests-door")).toBeNull();
  });
});
