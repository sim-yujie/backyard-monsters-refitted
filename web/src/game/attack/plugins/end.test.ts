// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError, setAuthToken } from "@/api/http";
import type { AttackSavePayload, BaseLoadResponse, BaseSaveResponse } from "@/api/types";
import { AttackPresentation } from "@/game/attack/attackPresentation";
import { AttackSession } from "@/game/attack/AttackSession";
import type { AttackMounts } from "@/game/attack/attackPlugins";
import type { AttackTarget } from "@/game/attack/attackTarget";
import { Notices } from "@/ui/maproom/Notices";
import {
  END_PANEL_MAX_WAIT_MS,
  SESSION_WINDOW_SECONDS,
  WINDOW_MARGIN_SECONDS,
  createEndPlugin,
  creditedOf,
  describeSaveFailure,
} from "./end";

/**
 * The end plugin's promises (`docs/design/attack-flow.md` §F6, §F7, §4.7,
 * §7 Q2): one save per attack, the panel through saving → saved or failed,
 * Retry after a failure and never after a success, and the window warning
 * on the wall clock.
 */

const towerYard = (): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "3502",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: { "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } },
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 0, r3: 0, r4: 0 },
    attackid: 77,
  }) as unknown as BaseLoadResponse;

const targetOf = (): AttackTarget => ({
  baseid: "3502",
  kind: "wild",
  cell: { col: 241, row: 208 },
  name: "Kozu",
  roster: { monsters: { C1: 3 }, levels: {}, champions: [], flingerLevel: 4, catapultLevel: 0 },
  load: towerYard(),
});

