import { describe, expect, test } from "bun:test";
import { catchUpYard, type CatchUpSave } from "./catchUp.js";
import { catchUpLocker, unlockStarterMonster } from "./catchUpLocker.js";
import { withStarterUnlocked } from "./locker.js";

/**
 * The locker catch-up step (`docs/design/yard-buildings.md` §4.3, §4.6 item 1),
 * alone and through `catchUpYard`. Plain objects; `now` is just a number.
 */

const SAVED = 1_800_000_000;
const HOUR = 60 * 60;

/** Pokey unlocked; C5 unlocking since `SAVED`, ending `SAVED + length`. */
const saveOf = (length = 8 * HOUR, overrides: Partial<CatchUpSave> = {}): CatchUpSave => ({
  savetime: SAVED,
  buildingdata: {},
  buildinghealthdata: {},
  points: "0",
  lockerdata: { C1: { t: 2 }, C5: { t: 1, s: SAVED, e: SAVED + length } },
  academy: { C1: { level: 2 } },
  storedata: {},
  ...overrides,
});

/** An Overdrive bought at `start`, four hours long, as the shop writes it. */
const clod = (start: number) => ({ CLOD: { q: 1, s: start, e: start + 4 * HOUR } });

describe("catchUpLocker", () => {
  test("an unlock whose end has passed completes: t 2, s/e gone, academy level 1, a record", () => {
    const save = saveOf();
    const completed = catchUpYard(save, SAVED + 9 * HOUR);

    expect(save.lockerdata).toEqual({ C1: { t: 2 }, C5: { t: 2 } });
    expect(save.academy).toEqual({ C1: { level: 2 }, C5: { level: 1 } });
    expect(completed).toEqual([{ kind: "unlock", id: "C5", t: null, at: SAVED + 8 * HOUR, detail: {} }]);
  });

  test("not yet ended: nothing changes", () => {
    const save = saveOf();
    const before = structuredClone(save);
    expect(catchUpYard(save, SAVED + HOUR)).toEqual([]);
    expect(save.lockerdata).toEqual(before.lockerdata);
    expect(save.academy).toEqual(before.academy);
  });

  test("ends exactly now: complete", () => {
    const save = saveOf(HOUR);
    expect(catchUpYard(save, SAVED + HOUR)).toHaveLength(1);
  });

  test("an existing academy entry is kept", () => {
    const save = saveOf(HOUR, { academy: { C5: { level: 3 } } });
    catchUpYard(save, SAVED + 2 * HOUR);
    expect(save.academy).toEqual({ C5: { level: 3 } });
  });

  test("an Inferno unlock is left alone", () => {
    const save = saveOf(HOUR, { lockerdata: { IC1: { t: 1, s: SAVED, e: SAVED + 10 } } });
    expect(catchUpYard(save, SAVED + 2 * HOUR)).toEqual([]);
    // Only the Pokey goes in (#218); the Inferno entry is untouched.
    expect(save.lockerdata).toEqual({ C1: { t: 2 }, IC1: { t: 1, s: SAVED, e: SAVED + 10 } });
  });

  test("idempotent: a second run at the same moment changes nothing", () => {
    const save = saveOf(36 * HOUR, { storedata: clod(SAVED) });
    catchUpYard(save, SAVED + HOUR);
    const after = structuredClone(save);
    expect(catchUpYard(save, SAVED + HOUR)).toEqual([]);
    expect(save).toEqual(after);
  });

  describe("Overdrive (CLOD): 5x while active", () => {
    test("one hour of Overdrive takes five hours off", () => {
      const save = saveOf(36 * HOUR, { storedata: clod(SAVED) });
      catchUpYard(save, SAVED + HOUR);
      expect(save.lockerdata!.C5).toEqual({ t: 1, s: SAVED, e: SAVED + 36 * HOUR - 4 * HOUR });
    });

    test("split into many small catch-ups gives the same end as one big one", () => {
      const once = saveOf(36 * HOUR, { storedata: clod(SAVED + HOUR) });
      catchUpYard(once, SAVED + 10 * HOUR);

      const often = saveOf(36 * HOUR, { storedata: clod(SAVED + HOUR) });
      for (let at = SAVED + 1_234; at < SAVED + 10 * HOUR; at += 1_234) catchUpYard(often, at);
      catchUpYard(often, SAVED + 10 * HOUR);

      // Four hours of Overdrive: 16 h off a 36 h unlock.
      expect(once.lockerdata!.C5).toMatchObject({ e: SAVED + 20 * HOUR });
      expect(often.lockerdata!.C5).toEqual(once.lockerdata!.C5);
    });

    test("an Overdrive that ran out during the window still counts, and then expires", () => {
      const save = saveOf(36 * HOUR, { storedata: clod(SAVED) });
      const completed = catchUpYard(save, SAVED + 6 * HOUR);

      expect(save.lockerdata!.C5).toMatchObject({ e: SAVED + 20 * HOUR });
      expect(save.storedata).toEqual({});
      expect(completed.map((job) => job.kind)).toEqual(["storeItem"]);
    });

    test("an unlock the Overdrive finishes early completes at the 5x moment", () => {
      // 8 h left, all inside a 4 h Overdrive: done after 8 / 5 h = 5,760 s.
      const save = saveOf(8 * HOUR, { storedata: clod(SAVED) });
      const completed = catchUpYard(save, SAVED + 2 * HOUR);

      expect(save.lockerdata!.C5).toEqual({ t: 2 });
      expect(completed[0]).toEqual({ kind: "unlock", id: "C5", t: null, at: SAVED + 5_760, detail: {} });
    });

    test("the Overdrive only counts from when the unlock started", () => {
      // Overdrive since SAVED − 1 h; the unlock was started at SAVED (savetime a
      // little earlier than that, as a Flash-era save could leave it).
      const save = saveOf(10 * HOUR, {
        savetime: SAVED - HOUR,
        storedata: clod(SAVED - HOUR),
      });
      catchUpLocker(save, SAVED - HOUR, SAVED + HOUR);
      expect(save.lockerdata!.C5).toMatchObject({ e: SAVED + 10 * HOUR - 4 * HOUR });
    });

    test("an Overdrive entry without s started four hours before its e", () => {
      const save = saveOf(36 * HOUR, { storedata: { CLOD: { q: 1, e: SAVED + 3 * HOUR } } });
      catchUpYard(save, SAVED + HOUR);
      expect(save.lockerdata!.C5).toMatchObject({ e: SAVED + 32 * HOUR });
    });
  });
});

