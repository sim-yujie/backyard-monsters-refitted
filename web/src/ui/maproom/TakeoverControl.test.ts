// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MapCell, TakeoverQuoteResponse } from "@/api/types";
import { TakeoverControl } from "./TakeoverControl";

/**
 * The map cell panel's Take over action (issue #82): it shows only what the
 * server's quote says, asks again only when the cell changes, and keeps no
 * clock beyond the grant's countdown.
 */

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

const KOZU = { col: 241, row: 208 };
const OUTPOST_CELL = { col: 240, row: 208 };

const camp = (d = 0): MapCell =>
  ({ uid: 0, b: 1, i: 150, bid: "2000241208", n: "Kozu", l: 38, dm: d ? 95 : 0, d }) as MapCell;

const outpost = (): MapCell =>
  ({
    uid: 77,
    b: 3,
    i: 150,
    bid: "2000240208",
    aid: null,
    n: "Bramble",
    l: 20,
    v: 1,
    f: 2,
    c: 0,
    dm: 95,
    d: 1,
    lo: 0,
    p: 1,
    mine: 0,
    pic_square: null,
    pi: 0,
    fr: 0,
  }) as MapCell;

const quoteOf = (over: Partial<TakeoverQuoteResponse> = {}): TakeoverQuoteResponse => ({
  error: 0,
  baseid: "2000241208",
  kind: "camp",
  eligible: false,
  reason: "notDestroyed",
  resources: 3_500_000,
  shiny: 924,
  adjacent: true,
  affordable: { resources: true, shiny: true },
  now: 1_000,
  ...over,
});

describe("TakeoverControl", () => {
  let modal: HTMLElement;
  let clock: number;

  beforeEach(() => {
    clock = 1_000;
    modal = document.createElement("div");
    document.body.append(modal);
  });

  afterEach(() => {
    modal.remove();
  });

  const make = (quote: (baseid: string) => Promise<TakeoverQuoteResponse>) => {
    const takeOver = vi.fn(async () => ({ error: 0 }));
    const onTaken = vi.fn();
    const quoteSpy = vi.fn(quote);
    const control = new TakeoverControl({
      quote: quoteSpy,
      takeOver,
      onTaken,
      modal: () => modal,
      now: () => clock,
    });
    document.body.append(control.button, control.detail);
    return { control, quote: quoteSpy, takeOver, onTaken };
  };

  it("on Kozu before it is destroyed: disabled, with the reason", async () => {
    const { control, quote } = make(async () => quoteOf());
    control.setCell(KOZU, camp());
    expect(control.button.hidden).toBe(false);
    expect(control.button.disabled).toBe(true);
    expect(control.detail.textContent).toContain("Checking");
    await flush();
    expect(quote).toHaveBeenCalledWith("2000241208");
    expect(control.button.disabled).toBe(true);
    expect(control.detail.textContent).toBe("Not yet: destroy at least 90% of this yard first.");
    expect(control.button.title).toBe("Not yet: destroy at least 90% of this yard first.");
  });

  it("asks once per cell state, not on every panel refresh", async () => {
    const { control, quote } = make(async () => quoteOf());
    control.setCell(KOZU, camp());
    control.setCell(KOZU, camp());
    control.setCell(KOZU, camp());
    await flush();
    expect(quote).toHaveBeenCalledTimes(1);
    // The camp was destroyed meanwhile: ask again.
    control.setCell(KOZU, camp(1));
    await flush();
    expect(quote).toHaveBeenCalledTimes(2);
  });

  it("an eligible camp shows the price and opens the dialog with it", async () => {
    const { control } = make(async () => quoteOf({ eligible: true, reason: null }));
    control.setCell(KOZU, camp(1));
    await flush();
    expect(control.button.disabled).toBe(false);
    expect(control.detail.textContent).toBe("Take over: 3,500,000 of each resource or 924 Shiny");
    control.button.click();
    expect(modal.querySelector(".takeover-dialog .panel__title")!.textContent).toBe(
      "Take over this Wild Monster Yard",
    );
  });

  it("takes over through the dialog and reports the cell", async () => {
    const quote = quoteOf({ eligible: true, reason: null });
    const { control, takeOver, onTaken } = make(async () => quote);
    control.setCell(KOZU, camp(1));
    await flush();
    control.button.click();
    modal.querySelector<HTMLElement>(".takeover-dialog__resources")!.click();
    modal.querySelector<HTMLElement>(".takeover-dialog__go")!.click();
    await flush();
    expect(takeOver).toHaveBeenCalledWith("2000241208", "resources");
    expect(onTaken).toHaveBeenCalledWith(KOZU, { baseid: "2000241208", kind: "camp", name: "Kozu" }, quote, "resources");
  });

  it("stays hidden on a player outpost without the caller's grant", async () => {
    const { control } = make(async () =>
      quoteOf({ baseid: "2000240208", kind: "outpost", reason: "noTakeoverChance" }),
    );
    control.setCell(OUTPOST_CELL, outpost());
    expect(control.button.hidden).toBe(true);
    await flush();
    expect(control.button.hidden).toBe(true);
    expect(control.detail.hidden).toBe(true);
  });

  it("with the grant: shows it with the countdown, and asks again once it runs out", async () => {
    const answers = [
      quoteOf({ baseid: "2000240208", kind: "outpost", eligible: true, reason: null, grantExpiresAt: 1_300, now: 1_010 }),
      quoteOf({ baseid: "2000240208", kind: "outpost", reason: "noTakeoverChance", now: 1_310 }),
    ];
    const { control, quote } = make(async () => answers.shift()!);
    control.setCell(OUTPOST_CELL, outpost());
    await flush();
    expect(control.button.hidden).toBe(false);
    // Server clock 10 s ahead: 1,300 - 1,010 = 290 s.
    // On the cell panel's chips now, not only inside the dialog (#187).
    expect(control.chip.hidden).toBe(false);
    expect(control.chip.textContent).toBe("Offer ends in 4m 50s");
    clock = 1_289;
    control.tick();
    expect(quote).toHaveBeenCalledTimes(1);
    clock = 1_290;
    control.tick();
    await flush();
    expect(quote).toHaveBeenCalledTimes(2);
    expect(control.button.hidden).toBe(true);
  });

  it("drops a slow answer for a cell no longer shown", async () => {
    let release!: (quote: TakeoverQuoteResponse) => void;
    const first = new Promise<TakeoverQuoteResponse>((resolve) => (release = resolve));
    const answers = [first, Promise.resolve(quoteOf({ eligible: true, reason: null, baseid: "2000242208" }))];
    const { control } = make(() => answers.shift()!);
    control.setCell(KOZU, camp());
    control.setCell({ col: 242, row: 208 }, { ...camp(1), bid: "2000242208" } as MapCell);
    await flush();
    release(quoteOf());
    await flush();
    expect(control.button.disabled).toBe(false);
  });

  it("hides on the player's own cells and main yards without asking", () => {
    const { control, quote } = make(async () => quoteOf());
    control.setCell(OUTPOST_CELL, { ...outpost(), mine: 1 } as MapCell);
    control.setCell(OUTPOST_CELL, { ...outpost(), b: 2 } as MapCell);
    expect(quote).not.toHaveBeenCalled();
    expect(control.button.hidden).toBe(true);
  });
});
