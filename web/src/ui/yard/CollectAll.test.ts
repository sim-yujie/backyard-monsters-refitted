// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import type { BankReport } from "@/api/yardBank";
import type { YardActionResult, YardStore, YardUiBinding } from "@/game/yard/YardStore";
import { Notices } from "@/ui/maproom/Notices";
import { spokenText } from "@/ui/resourceIcon";
import {
  COLLECT_EMPTY_LABEL,
  COLLECT_FULL_NOTE,
  CollectAll,
  collectRing,
  CollectState,
  showBankResult,
} from "./CollectAll";

/**
 * The yard's Collect all bubble (#171): the total waiting, the ring that fills
 * with the harvesters, one press, and what the notice says.
 */

const T0 = 1_800_000_000;

const harvester = (id: number, t: number, st: number): BuildingData => ({
  X: 0,
  Y: 0,
  id,
  t,
  st,
  pr: st >= 720 ? 0 : 1,
  ...(st < 720 && { cP: 10 }),
});

const reportOf = (banked: Partial<BankReport["banked"]>, left: Partial<BankReport["leftInBuffers"]> = {}): BankReport => ({
  banked: { r1: 0, r2: 0, r3: 0, r4: 0, ...banked },
  byBuilding: {},
  leftInBuffers: { r1: 0, r2: 0, r3: 0, r4: 0, ...left },
  skipped: [],
  points: 0,
});

