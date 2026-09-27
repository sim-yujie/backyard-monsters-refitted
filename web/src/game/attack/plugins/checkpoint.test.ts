// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/http";
import type { BaseLoadResponse } from "@/api/types";
import { AttackSession } from "@/game/attack/AttackSession";
import type { AttackMounts } from "@/game/attack/attackPlugins";
import { checkpointOf, type AttackCheckpoint } from "@/game/attack/attackCheckpoint";
import type { AttackTarget } from "@/game/attack/attackTarget";
import { CHECKPOINT_INTERVAL_MS, createCheckpointPlugin } from "./checkpoint";

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
});

describe("the checkpoint plugin", () => {
  let session: AttackSession;
  let teardown: (() => void) | void;
  let sent: AttackCheckpoint[];
  let send: ReturnType<typeof vi.fn<(checkpoint: AttackCheckpoint) => Promise<unknown>>>;

  beforeEach(() => {
    vi.useFakeTimers();
    session = new AttackSession({ target: target(), seed: 3 });
    session.start();
    sent = [];
    send = vi.fn(async (checkpoint: AttackCheckpoint) => {
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
    teardown = createCheckpointPlugin({ send })({ session } as unknown as AttackMounts);
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
    send.mockRejectedValue(new ApiError("no", { status: 200, details: { data: { reason: "expired" } } }));
    mount();
    session.appendFling({ x: -200, y: -200, monsters: { C1: 1 } });
    await flush();
    session.advance(1);
    vi.advanceTimersByTime(CHECKPOINT_INTERVAL_MS * 2);
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("carries on past a network failure", async () => {
    send.mockRejectedValueOnce(new Error("offline"));
    mount();
    session.appendFling({ x: -200, y: -200, monsters: { C1: 1 } });
    await flush();
    session.advance(1);
    vi.advanceTimersByTime(CHECKPOINT_INTERVAL_MS);
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("tears down its timer", () => {
    mount();
    teardown?.();
    teardown = undefined;
    expect(vi.getTimerCount()).toBe(0);
  });
});
