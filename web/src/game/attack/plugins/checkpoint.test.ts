// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/http";
import type { BaseLoadResponse } from "@/api/types";
import { AttackSession, DropsHeldError } from "@/game/attack/AttackSession";
import type { AttackMounts } from "@/game/attack/attackPlugins";
import { checkpointOf, type AttackCheckpoint } from "@/game/attack/attackCheckpoint";
import type { AttackTarget } from "@/game/attack/attackTarget";
import { Notices } from "@/ui/maproom/Notices";
import {
  CHECKPOINT_INTERVAL_MS,
  DROP_HOLD_AFTER_MS,
  REQUEST_TIMEOUT_MS,
  RETRY_MS,
  createCheckpointPlugin,
} from "./checkpoint";

/**
 * The attack's running record on the server (issue #138): sent on every drop
 * and every few seconds after, one at a time, never before the first drop and
 * never after the end.
 */

const load = (): BaseLoadResponse =>
  ({
    error: 0,
    baseid: "3502",
    basesaveid: 11,
    buildingdata: { "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } },
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 0, r3: 0, r4: 0 },
    attackid: 77,
  }) as unknown as BaseLoadResponse;

const target = (): AttackTarget => ({
  baseid: "3502",
  kind: "wild",
  cell: { col: 241, row: 208 },
  name: "Kozu",
  roster: {
    monsters: { C1: 5 },
    levels: {},
    champions: [],
    flingerLevel: 4,
    catapultLevel: 0,
    siege: null,
    resources: null,
    sources: [
      { baseid: "1000239208", m: { housed: { C1: 3 } } },
      { baseid: "1000240208", m: { housed: { C1: 2 } } },
    ],
  },
  load: load(),
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe("checkpointOf", () => {
  it("is nothing until something is dropped (#79)", () => {
    const session = new AttackSession({ target: target(), seed: 3 });
    session.start();
    expect(checkpointOf(session)).toBeNull();
  });

  it("carries the ids, the clock, the log and the source cells in order", () => {
    const session = new AttackSession({ target: target(), seed: 3 });
    session.start();
    session.advance(0.5);
    session.appendFling({ x: -200, y: -200, monsters: { C1: 2 } });
    expect(checkpointOf(session)).toEqual({
      basesaveid: 11,
      attackid: 77,
      tick: 40,
      flinglog: session.flingLog(),
      sources: ["1000239208", "1000240208"],
    });
  });

  const rowless = (extra: Partial<AttackTarget>): AttackTarget => {
    const rowlessLoad = { ...load(), baseid: "11" } as Record<string, unknown>;
    delete rowlessLoad["basesaveid"];
    return {
      ...target(),
      baseid: "11",
      load: rowlessLoad as unknown as BaseLoadResponse,
      ...extra,
    };
  };

  it("names a yard with no row by its base id: a Map Room 1 tribe, a Descent yard, a Moloch tribe", () => {
    for (const extra of [
      { mapversion: 1 },
      { descentYard: 3 },
      { infernoTribe: true },
    ] as const) {
      const session = new AttackSession({ target: rowless(extra), seed: 3 });
      session.start();
      session.appendFling({ x: -200, y: -200, monsters: { C1: 2 } });
      expect(checkpointOf(session)).toMatchObject({
        basesaveid: 0,
        baseid: "11",
        attackid: 77,
      });
    }
  });

  it("is never taken for any other attack with no row (a practice attack, a raid)", () => {
    const session = new AttackSession({ target: rowless({ mapversion: 2 }), seed: 3 });
    session.start();
    session.appendFling({ x: -200, y: -200, monsters: { C1: 2 } });
    expect(checkpointOf(session)).toBeNull();
  });

  it("is taken for a Map Room 1 player, whose yard is a row like any other", () => {
    const { cell: _cell, ...rest } = target();
    const player: AttackTarget = {
      ...rest,
      kind: "main",
      mapversion: 1,
      roster: { ...rest.roster, sources: [{ baseid: "5001", m: { housed: { C1: 5 } } }] },
    };
    const session = new AttackSession({ target: player, seed: 3 });
    session.start();
    session.appendFling({ x: -200, y: -200, monsters: { C1: 2 } });
    expect(checkpointOf(session)).toMatchObject({ basesaveid: 11, sources: ["5001"] });
  });
});

describe("the checkpoint plugin", () => {
  let session: AttackSession;
  let teardown: (() => void) | void;
  let sent: AttackCheckpoint[];
  let notices: Notices;
  let send: ReturnType<
    typeof vi.fn<
      (checkpoint: AttackCheckpoint, options?: { signal?: AbortSignal }) => Promise<unknown>
    >
  >;

  beforeEach(() => {
    vi.useFakeTimers();
    session = new AttackSession({ target: target(), seed: 3 });
    session.start();
    sent = [];
    notices = new Notices();
    send = vi.fn(async (checkpoint: AttackCheckpoint, _options?: { signal?: AbortSignal }) => {
      sent.push(checkpoint);
      return { error: 0, stored: true };
    });
  });

  afterEach(() => {
    teardown?.();
    teardown = undefined;
    vi.useRealTimers();
  });

  const mount = () => {
    teardown = createCheckpointPlugin({ send })({
      session,
      notices,
    } as unknown as AttackMounts);
  };

  it("sends nothing before the first drop, however long the clock runs", async () => {
    mount();
    vi.advanceTimersByTime(CHECKPOINT_INTERVAL_MS * 3);
    await flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("sends at once on a drop, then every few seconds while the battle runs", async () => {
    mount();
    session.appendFling({ x: -200, y: -200, monsters: { C1: 1 } });
    expect(send).toHaveBeenCalledTimes(1);
    await flush();

    session.advance(2);
    vi.advanceTimersByTime(CHECKPOINT_INTERVAL_MS);
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(sent[1]!.tick).toBe(160);
  });

  it("keeps one in flight and sends the newest state when it returns", async () => {
    let release!: () => void;
    send.mockImplementationOnce(
      (checkpoint) =>
        new Promise((resolve) => {
          sent.push(checkpoint);
          release = () => resolve({ error: 0 });
        }),
    );
    mount();
    session.appendFling({ x: -200, y: -200, monsters: { C1: 1 } });
    session.appendFling({ x: -150, y: -200, monsters: { C1: 1 } });
    session.appendFling({ x: -100, y: -200, monsters: { C1: 1 } });
    expect(send).toHaveBeenCalledTimes(1);

    release();
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(sent[1]!.flinglog.events).toHaveLength(3);
  });

  it("stops once the attack is over, and once the attack is no longer this player's", async () => {
    mount();
    session.appendFling({ x: -200, y: -200, monsters: { C1: 1 } });
    await flush();
    session.leave();
    vi.advanceTimersByTime(CHECKPOINT_INTERVAL_MS * 2);
    await flush();
    expect(send).toHaveBeenCalledTimes(1);

    teardown?.();
    session = new AttackSession({ target: target(), seed: 3 });
    session.start();
    send.mockRejectedValue(
      new ApiError("no", { status: 200, details: { data: { reason: "expired" } } }),
    );
    mount();
    session.appendFling({ x: -200, y: -200, monsters: { C1: 1 } });
    await flush();
    session.advance(1);
    vi.advanceTimersByTime(CHECKPOINT_INTERVAL_MS * 2);
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends one more the moment the tab is hidden, after the first drop only", async () => {
    const setVisibility = (state: DocumentVisibilityState): void => {
      Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    try {
      mount();
      setVisibility("hidden");
      await flush();
      expect(send).not.toHaveBeenCalled();

      setVisibility("visible");
      session.appendFling({ x: -200, y: -200, monsters: { C1: 1 } });
      await flush();
      session.advance(1);
      setVisibility("hidden");
      await flush();
      expect(send).toHaveBeenCalledTimes(2);
      expect(sent[1]!.tick).toBe(80);
      expect(session.state().phase).toBe("running");

      // Nothing after the end, and nothing once torn down.
      session.leave();
      setVisibility("visible");
      setVisibility("hidden");
      teardown?.();
      teardown = undefined;
      setVisibility("visible");
      setVisibility("hidden");
      await flush();
      expect(send).toHaveBeenCalledTimes(2);
    } finally {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
    }
  });

  it("tries again shortly after a network failure", async () => {
    send.mockRejectedValueOnce(new Error("offline"));
    mount();
    session.appendFling({ x: -200, y: -200, monsters: { C1: 1 } });
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(send).toHaveBeenCalledTimes(2);
    expect(sent).toHaveLength(1);
  });

  describe("pausing drops while the server is behind (owner, 2 Nov 2026)", () => {
    const fling = (x = -200): void => {
      session.appendFling({ x, y: -200, monsters: { C1: 1 } });
    };
    const reconnecting = (): boolean =>
      (notices.element.textContent ?? "").includes("Reconnecting");
    const offline = (): void => {
      send.mockImplementation(async () => {
        throw new TypeError("Failed to fetch");
      });
    };
    const online = (): void => {
      send.mockImplementation(async (checkpoint) => {
        sent.push(checkpoint);
        return { error: 0, stored: true };
      });
    };

    it("pauses new drops once a drop has gone ten seconds unconfirmed, and resumes once one is confirmed", async () => {
      offline();
      mount();
      fling();
      await vi.advanceTimersByTimeAsync(DROP_HOLD_AFTER_MS - 1000);
      expect(session.dropsHeld()).toBe(false);
      fling(-150);

      await vi.advanceTimersByTimeAsync(1000);
      expect(session.dropsHeld()).toBe(true);
      expect(reconnecting()).toBe(true);
      expect(() => fling(-100)).toThrow(DropsHeldError);
      expect(session.flingLog().events).toHaveLength(2);
      // Retried every couple of seconds meanwhile.
      expect(send.mock.calls.length).toBeGreaterThanOrEqual(DROP_HOLD_AFTER_MS / RETRY_MS);
      // The battle runs on.
      expect(session.state().phase).toBe("running");

      online();
      await vi.advanceTimersByTimeAsync(RETRY_MS);
      expect(session.dropsHeld()).toBe(false);
      expect(reconnecting()).toBe(false);
      expect(sent.at(-1)!.flinglog.events).toHaveLength(2);
      fling(-100);
      expect(session.flingLog().events).toHaveLength(3);
    });

    it("does not pause a slow phone whose checkpoints take four seconds each", async () => {
      send.mockImplementation(
        (checkpoint) =>
          new Promise((resolve) => {
            sent.push(checkpoint);
            window.setTimeout(() => resolve({ error: 0, stored: true }), 4000);
          }),
      );
      mount();
      for (let second = 0; second < 30; second++) {
        if (second < 5) fling(-200 + second * 20);
        for (let half = 0; half < 2; half++) {
          await vi.advanceTimersByTimeAsync(500);
          expect(session.dropsHeld()).toBe(false);
        }
      }
      expect(reconnecting()).toBe(false);
      expect(sent.at(-1)!.flinglog.events).toHaveLength(5);
    });

    it("gives up a checkpoint that hangs and sends it again before drops pause", async () => {
      send.mockImplementationOnce(
        (_checkpoint, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );
      mount();
      fling();
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + RETRY_MS);
      expect(send.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(sent.length).toBeGreaterThanOrEqual(1);
      expect(session.dropsHeld()).toBe(false);
      await vi.advanceTimersByTimeAsync(DROP_HOLD_AFTER_MS);
      expect(session.dropsHeld()).toBe(false);
    });

    it("lets go once the attack is over, once it is no longer this player's, and on teardown", async () => {
      offline();
      mount();
      fling();
      await vi.advanceTimersByTimeAsync(DROP_HOLD_AFTER_MS);
      expect(session.dropsHeld()).toBe(true);
      session.leave();
      await vi.advanceTimersByTimeAsync(1000);
      expect(session.dropsHeld()).toBe(false);
      expect(reconnecting()).toBe(false);

      teardown?.();
      session = new AttackSession({ target: target(), seed: 3 });
      session.start();
      mount();
      fling();
      await vi.advanceTimersByTimeAsync(DROP_HOLD_AFTER_MS);
      expect(session.dropsHeld()).toBe(true);
      send.mockRejectedValue(
        new ApiError("no", { status: 200, details: { data: { reason: "expired" } } }),
      );
      await vi.advanceTimersByTimeAsync(RETRY_MS);
      expect(session.dropsHeld()).toBe(false);
      expect(reconnecting()).toBe(false);

      teardown?.();
      session = new AttackSession({ target: target(), seed: 3 });
      session.start();
      offline();
      mount();
      fling();
      await vi.advanceTimersByTimeAsync(DROP_HOLD_AFTER_MS);
      expect(session.dropsHeld()).toBe(true);
      teardown?.();
      teardown = undefined;
      expect(session.dropsHeld()).toBe(false);
      expect(reconnecting()).toBe(false);
    });

    it("never pauses an attack the server keeps no record of (a practice attack, a raid)", async () => {
      const practiceLoad = { ...load() } as Record<string, unknown>;
      delete practiceLoad["basesaveid"];
      session = new AttackSession({
        target: {
          ...target(),
          mapversion: 2,
          load: practiceLoad as unknown as BaseLoadResponse,
        },
        seed: 3,
      });
      session.start();
      mount();
      fling();
      await vi.advanceTimersByTimeAsync(DROP_HOLD_AFTER_MS * 2);
      expect(send).not.toHaveBeenCalled();
      expect(session.dropsHeld()).toBe(false);
      fling(-150);
    });
  });

  it("tears down its timer", () => {
    mount();
    teardown?.();
    teardown = undefined;
    expect(vi.getTimerCount()).toBe(0);
  });
});