describe("CollectAll", () => {
  let notices: Notices;
  let clock: number;
  let save: BaseLoadResponse;
  let run: ReturnType<typeof vi.fn>;
  let refresh: ReturnType<typeof vi.fn>;
  let binding: YardUiBinding;
  let collect: CollectAll;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    notices = new Notices().mount(document.body);
    clock = T0;
    save = {
      savetime: T0,
      currenttime: T0,
      buildingdata: { "1": harvester(1, 1, 720), "2": harvester(2, 4, 500) },
      buildinghealthdata: {},
      storedata: {},
    } as unknown as BaseLoadResponse;
    run = vi.fn();
    refresh = vi.fn();
    const store = {
      get save() {
        return save;
      },
      resources: { r1: 100, r2: 100, r3: 100, r4: 100 },
      caps: { r1: 1_000, r2: 1_000, r3: 1_000, r4: 1_000 },
      now: () => clock,
      isRunning: () => false,
      run,
      refresh,
    };
    binding = { store: store as unknown as YardStore, scene: { selectBuilding: () => {} }, notices };
    collect = new CollectAll();
    document.body.append(collect.element);
  });

  afterEach(() => {
    collect.destroy();
    notices.destroy();
    vi.useRealTimers();
  });

  const button = (): HTMLButtonElement => collect.element.querySelector("button")!;
  const amount = (): string => collect.element.querySelector(".yard-collect__amount")!.textContent ?? "";
  const fill = (): string => collect.element.style.getPropertyValue("--collect-fill");

  it("is hidden until the own yard binds it, and again on unbind", () => {
    expect(collect.element.hidden).toBe(true);
    collect.bind(binding);
    expect(collect.element.hidden).toBe(false);
    expect(collect.state).toBe(CollectState.READY);
    expect(amount()).toBe("1.2K");
    expect(button().textContent).toBe("1.2KCollect all");
    expect(button().title).toBe("Collect everything your harvesters hold:\nTwigs 720\nGoo 500");
    expect(button().getAttribute("aria-label")).toBe("Collect all: 1,220 waiting in your harvesters.");
    // The collect glyph (#198), decorative inside the named button.
    const glyph = collect.element.querySelector<HTMLElement>(".yard-collect__icons")!;
    expect(glyph.hidden).toBe(false);
    expect(glyph.getAttribute("aria-hidden")).toBe("true");
    expect(glyph.querySelectorAll("svg.yard-collect__glyph")).toHaveLength(1);
    expect(glyph.querySelectorAll(".res-icon")).toHaveLength(0);
    collect.bind(null);
    expect(collect.element.hidden).toBe(true);
    expect(collect.state).toBeNull();
  });

  it("fills its ring with the harvesters and counts up once a second", () => {
    collect.bind(binding);
    expect(fill()).toBe("84.72%");
    clock = T0 + 3600;
    vi.advanceTimersByTime(1_000);
    expect(amount()).toBe("1.4K");
    expect(fill()).toBe("100%");
  });

  it("asks the server nothing from its per-second refresh, however long the buffers fill", () => {
    collect.bind(binding);
    for (let second = 1; second <= 6 * 3600; second++) {
      clock = T0 + second;
      vi.advanceTimersByTime(1_000);
    }
    expect(run).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(amount()).toBe("1.4K");
  });

  it("shrinks to an empty ring that cannot be pressed when nothing waits, and wobbles once it fills", () => {
    save = {
      ...save,
      buildingdata: { "1": { X: 0, Y: 0, id: 1, t: 1, st: 0, pr: 1 } },
    } as unknown as BaseLoadResponse;
    collect.bind(binding);
    expect(collect.element.hidden).toBe(false);
    expect(collect.state).toBe(CollectState.EMPTY);
    expect(collect.element.dataset["state"]).toBe("empty");
    expect(amount()).toBe("");
    // The small empty ring carries no glyph either.
    expect(collect.element.querySelector<HTMLElement>(".yard-collect__icons")!.hidden).toBe(true);
    expect(button().disabled).toBe(true);
    expect(button().getAttribute("aria-label")).toBe(COLLECT_EMPTY_LABEL);
    expect(collect.element.classList.contains("yard-collect--wobble")).toBe(false);

    clock = T0 + 3600;
    vi.advanceTimersByTime(1_000);
    expect(collect.state).toBe(CollectState.READY);
    expect(button().disabled).toBe(false);
    expect(collect.element.classList.contains("yard-collect--wobble")).toBe(true);
    collect.element.dispatchEvent(new Event("animationend"));
    expect(collect.element.classList.contains("yard-collect--wobble")).toBe(false);
  });

  it("turns amber and says so when a silo the bank would fill is full", () => {
    (binding.store as unknown as { resources: Record<string, number> }).resources = {
      r1: 1_000,
      r2: 0,
      r3: 0,
      r4: 0,
    };
    collect.bind(binding);
    expect(collect.state).toBe(CollectState.FULL);
    expect(button().title).toContain(COLLECT_FULL_NOTE);
    expect(button().getAttribute("aria-label")).toContain(COLLECT_FULL_NOTE);
  });

  it("banks everything in one request and says what was collected", async () => {
    run.mockResolvedValue({ ok: true, report: reportOf({ r1: 720, r4: 500 }), completed: [] });
    collect.bind(binding);
    button().click();
    await vi.runAllTicks();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0].key).toBe("bank:all");
    const notice = document.querySelector(".notice")!;
    expect(spokenText(notice)).toContain("Collected Twigs 720 Goo 500.");
  });

  it("throws the balls on the press and hands the answer over after (#208)", async () => {
    const answer = vi.fn();
    const startBank = vi.fn(() => answer);
    let resolve!: (result: YardActionResult<BankReport>) => void;
    run.mockReturnValue(new Promise((done) => (resolve = done)));
    collect.bind({ ...binding, scene: { selectBuilding: () => {}, startBank } });
    button().click();
    // Before the server says anything: what the two harvesters hold.
    expect(startBank).toHaveBeenCalledWith({
      "1": { resource: "r1", amount: 720 },
      "2": { resource: "r4", amount: 500 },
    });
    expect(answer).not.toHaveBeenCalled();

    resolve({ ok: true, report: reportOf({ r1: 720, r4: 450 }), completed: [] });
    await vi.runAllTicks();
    await Promise.resolve();
    expect(answer).toHaveBeenCalledWith({ banked: { r1: 720, r2: 0, r3: 0, r4: 450 } });
  });

  it("hands a refusal over as nothing banked", async () => {
    const answer = vi.fn();
    run.mockResolvedValue({ ok: false, refusal: { reason: "error", message: "No.", detail: {} } });
    collect.bind({ ...binding, scene: { selectBuilding: () => {}, startBank: () => answer } });
    button().click();
    await vi.runAllTicks();
    await Promise.resolve();
    expect(answer).toHaveBeenCalledWith(null);
  });
});

