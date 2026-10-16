// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import { YardStore } from "@/game/yard/YardStore";
import type { Notices } from "@/ui/maproom/Notices";
import { askForWorker, openWorkersBusyBox, workersBusyModel, workersBusyText } from "./WorkersBusyBox";

const T0 = 2_000_000;
const never = <R>() => new Promise<R>(() => undefined);

const setup = (left: number, credits = 1_000, kind: "main" | "outpost" = "main") => {
  const store = new YardStore({
    save: {
      error: 0,
      currenttime: T0,
      savetime: T0,
      resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
      credits,
      buildingdata: {
        "0": { id: 0, t: 14, X: 0, Y: 0, l: 5 },
        "2": { id: 2, t: 20, X: 4, Y: 4, l: 4, cU: left },
      },
      buildinghealthdata: {},
      storedata: {},
      lockerdata: {},
    } as unknown as BaseLoadResponse,
    ...(kind === "outpost" ? { target: { baseid: "9", kind: "outpost" } as const } : {}),
    api: { state: vi.fn(() => never<YardResponse<null>>()) } as unknown as YardApi,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  return store;
};

afterEach(() => document.body.replaceChildren());

describe("workersBusyModel", () => {
  it("offers the next worker and the finish of the soonest job at its Shiny price", () => {
    const model = workersBusyModel(setup(5_400));
    expect(model.buyWorker).toEqual({ price: 250, blocked: null });
    expect(model.finish).toMatchObject({ buildingId: 2, item: "SP4", blocked: null });
    expect(model.finish!.price).toBeGreaterThan(0);
  });

  it("offers the free finish in the last five minutes", () => {
    expect(workersBusyModel(setup(120)).finish).toMatchObject({ item: "SP1", price: 0 });
  });

  it("says when Shiny is short, and sells no worker in an outpost", () => {
    const poor = workersBusyModel(setup(5_400, 10));
    expect(poor.buyWorker?.blocked).toBe("Not enough Shiny.");
    expect(poor.finish?.blocked).toBe("Not enough Shiny.");
    expect(workersBusyModel(setup(5_400, 1_000, "outpost")).buyWorker).toBeNull();
  });

  it("words the box for one worker and for many", () => {
    expect(workersBusyText(1)).toContain("Your worker is busy");
    expect(workersBusyText(3)).toContain("All 3 of your workers are busy");
  });
});

describe("openWorkersBusyBox", () => {
  it("opens with both choices and closes after a finish, then frees the action", async () => {
    const store = setup(120);
    const speedUp = vi.spyOn(store, "speedUp").mockResolvedValue({ ok: true, report: {} as never, completed: [] });
    const onFreed = vi.fn();
    const popup = openWorkersBusyBox({ store, scene: { selectBuilding: vi.fn() }, notices: {} as Notices }, onFreed);

    expect(document.body.querySelector(".workers-busy")).not.toBeNull();
    const buttons = [...popup.body.querySelectorAll("button")];
    expect(buttons.map((one) => one.textContent)).toEqual([expect.stringContaining("Buy a worker"), "Finish soonest job free"]);

    buttons[1]!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(speedUp).toHaveBeenCalledWith(2, "SP1");
    expect(onFreed).toHaveBeenCalled();
    expect(document.body.querySelector(".workers-busy")).toBeNull();
  });

  it("names each Shiny button once, as it reads on screen", () => {
    const popup = openWorkersBusyBox({ store: setup(5_400), scene: { selectBuilding: vi.fn() }, notices: {} as Notices });
    const names = [...popup.body.querySelectorAll("button")].map((one) => one.getAttribute("aria-label"));
    expect(names).toEqual(["Buy a worker, 250 Shiny", expect.stringMatching(/^Finish soonest job, \d+ Shiny$/)]);
  });

  const freeFinish = (): HTMLButtonElement =>
    [...document.body.querySelectorAll<HTMLButtonElement>(".workers-busy button")].find(
      (one) => one.textContent === "Finish soonest job free",
    )!;
  const binding = (store: YardStore) => ({ store, scene: { selectBuilding: vi.fn() }, notices: {} as Notices });

  it("closed with every worker still busy: onDismissed, never onFreed", () => {
    const onFreed = vi.fn();
    const onDismissed = vi.fn();
    const popup = openWorkersBusyBox(binding(setup(5_400)), onFreed, onDismissed);
    popup.close();
    expect(onDismissed).toHaveBeenCalledTimes(1);
    expect(onFreed).not.toHaveBeenCalled();
  });

  it("a failed finish keeps the box up with the reason, and frees nothing", async () => {
    const store = setup(120);
    vi.spyOn(store, "speedUp").mockResolvedValue({ ok: false, refusal: { reason: "credits", message: "Not enough Shiny." } } as never);
    const onFreed = vi.fn();
    const onDismissed = vi.fn();
    const popup = openWorkersBusyBox(binding(store), onFreed, onDismissed);
    freeFinish().click();
    await Promise.resolve();
    await Promise.resolve();
    expect(popup.body.querySelector(".workers-busy__status")?.textContent).toBe("Not enough Shiny.");
    expect(document.body.querySelector(".workers-busy")).not.toBeNull();
    expect(onFreed).not.toHaveBeenCalled();
    expect(onDismissed).not.toHaveBeenCalled();
  });

  it("a job ending on its own while the box is up frees the action once", async () => {
    const store = setup(5_400);
    let listener: (() => void) | null = null;
    vi.spyOn(store, "subscribe").mockImplementation((one) => {
      listener = one as () => void;
      return () => (listener = null);
    });
    const onFreed = vi.fn();
    const onDismissed = vi.fn();
    openWorkersBusyBox(binding(store), onFreed, onDismissed);
    expect(listener).not.toBeNull();
    vi.spyOn(store, "workers", "get").mockReturnValue({ total: 1, busy: 0 });
    listener!();
    expect(onFreed).toHaveBeenCalledTimes(1);
    expect(onDismissed).not.toHaveBeenCalled();
    expect(document.body.querySelector(".workers-busy")).toBeNull();
    // Closed, so it stopped listening.
    expect(listener).toBeNull();
  });

  it("askForWorker answers true once a worker is free, false when closed", async () => {
    const store = setup(120);
    vi.spyOn(store, "speedUp").mockResolvedValue({ ok: true, report: {} as never, completed: [] });
    const freed = askForWorker(binding(store));
    freeFinish().click();
    await expect(freed).resolves.toBe(true);

    const closed = askForWorker(binding(setup(5_400)));
    document.body.querySelector<HTMLButtonElement>(".workers-busy [aria-label='Close']")!.click();
    await expect(closed).resolves.toBe(false);
  });
});