describe("the Pokey is always unlocked (#218)", () => {
  test("withStarterUnlocked adds C1 and leaves every other entry alone", () => {
    const running = { t: 1, s: SAVED, e: SAVED + HOUR };
    expect(withStarterUnlocked(undefined)).toEqual({ C1: { t: 2 } });
    expect(withStarterUnlocked(null)).toEqual({ C1: { t: 2 } });
    expect(withStarterUnlocked({ C2: { t: 2 }, C5: running })).toEqual({
      C1: { t: 2 },
      C2: { t: 2 },
      C5: running,
    });
  });

  test("withStarterUnlocked hands back the same object when the Pokey is already unlocked", () => {
    const lockerdata = { C1: { t: 2 }, C2: { t: 2 } };
    expect(withStarterUnlocked(lockerdata)).toBe(lockerdata);
  });

  test("a running Pokey unlock (a save from before #218) becomes unlocked, as Flash's load made it", () => {
    expect(withStarterUnlocked({ C1: { t: 1, s: SAVED, e: SAVED + 600 } })).toEqual({ C1: { t: 2 } });
  });

  test("unlockStarterMonster writes only when the Pokey was missing", () => {
    const save = saveOf();
    const lockerdata = save.lockerdata;
    unlockStarterMonster(save);
    expect(save.lockerdata).toBe(lockerdata);

    const empty = saveOf(HOUR, { lockerdata: {} });
    unlockStarterMonster(empty);
    expect(empty.lockerdata).toEqual({ C1: { t: 2 } });
  });

  test("catchUpYard gives an old save with an empty locker the Pokey, and nothing else", () => {
    const save = saveOf(HOUR, { lockerdata: {}, academy: {} });
    expect(catchUpYard(save, SAVED + 60)).toEqual([]);
    expect(save.lockerdata).toEqual({ C1: { t: 2 } });
    expect(save.academy).toEqual({});
  });

  test("catchUpYard on an outpost gives the Pokey too", () => {
    const save = saveOf(HOUR, { type: "outpost", lockerdata: null } as Partial<CatchUpSave>);
    catchUpYard(save, SAVED + 60);
    expect(save.lockerdata).toEqual({ C1: { t: 2 } });
  });

  test("an unlock running alongside still completes as before", () => {
    const save = saveOf(HOUR, { lockerdata: { C5: { t: 1, s: SAVED, e: SAVED + HOUR } } });
    catchUpYard(save, SAVED + 2 * HOUR);
    expect(save.lockerdata).toEqual({ C1: { t: 2 }, C5: { t: 2 } });
  });
});
