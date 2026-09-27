// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import type { BankReport } from "@/api/yardBank";
import type { YardActionResult, YardStore, YardUiBinding } from "@/game/yard/YardStore";
import { Notices } from "@/ui/maproom/Notices";
import { spokenText } from "@/ui/resourceIcon";
import { CollectAll, collectAllLabel, showBankResult } from "./CollectAll";

/** The HUD's Collect all button: the total waiting, one press, and what the notice says. */

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

  it("is hidden until the own yard binds it, and again on unbind", () => {
    expect(collect.element.hidden).toBe(true);
    collect.bind(binding);
    expect(collect.element.hidden).toBe(false);
    expect(button().textContent).toBe("Collect all · 1.2K");
    expect(button().title).toBe("Collect everything your harvesters hold:\nTwigs 720\nGoo 500");
    collect.bind(null);
    expect(collect.element.hidden).toBe(true);
  });

  it("counts up once a second as the buffers fill", () => {
    collect.bind(binding);
    clock = T0 + 3600;
    vi.advanceTimersByTime(1_000);
    expect(button().textContent).toBe(collectAllLabel(1440));
  });

  it("asks the server nothing from its per-second refresh, however long the buffers fill", () => {
    collect.bind(binding);
    for (let second = 1; second <= 6 * 3600; second++) {
      clock = T0 + second;
      vi.advanceTimersByTime(1_000);
    }
    expect(run).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(button().textContent).toBe(collectAllLabel(1440));
  });

  it("is hidden when nothing waits", () => {
    save = { ...save, buildingdata: { "1": harvester(1, 1, 0) } } as BaseLoadResponse;
    collect.bind(binding);
    expect(collect.element.hidden).toBe(true);
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
