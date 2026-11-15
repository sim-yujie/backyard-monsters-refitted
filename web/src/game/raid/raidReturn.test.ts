// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/http";
import type { RaidResult } from "@/api/raid";
import type { AttackMounts } from "@/game/attack/attackPlugins";
import type { AttackSessionState } from "@/game/attack/AttackSession";
import { isMolochRaid } from "@/game/inferno/molochRaid";
import { LATE_RESULT_CHECK_MS, raidYardPlugin } from "@/game/yard/plugins/raid";
import type { YardMounts } from "@/game/yard/yardPlugins";
import { Notices } from "@/ui/maproom/Notices";
import { FINISH_RETRY_MS } from "./raidFinish";
import { LEAVE_LABEL, LEAVE_OFFER_MS, createRaidPlugin, finishNotice } from "./raidPlugin";
import { consumeRaidResult, resetRaidSession, type RaidRun } from "./raidSession";
import { raidWatch } from "./raidWatch";

/**
 * "Back to yard" before the raid's finish has answered, and the answer
 * coming after (patch 7.5, sol's review): the real raid screen package, the
 * real hand-over between the scenes and the real own-yard raid package, with
 * only the server and the scenes' switching stood in.
 *
 * The server lands a fight whose finish is still on its way when the yard
 * loads (`settleRaidOnYardLoad`) and answers it with the load
 * (`raidresult`); the finish that arrives later answers the same raid. The
 * player sees its result popup exactly once either way, in a yard that
 * shows what the server has.
 */

const RESULT: RaidResult = {
  id: "r_late",
  tribe: "Kozu",
  at: 1_000,
  defended: false,
  health: 0.4,
  stolen: { r1: 120, r2: 0, r3: 0, r4: 0 },
  shiny: 0,
  damaged: [3, 5],
  housedLost: 2,
};

const RUN = {
  raid: { id: "r_late", phase: "fighting", tribe: "Kozu", monsters: { C2: 3 }, attackAt: 1_000, warned: 1 },
  fight: {
    seed: 7,
    events: [{ kind: "raid", t: 0, x: 900, y: -700, r: 80, monsters: { C2: 3 } }],
    tick: 480,
    seconds: 6,
    yard: { buildingdata: {}, buildinghealthdata: {}, resources: {} },
    defence: null,
  },
  save: {},
} as unknown as RaidRun;

const refusal = (reason: string, extra: Record<string, number> = {}): ApiError =>
  new ApiError("refused", { status: 409, details: { data: { reason, ...extra } } });