/** Only what the end plugin reads; the rest of the mounts is never touched. */
const mountsFor = (
  session: AttackSession,
  modal: HTMLElement,
  notices: Notices,
  goToMap: () => void,
  presentation = new AttackPresentation(),
) => ({ session, target: session.target, modal, notices, goToMap, presentation }) as unknown as AttackMounts;

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("the end plugin", () => {
  let clock = 0;
  let modal: HTMLElement;
  let notices: Notices;
  let goToMap: ReturnType<typeof vi.fn>;
  let session: AttackSession;
  let teardown: (() => void) | void;

  beforeEach(() => {
    vi.useFakeTimers();
    clock = 1_000_000;
    modal = document.createElement("div");
    document.body.append(modal);
    notices = new Notices().mount(document.body);
    goToMap = vi.fn();
    session = new AttackSession({ target: targetOf(), seed: 1 });
    session.start();
  });

  afterEach(() => {
    teardown?.();
    notices.destroy();
    modal.remove();
    vi.useRealTimers();
  });

  const savedOk = async (_payload?: AttackSavePayload, _token?: string | null): Promise<BaseSaveResponse> => ({ error: 0, basesaveid: 1 }) as BaseSaveResponse;

  const mount = (
    save: (payload: AttackSavePayload) => Promise<BaseSaveResponse>,
    saveOnLeave: (payload: AttackSavePayload, token: string | null) => Promise<BaseSaveResponse> = vi.fn(savedOk),
    presentation = new AttackPresentation(),
  ) => {
    teardown = createEndPlugin({ save, saveOnLeave, now: () => clock })(
      mountsFor(session, modal, notices, goToMap, presentation),
    );
  };

  /** The player's first action: a one-Pokey drop, so the end is worth saving (#79). */
  const act = (): void => {
    session.appendFling({ x: -100, y: -100, monsters: { C1: 1 } });
  };

  it("does not save an attack the player never touched, and lets them return at once (#79)", () => {
    const save = vi.fn(
      async (_payload: AttackSavePayload): Promise<BaseSaveResponse> =>
        ({ error: 0, basesaveid: 1 }) as BaseSaveResponse,
    );
    mount(save);
    session.retreat();
    expect(save).not.toHaveBeenCalled();
    const status = modal.querySelector(".attack-end__status")!;
    expect(status.textContent).toBe("Nothing was sent, so there was nothing to save.");
    expect(status.classList.contains("attack-end__status--unsent")).toBe(true);
    expect(modal.querySelector<HTMLElement>(".attack-end__retry")!.hidden).toBe(true);
    expect(modal.querySelector<HTMLElement>(".attack-end__leave")!.hidden).toBe(true);
    const back = modal.querySelector<HTMLButtonElement>(".attack-end__return")!;
    expect(back.disabled).toBe(false);
    back.click();
    expect(goToMap).toHaveBeenCalledTimes(1);
    teardown?.();
    teardown = undefined;
    expect(modal.children).toHaveLength(0);
  });

  it("shows the loot the server says it banked (#166)", async () => {
    const save = vi.fn(
      async (_payload: AttackSavePayload): Promise<BaseSaveResponse> =>
        ({ error: 0, basesaveid: 1, lootcredited: { r1: 7, r2: 0, r3: 0, r4: 0 } }) as BaseSaveResponse,
    );
    act();
    mount(save);
    session.retreat();
    await flush();
    const items = [...modal.querySelectorAll<HTMLElement>(".attack-end__loot-item")];
    expect(items.map((item) => item.textContent)).toEqual(["7", "0", "0", "0"]);
  });

  it("saves as before once the player has dropped something (#79)", () => {
    const save = vi.fn(
      async (_payload: AttackSavePayload): Promise<BaseSaveResponse> =>
        ({ error: 0, basesaveid: 1 }) as BaseSaveResponse,
    );
    mount(save);
    act();
    session.retreat();
    expect(save).toHaveBeenCalledTimes(1);
    expect(modal.querySelector(".attack-end__status")!.textContent).toBe("Saving the result…");
  });

  it("sends the save once when the attack ends, shows the panel, then lets the player return", async () => {
    const save = vi.fn(
      async (_payload: AttackSavePayload): Promise<BaseSaveResponse> =>
        ({ error: 0, basesaveid: 1, protected: 0 }) as BaseSaveResponse,
    );
    mount(save);
    expect(modal.querySelector(".attack-end")).toBeNull();
    expect(save).not.toHaveBeenCalled();

    act();
    session.retreat();
    expect(save).toHaveBeenCalledTimes(1);
    const payload = save.mock.calls[0]![0]!;
    expect(payload).toMatchObject({ baseid: "3502", basesaveid: 1, attackid: 77, over: true });
    expect(payload.flinglog).toEqual(session.flingLog());
    expect(modal.querySelector(".attack-end__status")!.textContent).toBe("Saving the result…");

    await flush();
    expect(modal.querySelector(".attack-end__status")!.textContent).toBe("Result saved.");
    const back = modal.querySelector<HTMLButtonElement>(".attack-end__return")!;
    expect(back.disabled).toBe(false);
    back.click();
    expect(goToMap).toHaveBeenCalledTimes(1);

    // More session notifications after the end do not send again.
    session.setSpeed(2);
    session.setUnusedTools(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("saves at once but holds the panel while a bomb is still falling (#148)", async () => {
    const save = vi.fn(savedOk);
    const presentation = new AttackPresentation();
    let falling = true;
    presentation.hold(() => falling);
    mount(save, undefined, presentation);
    act();
    session.retreat();
    // The save does not wait for the screen.
    expect(save).toHaveBeenCalledTimes(1);
    expect(modal.querySelector(".attack-end")).toBeNull();
    await flush();
    vi.advanceTimersByTime(500);
    expect(modal.querySelector(".attack-end")).toBeNull();
    // The rain is down: the panel opens on the save as it stands.
    falling = false;
    vi.advanceTimersByTime(100);
    expect(modal.querySelector(".attack-end")).not.toBeNull();
    expect(modal.querySelector(".attack-end__status")!.textContent).toBe("Result saved.");
  });

  it("opens the panel after the longest wait even if the screen never settles (#148)", () => {
    const presentation = new AttackPresentation();
    presentation.hold(() => true);
    mount(vi.fn(savedOk), undefined, presentation);
    act();
    session.retreat();
    expect(modal.querySelector(".attack-end")).toBeNull();
    clock += END_PANEL_MAX_WAIT_MS;
    vi.advanceTimersByTime(100);
    expect(modal.querySelector(".attack-end")).not.toBeNull();
    expect(modal.querySelector(".attack-end__status")!.textContent).toBe("Saving the result…");
  });

  it("never opens a held panel after the scene has gone (#148)", () => {
    const presentation = new AttackPresentation();
    presentation.hold(() => true);
    mount(vi.fn(savedOk), undefined, presentation);
    act();
    session.retreat();
    teardown?.();
    teardown = undefined;
    clock += END_PANEL_MAX_WAIT_MS;
    vi.advanceTimersByTime(END_PANEL_MAX_WAIT_MS);
    expect(modal.querySelector(".attack-end")).toBeNull();
  });

  it("names monsters in the attack report from the army panel's table", () => {
    const save = vi.fn(
      async (_payload: AttackSavePayload): Promise<BaseSaveResponse> =>
        ({ error: 0, basesaveid: 1 }) as BaseSaveResponse,
    );
    mount(save);
    session.appendFling({ x: -100, y: -100, monsters: { C1: 2 } });
    session.retreat();
    const payload = save.mock.calls[0]![0]!;
    expect(payload.attackreport).toContain("Flung 2 Pokey at (-100, -100)");
  });

  it("shows the defender's new protection when the save's envelope carries one", async () => {
    mount(async () => ({ error: 0, basesaveid: 1, protected: clock / 1000 + 8 * 3600 }) as BaseSaveResponse);
    act();
    session.retreat();
    await flush();
    const protection = modal.querySelector<HTMLElement>(".attack-end__protection")!;
    expect(protection.hidden).toBe(false);
    expect(protection.textContent).toBe("Kozu is now under damage protection for 8 h.");
  });

  it("on a failure shows the error with Retry, retries once asked, and never sends twice in flight", async () => {
    const first = deferred<BaseSaveResponse>();
    const second = deferred<BaseSaveResponse>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    mount(save);
    act();
    session.retreat();
    expect(save).toHaveBeenCalledTimes(1);

    first.reject(new NetworkError("offline", null));
    await flush();
    const status = modal.querySelector(".attack-end__status")!;
    expect(status.textContent).toBe("Could not reach the server to save the result.");
    const retry = modal.querySelector<HTMLButtonElement>(".attack-end__retry")!;
    expect(retry.hidden).toBe(false);

    retry.click();
    expect(save).toHaveBeenCalledTimes(2);
    expect(status.textContent).toBe("Saving the result…");
    // A second click while the retry is still in flight does not send a third.
    retry.click();
    expect(save).toHaveBeenCalledTimes(2);

    second.resolve({ error: 0, basesaveid: 1 } as BaseSaveResponse);
    await flush();
    expect(status.textContent).toBe("Result saved.");
    retry.click();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("treats an expired attack as final: the §4.7 notice, no Retry, a confirmed way out", async () => {
    const error = new ApiError("This attack is no longer yours to save. Reload your yard.", {
      status: 200,
      serverStatus: 403,
      code: "This attack is no longer yours to save. Reload your yard.",
      details: { status: 403, data: { reason: "expired" } },
    });
    mount(async () => {
      throw error;
    });
    act();
    session.retreat();
    await flush();
    expect(modal.querySelector(".attack-end__status")!.textContent).toMatch(/expired before it could be saved/);
    expect(modal.querySelector<HTMLElement>(".attack-end__retry")!.hidden).toBe(true);
    const leave = modal.querySelector<HTMLButtonElement>(".attack-end__leave")!;
    expect(leave.hidden).toBe(false);
    leave.click();
    expect(goToMap).not.toHaveBeenCalled();
    modal.querySelector<HTMLButtonElement>(".attack-end__leave-yes")!.click();
    expect(goToMap).toHaveBeenCalledTimes(1);
  });

  it("warns once on the wall clock a margin before the server's save window closes", () => {
    mount(async () => ({ error: 0, basesaveid: 1 }) as BaseSaveResponse);
    const shown = () => notices.element.textContent ?? "";
    clock += (SESSION_WINDOW_SECONDS - WINDOW_MARGIN_SECONDS - 1) * 1000;
    vi.advanceTimersByTime(1000);
    expect(shown()).toBe("");

    clock += 1000;
    vi.advanceTimersByTime(1000);
    expect(shown()).toContain("stops accepting this attack's result in about 30 s");

    // Said once; and it goes away when the attack ends.
    notices.clear("attack-window");
    clock += 5000;
    vi.advanceTimersByTime(1000);
    expect(shown()).toBe("");
  });

  it("does not warn after the attack is over, and clears the warning on the end", () => {
    mount(async () => ({ error: 0, basesaveid: 1 }) as BaseSaveResponse);
    clock += SESSION_WINDOW_SECONDS * 1000;
    vi.advanceTimersByTime(1000);
    expect(notices.element.textContent).toContain("stops accepting");
    session.retreat();
    expect(notices.element.textContent).toBe("");
  });

  describe("leaving the attack screen (#138)", () => {
    const hide = (): void => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    };

    afterEach(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      setAuthToken(null);
    });

    it("a reload or closed tab ends the battle there and sends its save once, as a keepalive", () => {
      const save = vi.fn(savedOk);
      const onLeave = vi.fn(savedOk);
      mount(save, onLeave);
      act();
      window.dispatchEvent(new Event("pagehide"));

      expect(session.state()).toMatchObject({ phase: "ended", endReason: "left" });
      expect(save).not.toHaveBeenCalled();
      expect(onLeave).toHaveBeenCalledTimes(1);
      const payload = onLeave.mock.calls[0]![0]!;
      expect(payload).toMatchObject({ basesaveid: 1, attackid: 77, over: true });
      expect(payload.flinglog).toEqual(session.flingLog());
      expect(payload.attackreport).toContain("Left the attack");
      expect(modal.textContent).toContain("You left the attack");

      // A second pagehide, the hidden state and the teardown that follow: still once.
      window.dispatchEvent(new Event("pagehide"));
      hide();
      teardown?.();
      teardown = undefined;
      expect(onLeave).toHaveBeenCalledTimes(1);
      expect(save).not.toHaveBeenCalled();
    });

    it("a hidden tab does not end the attack; pagehide still does", async () => {
      const save = vi.fn(savedOk);
      const onLeave = vi.fn(savedOk);
      mount(save, onLeave);
      act();
      hide();
      expect(session.state().phase).toBe("running");
      expect(onLeave).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(modal.children).toHaveLength(0);

      // Back to the tab, the battle carries on; then the tab is closed.
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      session.advance(1);
      expect(session.state().phase).toBe("running");
      hide();
      window.dispatchEvent(new Event("pagehide"));
      expect(session.state().endReason).toBe("left");
      expect(onLeave).toHaveBeenCalledTimes(1);
      await flush();
      expect(modal.querySelector(".attack-end__status")!.textContent).toBe("Result saved.");
    });

    it("an attack with nothing dropped sends nothing and keeps running (#79)", () => {
      const save = vi.fn(savedOk);
      const onLeave = vi.fn(savedOk);
      mount(save, onLeave);
      window.dispatchEvent(new Event("pagehide"));
      hide();
      teardown?.();
      teardown = undefined;
      expect(onLeave).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(session.state().phase).toBe("running");
    });

    it("in-app navigation away ends it too, with the token from before a sign-out", () => {
      setAuthToken("before-sign-out");
      const onLeave = vi.fn(savedOk);
      mount(vi.fn(savedOk), onLeave);
      act();
      setAuthToken(null);
      teardown?.();
      teardown = undefined;
      expect(onLeave).toHaveBeenCalledTimes(1);
      expect(onLeave.mock.calls[0]![1]).toBe("before-sign-out");
    });

    it("a save still on its way as the page goes is sent again as a keepalive, once", async () => {
      const pending = deferred<BaseSaveResponse>();
      const save = vi.fn((_payload: AttackSavePayload) => pending.promise);
      const onLeave = vi.fn(savedOk);
      mount(save, onLeave);
      act();
      session.retreat();
      expect(save).toHaveBeenCalledTimes(1);

      window.dispatchEvent(new Event("pagehide"));
      window.dispatchEvent(new Event("pagehide"));
      expect(onLeave).toHaveBeenCalledTimes(1);
      expect(onLeave.mock.calls[0]![0]).toEqual(save.mock.calls[0]![0]);

      // The keepalive copy landed; the ordinary one is then refused as a duplicate.
      await flush();
      pending.reject(new ApiError("no", { status: 200, details: { data: { reason: "finalising" } } }));
      await flush();
      expect(modal.querySelector(".attack-end__status")!.textContent).toBe("Result saved.");
    });

    it("an in-app exit leaves a save already on its way to finish on its own", () => {
      const onLeave = vi.fn(savedOk);
      mount(() => deferred<BaseSaveResponse>().promise, onLeave);
      act();
      session.retreat();
      teardown?.();
      teardown = undefined;
      expect(onLeave).not.toHaveBeenCalled();
    });

    it("stops listening once torn down", () => {
      const onLeave = vi.fn(savedOk);
      mount(vi.fn(savedOk), onLeave);
      teardown?.();
      teardown = undefined;
      act();
      window.dispatchEvent(new Event("pagehide"));
      expect(onLeave).not.toHaveBeenCalled();
    });
  });

  it("tears down the panel and the timer", () => {
    mount(async () => ({ error: 0, basesaveid: 1 }) as BaseSaveResponse);
    act();
    session.retreat();
    expect(modal.children).toHaveLength(1);
    teardown?.();
    teardown = undefined;
    expect(modal.children).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("describeSaveFailure", () => {
  it("names the reason and says whether a retry could help", () => {
    expect(describeSaveFailure(new NetworkError("x", null))).toEqual({
      message: "Could not reach the server to save the result.",
      canRetry: true,
    });
    const refused = (reason: string) =>
      new ApiError("no", { status: 200, details: { data: { reason } } });
    expect(describeSaveFailure(refused("expired")).canRetry).toBe(false);
    expect(describeSaveFailure(refused("bombSpend")).canRetry).toBe(false);
    expect(describeSaveFailure(refused("finalising")).canRetry).toBe(false);
    expect(describeSaveFailure(refused("wrong-attacker"))).toEqual({
      message: "The server refused the result: no",
      canRetry: false,
    });
    expect(describeSaveFailure(new ApiError("boom", { status: 500 }))).toEqual({
      message: "The result was not saved: boom",
      canRetry: true,
    });
    expect(describeSaveFailure("?")).toEqual({ message: "The result was not saved.", canRetry: true });
  });
});

describe("creditedOf", () => {
  it("reads the banked loot off the save response, or null when it is not there", () => {
    const response = (extra: object) => ({ error: 0, basesaveid: 1, ...extra }) as BaseSaveResponse;
    expect(creditedOf(response({ lootcredited: { r1: 5, r2: "3", r3: -1 } }))).toEqual({
      r1: 5,
      r2: 3,
      r3: 0,
      r4: 0,
    });
    expect(creditedOf(response({}))).toBeNull();
  });
});
