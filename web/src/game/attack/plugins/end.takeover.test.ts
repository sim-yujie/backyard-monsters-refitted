// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttackSavePayload, BaseLoadResponse, BaseSaveResponse, TakeoverQuoteResponse } from "@/api/types";
import { AttackPresentation } from "@/game/attack/attackPresentation";
import { AttackSession } from "@/game/attack/AttackSession";
import type { AttackMounts } from "@/game/attack/attackPlugins";
import type { AttackTarget } from "@/game/attack/attackTarget";
import { consumeMapFocus } from "@/game/maproom/mapFocus";
import { Notices } from "@/ui/maproom/Notices";
import { createEndPlugin, takeoverChanceOf, type TakeoverCalls } from "./end";

/**
 * The takeover offer on the end-of-attack panel (issue #82), driven by a
 * mocked final save: a player outpost's save carries `takeovergrant`, the
 * attacker's one chance; a destroyed camp carries `destroyed: 1`.
 */

const yard = (): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "2000240208",
    basesaveid: 900,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: { "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } },
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 0, r3: 0, r4: 0 },
    attackid: 77,
  }) as unknown as BaseLoadResponse;

const target = (over: Partial<AttackTarget> = {}): AttackTarget => ({
  baseid: "2000240208",
  kind: "outpost",
  cell: { col: 240, row: 208 },
  name: "Bramble",
  roster: { monsters: { C1: 3 }, levels: {}, champions: [], flingerLevel: 4, catapultLevel: 0 },
  load: yard(),
  ...over,
});

/** Seconds: the local clock and the server's agree in these tests. */
const NOW = 1_000_000;

const grant = { baseid: "2000240208", expiresAt: NOW + 600, resources: 10_000_000, shiny: 1_301, adjacent: false };

const quoteOf = (over: Partial<TakeoverQuoteResponse> = {}): TakeoverQuoteResponse => ({
  error: 0,
  baseid: "2000240208",
  kind: "outpost",
  eligible: true,
  reason: null,
  resources: 10_000_000,
  shiny: 1_301,
  adjacent: false,
  grantExpiresAt: NOW + 600,
  affordable: { resources: true, shiny: true },
  now: NOW,
  ...over,
});

