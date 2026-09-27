import { describe, expect, test } from "bun:test";
import {
  MAX_CHECKPOINT_TICK,
  checkpointExpired,
  checkpointExtends,
  newCheckpoint,
  parseCheckpoint,
  parseStoredCheckpoint,
  serialiseCheckpoint,
  type CheckpointInput,
} from "./attackCheckpoint.js";
import { ATTACK_SESSION_WINDOW } from "./attackSession.js";

/**
 * What a checkpoint is and when one may replace another (issue #138). Pure, so
 * the rules that stop a checkpoint being used to take a drop back are testable
 * without Redis or a request.
 */

const fling = (t: number, monsters: Record<string, number> = { C1: 10 }) => ({
  kind: "fling",
  t,
  x: -600,
  y: 100,
  r: 100,
  monsters,
});

const body = (overrides: Record<string, unknown> = {}) => ({
  tick: 900,
  flinglog: { v: 1, seed: 77, events: [fling(400)] },
  sources: ["1000239208"],
  ...overrides,
});

const accepted = (value: ReturnType<typeof parseCheckpoint>): CheckpointInput => {
  if ("refused" in value) throw new Error(`refused: ${value.refused}`);
  return value;
};

const session = { attackerid: 2503, attackid: 4242, startedat: 1_000_000 };

describe("parseCheckpoint", () => {
  test("reads a checkpoint", () => {
    expect(accepted(parseCheckpoint(body()))).toEqual({
      tick: 900,
      flinglog: { v: 1, seed: 77, events: [fling(400)] as never },
      sources: ["1000239208"],
    });
  });

  test("reads bombs, siege weapons, retreats and a champion", () => {
    const events = [
      { ...fling(400), champion: { t: 5, l: 5 } },
      { kind: "bomb", t: 500, x: 1, y: 2, id: "pb1" },
      { kind: "siege", t: 600, x: 1, y: 2, weapon: "jars" },
      { kind: "retreat", t: 700 },
    ];
    expect(accepted(parseCheckpoint(body({ flinglog: { v: 1, seed: 77, events } }))).flinglog.events).toHaveLength(4);
  });

  test("an attack with nothing dropped has nothing to checkpoint (#79)", () => {
    expect(parseCheckpoint(body({ flinglog: { v: 1, seed: 77, events: [] } }))).toEqual({ refused: "empty" });
  });

  test("a clock behind the log's last event is raised to it", () => {
    expect(accepted(parseCheckpoint(body({ tick: 10 }))).tick).toBe(400);
  });

  test.each([
    ["a fractional tick", { tick: 1.5 }],
    ["a tick past the longest attack", { tick: MAX_CHECKPOINT_TICK + 1 }],
    ["no log", { flinglog: undefined }],
    ["a log of another version", { flinglog: { v: 2, seed: 77, events: [fling(1)] } }],
    ["a log with no seed", { flinglog: { v: 1, events: [fling(1)] } }],
    ["an unknown event", { flinglog: { v: 1, seed: 77, events: [{ kind: "nuke", t: 1 }] } }],
    ["a negative count", { flinglog: { v: 1, seed: 77, events: [fling(1, { C1: -5 })] } }],
    ["a bomb with no id", { flinglog: { v: 1, seed: 77, events: [{ kind: "bomb", t: 1, x: 0, y: 0 }] } }],
    ["no sources", { sources: undefined }],
    ["a source that is not a base id", { sources: ["drop table"] }],
  ])("refuses %s", (_, overrides) => {
    expect(parseCheckpoint(body(overrides))).toEqual({ refused: "malformed" });
  });
});

describe("checkpointExtends", () => {
  const stored = newCheckpoint(session, 9, accepted(parseCheckpoint(body())), 1_000_010);

  test("the first checkpoint of an attack is always taken", () => {
    expect(checkpointExtends(null, stored)).toBeNull();
  });

  test("a later clock and a longer log extend it", () => {
    const next = accepted(
      parseCheckpoint(body({ tick: 2000, flinglog: { v: 1, seed: 77, events: [fling(400), fling(1500)] } }))
    );
    expect(checkpointExtends(stored, next)).toBeNull();
  });

  test("a shorter log would take a drop back out of the record", () => {
    const next = accepted(parseCheckpoint(body({ tick: 2000, flinglog: { v: 1, seed: 77, events: [fling(1500)] } })));
    expect(checkpointExtends(stored, next)).toBe("rewound");
  });

  test("a changed event is refused", () => {
    const next = accepted(
      parseCheckpoint(body({ flinglog: { v: 1, seed: 77, events: [fling(400, { C1: 1 })] } }))
    );
    expect(checkpointExtends(stored, next)).toBe("rewound");
  });

  test("a clock that goes back is refused", () => {
    expect(checkpointExtends(stored, { ...stored, tick: 500 })).toBe("rewound");
  });

  test("another seed is another battle", () => {
    const next = accepted(parseCheckpoint(body({ flinglog: { v: 1, seed: 78, events: [fling(400)] } })));
    expect(checkpointExtends(stored, next)).toBe("reseeded");
  });
});

describe("stored checkpoints", () => {
  const checkpoint = newCheckpoint(session, 9, accepted(parseCheckpoint(body())), 1_000_010);

  test("round-trip", () => {
    expect(parseStoredCheckpoint(serialiseCheckpoint(checkpoint))).toEqual(checkpoint);
  });

  test("anything unreadable is no checkpoint", () => {
    expect(parseStoredCheckpoint(null)).toBeNull();
    expect(parseStoredCheckpoint("not json")).toBeNull();
    expect(parseStoredCheckpoint(JSON.stringify({ ...checkpoint, attackid: "x" }))).toBeNull();
  });

  test("expires with the attack session's window, not before", () => {
    expect(checkpointExpired(checkpoint, session.startedat + ATTACK_SESSION_WINDOW - 1)).toBe(false);
    expect(checkpointExpired(checkpoint, session.startedat + ATTACK_SESSION_WINDOW)).toBe(true);
  });
});