describe("collectRing", () => {
  const save = (buildingdata: Record<string, BuildingData>): BaseLoadResponse =>
    ({ savetime: T0, currenttime: T0, buildingdata, buildinghealthdata: {}, storedata: {} }) as unknown as BaseLoadResponse;

  it("fills with what the harvesters hold of what they can hold", () => {
    const one = collectRing(save({ "1": harvester(1, 1, 360), "2": harvester(2, 4, 0) }), T0);
    expect(one.total).toBe(360);
    expect(one.fraction).toBe(0.25);
    expect(one.state).toBe(CollectState.READY);
    expect(collectRing(save({ "1": harvester(1, 1, 720) }), T0).fraction).toBe(1);
  });

  it("is empty with nothing to collect, and with no harvesters at all", () => {
    expect(collectRing(save({}), T0)).toMatchObject({ total: 0, fraction: 0, state: CollectState.EMPTY });
    const idle = { X: 0, Y: 0, id: 1, t: 1, st: 0, pr: 1 } as BuildingData;
    expect(collectRing(save({ "1": idle }), T0).state).toBe(CollectState.EMPTY);
  });

  it("leaves out a harvester whose upgrade is running: it neither fills nor banks", () => {
    const upgrading = { ...harvester(2, 4, 720), cU: 600 } as BuildingData;
    const ring = collectRing(save({ "1": harvester(1, 1, 360), "2": upgrading }), T0);
    expect(ring.total).toBe(360);
    expect(ring.fraction).toBe(0.5);
  });

  it("is full only when a silo for something waiting is at its cap", () => {
    const yard = save({ "1": harvester(1, 1, 360) });
    const caps = { r1: 1_000, r2: 1_000, r3: 1_000, r4: 1_000 };
    expect(collectRing(yard, T0, { r1: 999 }, caps).state).toBe(CollectState.READY);
    expect(collectRing(yard, T0, { r1: 1_000 }, caps).state).toBe(CollectState.FULL);
    // A full goo silo does not matter while only twigs wait.
    expect(collectRing(yard, T0, { r1: 0, r4: 5_000 }, caps).state).toBe(CollectState.READY);
    // Without caps (before the first state answer) it cannot be full.
    expect(collectRing(yard, T0, { r1: 5_000 }, null).state).toBe(CollectState.READY);
  });
});

describe("showBankResult", () => {
  let notices: Notices;

  beforeEach(() => {
    document.body.replaceChildren();
    notices = new Notices().mount(document.body);
  });

  afterEach(() => notices.destroy());

  const text = (): string => spokenText(document.querySelector(".notice") ?? document.createElement("i"));

  it("warns when storage kept some in the harvesters", () => {
    showBankResult(notices, { ok: true, report: reportOf({ r1: 280 }, { r1: 440 }), completed: [] });
    expect(document.querySelector(".notice--warning")).not.toBeNull();
    expect(text()).toContain("Collected Twigs 280. Twigs 440 stayed in your harvesters: storage is full.");
  });

  it("says a server refusal, but not a local nothing-to-collect", () => {
    const empty: YardActionResult<BankReport> = {
      ok: false,
      refusal: { reason: "empty", message: "Nothing.", detail: {}, local: true },
    };
    showBankResult(notices, empty);
    expect(document.querySelector(".notice")).toBeNull();
    showBankResult(notices, {
      ok: false,
      refusal: { reason: "network", message: "Could not reach the server.", detail: {} },
    });
    expect(text()).toContain("Could not reach the server.");
  });
});
