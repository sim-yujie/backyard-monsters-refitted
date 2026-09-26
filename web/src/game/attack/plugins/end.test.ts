// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/api/http";
import type { AttackSavePayload, BaseLoadResponse, BaseSaveResponse } from "@/api/types";
import { AttackSession } from "@/game/attack/AttackSession";
import type { AttackMounts } from "@/game/attack/attackPlugins";
import type { AttackTarget } from "@/game/attack/attackTarget";
import { Notices } from "@/ui/maproom/Notices";
import {
  SESSION_WINDOW_SECONDS,
  WINDOW_MARGIN_SECONDS,
  createEndPlugin,
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
const mountsFor = (session: AttackSession, modal: HTMLElement, notices: Notices, goToMap: () => void) =>
  ({ session, target: session.target, modal, notices, goToMap }) as unknown as AttackMounts;

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

  const mount = (save: (payload: AttackSavePayload) => Promise<BaseSaveResponse>) => {
    teardown = createEndPlugin({ save, now: () => clock })(mountsFor(session, modal, notices, goToMap));
  };

  it("sends the save once when the attack ends, shows the panel, then lets the player return", async () => {
    const save = vi.fn(
      async (_payload: AttackSavePayload): Promise<BaseSaveResponse> =>
        ({ error: 0, basesaveid: 1, protected: 0 }) as BaseSaveResponse,
    );
    mount(save);
    expect(modal.querySelector(".attack-end")).toBeNull();
    expect(save).not.toHaveBeenCalled();

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

  it("tears down the panel and the timer", () => {
    mount(async () => ({ error: 0, basesaveid: 1 }) as BaseSaveResponse);
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
