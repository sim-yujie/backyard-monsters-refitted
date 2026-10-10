// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import { YardStore } from "@/game/yard/YardStore";
import type { Notices } from "@/ui/maproom/Notices";
import { openWorkersBusyBox, workersBusyModel, workersBusyText } from "./WorkersBusyBox";

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
});