/** The same quote without the grant's end, as the server answers once the chance is gone. */
const withoutGrant = (quote: TakeoverQuoteResponse): TakeoverQuoteResponse => {
  const { grantExpiresAt: _gone, ...rest } = quote;
  return rest;
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe("the end panel's takeover offer", () => {
  let clock: number;
  let modal: HTMLElement;
  let notices: Notices;
  let goToMap: ReturnType<typeof vi.fn>;
  let teardown: (() => void) | void;
  let calls: { [K in keyof TakeoverCalls]: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    clock = NOW * 1000;
    modal = document.createElement("div");
    document.body.append(modal);
    notices = new Notices().mount(document.body);
    goToMap = vi.fn();
    calls = {
      quote: vi.fn(async () => quoteOf()),
      takeOver: vi.fn(async () => ({ error: 0 })),
      decline: vi.fn(async () => ({ protectedUntil: NOW + 8 * 3600 })),
    };
    consumeMapFocus();
  });

  afterEach(() => {
    teardown?.();
    teardown = undefined;
    notices.destroy();
    modal.remove();
    vi.useRealTimers();
  });

  /** Mounts the plugin on an attack against `aimed`, ends it, and lets the mocked save answer `response`. */
  const endWith = async (response: Partial<BaseSaveResponse>, aimed: AttackTarget = target()) => {
    const session = new AttackSession({ target: aimed, seed: 1 });
    session.start();
    const save = vi.fn(async (_payload: AttackSavePayload) => ({ error: 0, basesaveid: 900, ...response }) as BaseSaveResponse);
    teardown = createEndPlugin({ save, now: () => clock, takeover: calls as unknown as TakeoverCalls })({
      session,
      target: session.target,
      modal,
      notices,
      goToMap,
      presentation: new AttackPresentation(),
    } as unknown as AttackMounts);
    session.appendFling({ x: -100, y: -100, monsters: { C1: 1 } });
    session.retreat();
    await flush();
    return session;
  };

  const $ = <T extends HTMLElement>(selector: string) => modal.querySelector<T>(selector);

  it("offers the one chance on a destroyed outpost: price, countdown, Take over and Not now", async () => {
    await endWith({ destroyed: 1, protected: NOW + 600 + 8 * 3600, takeovergrant: grant });
    const offer = $(".end-takeover")!;
    expect(offer).not.toBeNull();
    expect(offer.textContent).toContain("You have destroyed this outpost and can now take it and all its buildings.");
    expect($(".end-takeover__price")!.textContent).toBe("Price: 10,000,000 of each resource or 1,301 Shiny");
    expect($(".end-takeover__countdown")!.textContent).toBe("Offer ends in 10m 0s");
    expect($<HTMLButtonElement>(".end-takeover__take")!.disabled).toBe(false);
    expect($(".end-takeover__not-now")!.hidden).toBe(false);
    expect(offer.textContent).toContain("leaving this screen, turns the offer down");
    // The grant's protection has not started yet, so the panel does not claim it has.
    expect($(".attack-end__protection")!.hidden).toBe(true);

    clock += 61_000;
    vi.advanceTimersByTime(1000);
    expect($(".end-takeover__countdown")!.textContent).toBe("Offer ends in 8m 59s");
  });

  it("Not now declines: the outpost's protection starts and the offer closes", async () => {
    await endWith({ destroyed: 1, takeovergrant: grant });
    $(".end-takeover__not-now")!.click();
    await flush();
    expect(calls.decline).toHaveBeenCalledTimes(1);
    expect(calls.decline.mock.calls[0]![0]).toBe("2000240208");
    expect($(".end-takeover__take")!.hidden).toBe(true);
    expect($(".end-takeover__message")!.textContent).toBe(
      "You turned the offer down. Bramble's outpost is now under damage protection for 8 h.",
    );
    // Returning after a decline does not decline again.
    $(".attack-end__return")!.click();
    expect(calls.decline).toHaveBeenCalledTimes(1);
  });

  it("Return to map without choosing declines, and opens the map on the outpost", async () => {
    await endWith({ destroyed: 1, takeovergrant: grant });
    $(".attack-end__return")!.click();
    expect(calls.decline).toHaveBeenCalledTimes(1);
    expect(calls.decline.mock.calls[0]![1]).toMatchObject({});
    expect(calls.decline.mock.calls[0]![1].keepalive).toBeUndefined();
    expect(goToMap).toHaveBeenCalledTimes(1);
    expect(consumeMapFocus()).toEqual({ cell: { col: 240, row: 208 } });
  });

  it("a closing page declines with a keepalive request, once", async () => {
    await endWith({ destroyed: 1, takeovergrant: grant });
    window.dispatchEvent(new Event("pagehide"));
    teardown?.();
    teardown = undefined;
    expect(calls.decline).toHaveBeenCalledTimes(1);
    expect(calls.decline.mock.calls[0]![1]).toMatchObject({ keepalive: true });
  });

  it("Take over opens the dialog, takes it, and opens the map on the new outpost", async () => {
    await endWith({ destroyed: 1, takeovergrant: grant });
    $(".end-takeover__take")!.click();
    expect($(".takeover-dialog .panel__title")!.textContent).toBe("Take Over Bramble's Outpost");
    $(".takeover-dialog__shiny")!.click();
    $(".takeover-dialog__go")!.click();
    await flush();
    expect(calls.takeOver).toHaveBeenCalledWith("2000240208", "shiny");
    expect(goToMap).toHaveBeenCalledTimes(1);
    expect(consumeMapFocus()).toEqual({
      cell: { col: 240, row: 208 },
      takenOver: { kind: "outpost", name: "Bramble" },
    });
    // Taken, so nothing is declined on the way out.
    teardown?.();
    teardown = undefined;
    expect(calls.decline).not.toHaveBeenCalled();
  });

  it("when the countdown runs out it asks the server, which says the chance has ended", async () => {
    await endWith({ destroyed: 1, takeovergrant: grant });
    calls.quote.mockImplementation(async () => withoutGrant(quoteOf({ eligible: false, reason: "noTakeoverChance" })));
    clock += 600_000;
    vi.advanceTimersByTime(1000);
    await flush();
    expect(calls.quote).toHaveBeenCalledTimes(2);
    expect($<HTMLButtonElement>(".end-takeover__take")!.disabled).toBe(true);
    expect($(".end-takeover__message")!.textContent).toBe("The chance to take this outpost over has ended.");
    $(".attack-end__return")!.click();
    expect(calls.decline).not.toHaveBeenCalled();
  });

  it("no grant on the save, no offer: a player outpost at 25-89% just gets its protection", async () => {
    await endWith({ destroyed: 0, protected: NOW + 8 * 3600 });
    expect($(".end-takeover")).toBeNull();
    expect($(".attack-end__protection")!.hidden).toBe(false);
  });

  it("a destroyed camp offers Take over with the quote's price, and nothing to decline", async () => {
    calls.quote.mockImplementation(async () =>
      withoutGrant(quoteOf({ baseid: "2000241208", kind: "camp", resources: 3_500_000, shiny: 924, adjacent: true })),
    );
    await endWith(
      { destroyed: 1 },
      target({ baseid: "2000241208", kind: "wild", cell: { col: 241, row: 208 }, name: "Kozu" }),
    );
    expect(calls.quote).toHaveBeenCalledWith("2000241208");
    expect($(".end-takeover__not-now")!.hidden).toBe(true);
    expect($(".end-takeover__countdown")!.hidden).toBe(true);
    expect($(".end-takeover__price")!.textContent).toBe(
      "Price: 3,500,000 of each resource or 924 Shiny (half price: next to your main yard)",
    );
    expect($<HTMLButtonElement>(".end-takeover__take")!.disabled).toBe(false);
    $(".attack-end__return")!.click();
    expect(calls.decline).not.toHaveBeenCalled();
    expect(consumeMapFocus()).toEqual({ cell: { col: 241, row: 208 } });
  });
});

