import { describe, expect, it, vi } from "vitest";
import { UnlockInbox } from "./unlockInbox";

/** The unlock pop-up's queue (#204, WP6): taking answers in, cards out, `seen` bookkeeping. */

const live = (id: number, shiny = 5) => ({ id, name: `Ach ${id}`, shiny });
const backfilled = (id: number, shiny = 5) => ({ ...live(id, shiny), backfill: true as const });

describe("UnlockInbox", () => {
  it("takes nothing from an absent or malformed field (rewards off)", () => {
    const inbox = new UnlockInbox();
    expect(inbox.add(undefined)).toBe(false);
    expect(inbox.add(null)).toBe(false);
    expect(inbox.add({ id: 1 })).toBe(false);
    expect(inbox.add([null, "x", { id: -1 }, { id: 1.5 }, { name: "no id" }])).toBe(false);
    expect(inbox.size).toBe(0);
    expect(inbox.next()).toBeNull();
  });

  it("fills a missing name and drops a bad Shiny figure", () => {
    const inbox = new UnlockInbox();
    inbox.add([{ id: 7, shiny: "lots" }]);
    expect(inbox.next()).toEqual({ unlocks: [{ id: 7, name: "Achievement 7", shiny: 0 }], summary: false, shiny: 0 });
  });

  it("gives one card per live unlock, oldest first", () => {
    const inbox = new UnlockInbox();
    inbox.add([live(3, 10), live(1, 5)]);
    expect(inbox.next()).toEqual({ unlocks: [live(3, 10)], summary: false, shiny: 10 });
    expect(inbox.next()).toEqual({ unlocks: [live(1, 5)], summary: false, shiny: 5 });
    expect(inbox.next()).toBeNull();
  });

  it("puts the backfill's unlocks on one summary card, ahead of live ones", () => {
    const inbox = new UnlockInbox();
    inbox.add([live(9, 20), backfilled(1, 5), backfilled(2, 10)]);
    inbox.add([backfilled(3, 5)]);
    const summary = inbox.next()!;
    expect(summary.summary).toBe(true);
    expect(summary.unlocks.map((unlock) => unlock.id)).toEqual([1, 2, 3]);
    expect(summary.shiny).toBe(20);
    expect(inbox.next()).toMatchObject({ unlocks: [live(9, 20)], summary: false });
  });

  it("a single backfilled unlock is an ordinary card", () => {
    const inbox = new UnlockInbox();
    inbox.add([backfilled(1)]);
    expect(inbox.next()).toMatchObject({ summary: false, shiny: 5 });
  });

  it("drops an id it already took in, as every answer carries it until seen", () => {
    const inbox = new UnlockInbox();
    expect(inbox.add([live(1)])).toBe(true);
    expect(inbox.add([live(1)])).toBe(false);
    inbox.next();
    expect(inbox.add([live(1), live(2)])).toBe(true);
    expect(inbox.size).toBe(1);
  });

  it("tells its listeners only when something new is queued", () => {
    const inbox = new UnlockInbox();
    const listener = vi.fn();
    const unsubscribe = inbox.subscribe(listener);
    inbox.add([live(1)]);
    inbox.add([live(1)]);
    inbox.add(undefined);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    inbox.add([live(2)]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps shown ids for seen until they are confirmed", () => {
    const inbox = new UnlockInbox();
    inbox.add([backfilled(1), backfilled(2), live(3)]);
    inbox.shown(inbox.next()!);
    expect(inbox.toConfirm()).toEqual([1, 2]);
    inbox.shown(inbox.next()!);
    expect(inbox.toConfirm()).toEqual([1, 2, 3]);
    inbox.confirmed([1, 2]);
    expect(inbox.toConfirm()).toEqual([3]);
  });
});
