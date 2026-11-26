import { describe, expect, test } from "bun:test";
import { ReplayGate, type GateLog, type GateOptions } from "./replayGate.js";

/**
 * The line for attacks started at will (patch 9.1): first come first in,
 * places, the two hard limits that turn one away "busy", a player who leaves,
 * and one log line for every wait and every refusal.
 */

const gateOf = (opts: Partial<GateOptions> & { free?: { now: boolean } } = {}) => {
  const free = opts.free ?? { now: true };
  const logs: GateLog[] = [];
  const gate = new ReplayGate({
    maxAdmitted: 2,
    maxWaiting: 3,
    workerFree: () => free.now,
    log: (line) => logs.push(line),
    ...opts,
  });
  return { gate, free, logs };
};

describe("the line", () => {
  test("goes straight in while a worker is free, writing no log line", async () => {
    const { gate, logs } = gateOf();
    const release = await gate.enter({ kind: "repeat", waitMs: 1_000 });
    expect(release).not.toBeNull();
    expect(gate.admitted).toBe(1);
    expect(gate.totals.straight).toBe(1);
    expect(logs).toHaveLength(0);
    release!();
    release!();
    expect(gate.admitted).toBe(0);
  });

  test("waits while no worker is free, first come first in, each with its place", async () => {
    const { gate, free, logs } = gateOf({ free: { now: false } });
    const order: number[] = [];
    const a = gate.enter({ kind: "repeat", waitMs: 5_000, who: 1 }).then((r) => (order.push(1), r));
    const b = gate.enter({ kind: "raid", waitMs: 5_000, who: 2 }).then((r) => (order.push(2), r));
    expect(gate.place(1)).toBe(1);
    expect(gate.place(2)).toBe(2);
    expect(gate.place(3)).toBeNull();
    free.now = true;
    gate.pump();
    const [ra, rb] = await Promise.all([a, b]);
    expect(order).toEqual([1, 2]);
    expect(ra).not.toBeNull();
    expect(rb).not.toBeNull();
    expect(gate.place(1)).toBeNull();
    expect(logs.map((l) => [l.kind, l.outcome, l.place])).toEqual([
      ["repeat", "served", 1],
      ["raid", "served", 2],
    ]);
    expect(gate.totals.waited).toBe(2);
  });

  test("lets in at most maxAdmitted; a release lets the next in", async () => {
    const { gate } = gateOf();
    const one = await gate.enter({ kind: "repeat", waitMs: 1_000 });
    const two = await gate.enter({ kind: "repeat", waitMs: 1_000 });
    const three = gate.enter({ kind: "repeat", waitMs: 5_000, who: 9 });
    expect(gate.place(9)).toBe(1);
    one!();
    expect(await three).not.toBeNull();
    expect(gate.admitted).toBe(2);
    two!();
  });

  test("turns one away at once when the line is full", async () => {
    const { gate, logs } = gateOf({ free: { now: false } });
    const waiting = [1, 2, 3].map((who) => gate.enter({ kind: "repeat", waitMs: 200, who }));
    expect(await gate.enter({ kind: "repeat", waitMs: 5_000, who: 4 })).toBeNull();
    expect(logs.at(-1)).toMatchObject({ outcome: "refused", why: "full", waitedMs: 0, place: 0, waiting: 3 });
    expect(gate.totals.refused).toBe(1);
    await Promise.all(waiting);
  });

  test("turns one away once it has waited its time, and the rest move up", async () => {
    const { gate, logs } = gateOf({ free: { now: false } });
    const first = gate.enter({ kind: "repeat", waitMs: 50, who: 1 });
    const second = gate.enter({ kind: "repeat", waitMs: 5_000, who: 2 });
    const started = performance.now();
    expect(await first).toBeNull();
    expect(performance.now() - started).toBeGreaterThanOrEqual(40);
    expect(gate.place(2)).toBe(1);
    expect(logs.at(-1)).toMatchObject({ kind: "repeat", outcome: "refused", why: "timeout", place: 1 });
    expect(logs.at(-1)!.waitedMs).toBeGreaterThanOrEqual(40);
    gate.pump();
    expect(gate.waiting).toBe(1);
    void second;
  });

  test("a player who leaves gives up their place", async () => {
    const { gate, logs } = gateOf({ free: { now: false } });
    const left = new AbortController();
    const waiting = gate.enter({ kind: "repeat", waitMs: 5_000, who: 5, signal: left.signal });
    expect(gate.place(5)).toBe(1);
    left.abort();
    expect(await waiting).toBeNull();
    expect(gate.place(5)).toBeNull();
    expect(gate.totals.gone).toBe(1);
    expect(logs.at(-1)).toMatchObject({ outcome: "gone" });
    // Already gone before asking: never joins.
    expect(await gate.enter({ kind: "repeat", waitMs: 5_000, signal: left.signal })).toBeNull();
    expect(gate.waiting).toBe(0);
  });

  test("a newcomer never jumps the line, even when a worker is free at that moment", async () => {
    const { gate, free } = gateOf({ free: { now: false } });
    const order: string[] = [];
    const first = gate.enter({ kind: "repeat", waitMs: 5_000 }).then(() => order.push("first"));
    free.now = true;
    const second = gate.enter({ kind: "repeat", waitMs: 5_000 }).then(() => order.push("second"));
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });
});