describe("takeoverChanceOf", () => {
  const response = (extra: object) => ({ error: 0, basesaveid: 1, ...extra }) as BaseSaveResponse;

  it("only on Map Room 2: an outpost's grant, or a destroyed camp", () => {
    expect(takeoverChanceOf(target(), response({ takeovergrant: grant }), null)).toEqual({ kind: "outpost", grant });
    expect(takeoverChanceOf(target(), response({ destroyed: 1 }), null)).toBeNull();
    const camp = target({ kind: "wild", baseid: "2000241208" });
    expect(takeoverChanceOf(camp, response({ destroyed: 1 }), null)).toEqual({ kind: "camp", grant: null });
    expect(takeoverChanceOf(camp, response({}), { destroyed: 1 } as AttackSavePayload)).toEqual({
      kind: "camp",
      grant: null,
    });
    expect(takeoverChanceOf(camp, response({ destroyed: 0 }), null)).toBeNull();
    expect(takeoverChanceOf({ ...camp, mapversion: 1 }, response({ destroyed: 1 }), null)).toBeNull();
    const { cell: _cell, ...noCell } = camp;
    expect(takeoverChanceOf(noCell, response({ destroyed: 1 }), null)).toBeNull();
    expect(takeoverChanceOf(target({ kind: "main" }), response({ takeovergrant: grant }), null)).toBeNull();
  });
});