/** The raid scene on the fight, its finish answered by `finish`; leaving it tears it down, as the scene switch does. */
const raidScreen = (finish: () => Promise<unknown>) => {
  // As the yard handed the fight over: the watch holds it, fighting, until the finish answers.
  raidWatch.set(RUN.raid);
  let phase: AttackSessionState["phase"] = "running";
  const listeners = new Set<(state: AttackSessionState) => void>();
  const state = () => ({ phase, tick: 0 }) as AttackSessionState;
  const session = {
    playScript: vi.fn(),
    state,
    subscribe: (listener: (state: AttackSessionState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const notices = new Notices();
  let teardown: (() => void) | void = undefined;
  const goToYard = vi.fn(() => {
    if (typeof teardown === "function") teardown();
  });
  const mounts = {
    session,
    hudSlot: document.createElement("span"),
    goToYard,
    notices,
    renderer: { setAnimFrame: vi.fn(), yardToWorld: vi.fn() },
    raid: RUN,
  } as unknown as AttackMounts;
  const api = { finish: vi.fn(finish) };
  teardown = createRaidPlugin({
    api: api as never,
    serverNow: () => 1_000,
    clearRaid: () => raidWatch.set(null),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  })(mounts);
  return {
    api,
    goToYard,
    /** The fight plays out on screen. */
    end: () => {
      phase = "ended";
      for (const listener of listeners) listener(state());
    },
    backButton: () => [...notices.element.querySelectorAll("button")].find((one) => one.textContent === LEAVE_LABEL),
  };
};

/**
 * The own main yard as the scene opens it on a load; its `reload` opens it
 * afresh on a new load, which has nothing more to land.
 */
const yard = () => {
  const modals: HTMLElement[] = [];
  const shown: string[] = [];
  const reloads = vi.fn();
  let planner = false;
  let carrying = false;
  let teardown: (() => void) | void = undefined;
  /** The last raid the server's yard has landed, as a load from now on says it (`lastraid`); unsaid when undefined. */
  let serverLast: string | undefined;
  const open = (load: { raidresult?: RaidResult; lastraid?: string } = {}): void => {
    if (typeof teardown === "function") teardown();
    const modal = document.createElement("div");
    const content = document.createElement("div");
    document.body.append(modal, content);
    modals.push(modal);
    const scene = {
      openMap: vi.fn(),
      openRaid: vi.fn(),
      plannerOpen: () => planner,
      carrying: () => carrying,
      reload: () => {
        reloads();
        open(serverLast === undefined ? {} : { lastraid: serverLast });
      },
    };
    const store = { kind: "main", save: { buildingdata: {}, ...load }, credits: 0, now: () => 0 };
    const notices = { show: vi.fn((_id: string, message: string) => void shown.push(message)) };
    teardown = raidYardPlugin({ store, overlay: { modal, content }, notices, scene } as unknown as YardMounts);
  };
  return {
    open,
    reloads,
    shown,
    /** Whether the open yard shows the raid's lock ("is raiding your yard"). */
    locked: () => modals.at(-1)!.querySelector(".raid-lock") !== null,
    /** Result popups on the yard open now. */
    popupsInLast: () => modals.at(-1)!.querySelectorAll(".raid-result").length,
    /** Result popups shown so far, in every yard opened. */
    popups: () => modals.reduce((sum, modal) => sum + modal.querySelectorAll(".raid-result").length, 0),
    setPlanner: (open: boolean) => (planner = open),
    setServerLast: (id: string) => (serverLast = id),
    setCarrying: (held: boolean) => (carrying = held),
    close: () => {
      if (typeof teardown === "function") teardown();
    },
  };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  resetRaidSession();
  raidWatch.set(null);
  document.body.replaceChildren();
});

describe("Back to yard before the finish answers (patch 7.5)", () => {
  it("the load landed the raid: its popup shows once in the yard, and the finish's late answer adds nothing", async () => {
    let answer: (value: unknown) => void = () => {};
    const screen = raidScreen(() => new Promise((resolve) => (answer = resolve)));
    const home = yard();
    screen.end();
    await vi.advanceTimersByTimeAsync(LEAVE_OFFER_MS);
    screen.backButton()!.click();
    expect(screen.goToYard).toHaveBeenCalledTimes(1);

    // The yard's load reached the server first: it landed the fight and answers it.
    home.open({ raidresult: RESULT });
    expect(home.popups()).toBe(1);
    // The fight is over: no lock on the yard while the finish is still out.
    expect(home.locked()).toBe(false);

    // Then the finish's answer: the same raid.
    answer({ error: 0, result: RESULT });
    await vi.advanceTimersByTimeAsync(LATE_RESULT_CHECK_MS * 3);
    expect(home.popups()).toBe(1);
    expect(home.reloads).not.toHaveBeenCalled();
    expect(screen.goToYard).toHaveBeenCalledTimes(1);
    home.close();
  });

  it("the finish landed it but answered late: the answer opens the yard afresh, which shows the popup once", async () => {
    let answer: (value: unknown) => void = () => {};
    const screen = raidScreen(() => new Promise((resolve) => (answer = resolve)));
    const home = yard();
    screen.end();
    await vi.advanceTimersByTimeAsync(LEAVE_OFFER_MS);
    screen.backButton()!.click();

    // The yard's load found the raid landed already: nothing to answer, and
    // the watch still has the fight until the finish says otherwise.
    home.open();
    expect(home.popups()).toBe(0);
    expect(home.locked()).toBe(true);

    answer({ error: 0, result: RESULT });
    await vi.advanceTimersByTimeAsync(0);
    // The yard as the server has it now (the raid's damage in it), and the popup on it.
    expect(home.reloads).toHaveBeenCalledTimes(1);
    expect(home.popups()).toBe(1);
    expect(home.locked()).toBe(false);

    await vi.advanceTimersByTimeAsync(LATE_RESULT_CHECK_MS * 5);
    expect(home.reloads).toHaveBeenCalledTimes(1);
    expect(home.popups()).toBe(1);
    expect(consumeRaidResult()).toBeNull();
    home.close();
  });

  it("the finish answered while the yard was loading: the yard read before the landing opens afresh, and the new one shows the popup once", async () => {
    let answer: (value: unknown) => void = () => {};
    const screen = raidScreen(() => new Promise((resolve) => (answer = resolve)));
    const home = yard();
    screen.end();
    await vi.advanceTimersByTimeAsync(LEAVE_OFFER_MS);
    screen.backButton()!.click();

    // The yard's load read the yard before the finish landed (its lastraid is
    // an older raid); the finish's answer comes before that yard is up.
    answer({ error: 0, result: RESULT });
    await vi.advanceTimersByTimeAsync(0);
    home.setServerLast(RESULT.id);
    home.open({ lastraid: "r_older" });
    expect(home.popups()).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(home.reloads).toHaveBeenCalledTimes(1);
    expect(home.popups()).toBe(1);
    // The popup is on the yard opened afresh, not on the stale one.
    expect(home.popupsInLast()).toBe(1);

    await vi.advanceTimersByTimeAsync(LATE_RESULT_CHECK_MS * 5);
    expect(home.reloads).toHaveBeenCalledTimes(1);
    expect(home.popups()).toBe(1);
    home.close();
  });

  it("the finish answered before the yard's load read the yard: shown at once, no second load", async () => {
    const screen = raidScreen(async () => ({ error: 0, result: RESULT }));
    const home = yard();
    screen.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.goToYard).toHaveBeenCalledTimes(1);
    home.open({ lastraid: RESULT.id });
    expect(home.popups()).toBe(1);
    await vi.advanceTimersByTimeAsync(LATE_RESULT_CHECK_MS * 3);
    expect(home.reloads).not.toHaveBeenCalled();
    home.close();
  });

  it("opens the yard afresh once at most for a result, even if the new yard still does not say it has it", async () => {
    const screen = raidScreen(async () => ({ error: 0, result: RESULT }));
    const home = yard();
    screen.end();
    await vi.advanceTimersByTimeAsync(0);
    home.setServerLast("r_older");
    home.open({ lastraid: "r_older" });
    await vi.advanceTimersByTimeAsync(0);
    expect(home.reloads).toHaveBeenCalledTimes(1);
    expect(home.popups()).toBe(1);
    await vi.advanceTimersByTimeAsync(LATE_RESULT_CHECK_MS * 3);
    expect(home.reloads).toHaveBeenCalledTimes(1);
    home.close();
  });

  it("a late answer waits for the Planner to close and the building in hand to go down", async () => {
    let answer: (value: unknown) => void = () => {};
    const screen = raidScreen(() => new Promise((resolve) => (answer = resolve)));
    const home = yard();
    screen.end();
    await vi.advanceTimersByTimeAsync(LEAVE_OFFER_MS);
    screen.backButton()!.click();
    home.open();
    home.setPlanner(true);

    answer({ error: 0, result: RESULT });
    await vi.advanceTimersByTimeAsync(LATE_RESULT_CHECK_MS * 3);
    expect(home.reloads).not.toHaveBeenCalled();

    home.setPlanner(false);
    home.setCarrying(true);
    await vi.advanceTimersByTimeAsync(LATE_RESULT_CHECK_MS * 3);
    expect(home.reloads).not.toHaveBeenCalled();
    expect(home.popups()).toBe(0);

    home.setCarrying(false);
    await vi.advanceTimersByTimeAsync(LATE_RESULT_CHECK_MS);
    expect(home.reloads).toHaveBeenCalledTimes(1);
    expect(home.popups()).toBe(1);
    home.close();
  });

  it("no 'could not reach the server' line after the load delivered that raid", async () => {
    // Every try fails, slowly: the player goes back before the last one gives up.
    const screen = raidScreen(
      () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error("offline")), LEAVE_OFFER_MS * 2)),
    );
    const home = yard();
    screen.end();
    await vi.advanceTimersByTimeAsync(LEAVE_OFFER_MS);
    screen.backButton()!.click();
    home.open({ raidresult: RESULT });
    expect(home.popups()).toBe(1);

    await vi.advanceTimersByTimeAsync((LEAVE_OFFER_MS * 2 + FINISH_RETRY_MS) * 3);
    expect(screen.api.finish).toHaveBeenCalledTimes(3);
    const failed = finishNotice({ kind: "failed" })!;
    expect(home.shown).not.toContain(failed);
    expect(home.popups()).toBe(1);
    expect(home.reloads).not.toHaveBeenCalled();
    home.close();
  });

  it("but a line for a raid that did not land still shows in the open yard", async () => {
    let refuse: (reason: unknown) => void = () => {};
    const screen = raidScreen(() => new Promise((_resolve, reject) => (refuse = reject)));
    const home = yard();
    screen.end();
    await vi.advanceTimersByTimeAsync(LEAVE_OFFER_MS);
    screen.backButton()!.click();
    home.open();

    refuse(refusal("cancelled"));
    await vi.advanceTimersByTimeAsync(0);
    expect(home.shown).toContain(finishNotice({ kind: "cancelled" }, "Kozu"));
    expect(home.reloads).not.toHaveBeenCalled();
    home.close();
  });

  it("Moloch's late result opens the yard afresh and is left for the Inferno's own popup", async () => {
    let answer: (value: unknown) => void = () => {};
    const screen = raidScreen(() => new Promise((resolve) => (answer = resolve)));
    const home = yard();
    screen.end();
    await vi.advanceTimersByTimeAsync(LEAVE_OFFER_MS);
    screen.backButton()!.click();
    home.open();

    answer({ error: 0, result: { ...RESULT, tribe: "moloch" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(home.reloads).toHaveBeenCalledTimes(1);
    expect(home.popups()).toBe(0);
    expect(consumeRaidResult(isMolochRaid)?.id).toBe(RESULT.id);
    home.close();
  });

  it("no way back is offered while the server says it is too early: a yard load then would call the fight off", async () => {
    let calls = 0;
    const screen = raidScreen(() => {
      calls += 1;
      // The server will take it in 9 s; the next try then hangs.
      return calls === 1 ? Promise.reject(refusal("tooEarly", { readyAt: 1_009 })) : new Promise(() => {});
    });
    screen.end();
    await vi.advanceTimersByTimeAsync(LEAVE_OFFER_MS);
    expect(screen.backButton()).toBeUndefined();

    // The wait is over at 9.25 s and the finish goes again; the way back comes the usual time after that.
    await vi.advanceTimersByTimeAsync(9_250 - LEAVE_OFFER_MS);
    expect(screen.api.finish).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(LEAVE_OFFER_MS - 1);
    expect(screen.backButton()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(screen.backButton()).toBeDefined();
  });
});
