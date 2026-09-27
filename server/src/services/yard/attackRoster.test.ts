import { describe, expect, test } from "bun:test";
import { claimedFlung, flungPerYard, subtractHoused, takeFlung } from "./attackRoster.js";

/** What an attack takes out of the attacker's yards (§4.6). */

describe("claimedFlung — the design's rule without a log", () => {
  test("entry minus sent, clamped to [0, entry]; an increase is ignored", () => {
    expect(claimedFlung({ C1: 50, C2: 10, C3: 4 }, { C1: 45, C2: 30 })).toEqual({ C1: 5, C3: 4 });
  });

  test("a negative or missing sent count cannot take more than the yard had", () => {
    expect(claimedFlung({ C1: 5 }, { C1: -100 })).toEqual({ C1: 5 });
  });
});

describe("takeFlung — first yard first, capped by now and by entry", () => {
  test("spends the first yard, then the next", () => {
    expect(
      takeFlung(
        [
          { baseid: "home", housed: { C1: 5, C2: 3 } },
          { baseid: "op", housed: { C1: 10 } },
        ],
        { C1: 8, C2: 1 }
      )
    ).toEqual({ taken: { home: { C1: 5, C2: 1 }, op: { C1: 3 } }, unpaid: {} });
  });

  test("a yard gives no more than it housed at entry: what hatched since was not in the roster", () => {
    const { taken, unpaid } = takeFlung([{ baseid: "home", housed: { C1: 60 } }], { C1: 55 }, { home: { C1: 50 } });

    expect(taken).toEqual({ home: { C1: 50 } });
    expect(unpaid).toEqual({ C1: 5 });
  });
});

describe("flungPerYard — the attack save", () => {
  const cells = [
    { baseid: "home", housed: { C1: 70 } },
    { baseid: "op", housed: { C1: 20 } },
  ];

  test("with a log: the log's count, whatever the sent blobs say", () => {
    // The map read was older than the attack: 60 at home then, 70 at entry.
    // The client sends 60 − 5 = 55; the log says 5 were flung.
    expect(
      flungPerYard({
        cells,
        sent: { home: { C1: 55 }, op: { C1: 20 } },
        entryHoused: { home: { C1: 70 }, op: { C1: 20 } },
        logged: { C1: 5 },
      })
    ).toEqual({ home: { C1: 5 } });
  });

  test("with a log, an inflated sent count still loses what was flung", () => {
    expect(
      flungPerYard({ cells, sent: { home: { C1: 9999 } }, entryHoused: { home: { C1: 70 } }, logged: { C1: 30 } })
    ).toEqual({ home: { C1: 30 } });
  });

  test("without a log: clamp(entry − sent) per yard, increases ignored", () => {
    expect(
      flungPerYard({
        cells,
        sent: { home: { C1: 64 }, op: { C1: 25 } },
        entryHoused: { home: { C1: 70 }, op: { C1: 20 } },
        logged: null,
      })
    ).toEqual({ home: { C1: 6 } });
  });

  test("without a log and without entry counts, the yard now is the entry", () => {
    expect(flungPerYard({ cells, sent: { home: { C1: 60 } }, logged: null })).toEqual({ home: { C1: 10 } });
  });
});

describe("subtractHoused", () => {
  test("removes from housed, never below 0, keeps every other key", () => {
    expect(subtractHoused({ housed: { C1: 3, C2: 5 }, h: [1], saved: 9 }, { C1: 5, C2: 1 })).toEqual({
      housed: { C1: 0, C2: 4 },
      h: [1],
      saved: 9,
    });
  });
});
