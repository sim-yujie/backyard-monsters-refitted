// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import { levelProgress } from "@/game/yard/experience";
import { YardStore } from "@/game/yard/YardStore";
import type { Notices } from "@/ui/maproom/Notices";
import { HudStatus, hudStatusModel, protectionBadgeText, xpTitle } from "./HudStatus";

const T0 = 2_000_000;
const never = <R>() => new Promise<R>(() => undefined);

const storeWith = (extra: Partial<BaseLoadResponse> = {}) =>
  new YardStore({
    save: {
      error: 0,
      currenttime: T0,
      savetime: T0,
      resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
      credits: 0,
      buildingdata: { "0": { id: 0, t: 14, X: 0, Y: 0, l: 3 } },
      buildinghealthdata: {},
      storedata: {},
      lockerdata: {},
      ...extra,
    } as unknown as BaseLoadResponse,
    api: { state: vi.fn(() => never<YardResponse<null>>()) } as unknown as YardApi,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("levelProgress", () => {
  it("measures the way across a level", () => {
    expect(levelProgress(1, 450)).toMatchObject({ floor: 0, next: 900, fraction: 0.5 });
    expect(levelProgress(2, 900).fraction).toBe(0);
    expect(levelProgress(56, 9e13)).toMatchObject({ next: null, fraction: 1 });
  });
});

describe("hudStatusModel", () => {
  it("reads protection, level points and running boosts, soonest first", () => {
    const model = hudStatusModel(
      storeWith({
        protected: T0 + 90_000,
        playerlevel: 2,
        playerpoints: 1_000,
        storedata: { BST: { q: 1, e: T0 + 7_200 }, POD: { q: 1, e: T0 + 600 } },
      } as Partial<BaseLoadResponse>),
    );
    expect(model.protectedUntil).toBe(T0 + 90_000);
    expect(model.xp).toMatchObject({ level: 2, points: 1_000, next: 3_500 });
    expect(model.boosts.map((boost) => boost.item)).toEqual(["POD", "BST"]);
  });

  it("shows nothing for an unprotected yard from a server that sends no level", () => {
    expect(hudStatusModel(storeWith())).toEqual({ protectedUntil: null, xp: null, boosts: [] });
  });

  it("words the badge and the bar's tooltip", () => {
    expect(protectionBadgeText(T0 + 90_000, T0)).toBe("Protected 1d 1h");
    expect(xpTitle(levelProgress(1, 400))).toBe("Level 1. 400 points, 500 more for level 2.");
  });
});

describe("HudStatus", () => {
  it("draws the strip, and a level gained opens the level-up box once", async () => {
    const store = storeWith({ protected: T0 + 3_700, playerlevel: 1, playerpoints: 100 } as Partial<BaseLoadResponse>);
    const status = new HudStatus({ store, scene: { selectBuilding: vi.fn() }, notices: {} as Notices });
    document.body.append(status.element);

    expect(status.element.querySelector(".hud-status__badge")?.textContent).toBe("Protected 1h 1m");
    expect(status.element.querySelector(".hud-status__level")?.textContent).toBe("Level 1");

    store.mergeWrite({ playerlevel: 2, playerpoints: 1_000 } as Partial<BaseLoadResponse>);
    expect(status.element.querySelector(".hud-status__level")?.textContent).toBe("Level 2");
    expect(document.body.querySelector(".level-up")?.textContent).toContain("You reached level 2!");

    status.destroy();
  });

  it("does not announce the level the yard opened with", () => {
    const store = storeWith({ playerlevel: 4, playerpoints: 6_000 } as Partial<BaseLoadResponse>);
    const status = new HudStatus({ store, scene: { selectBuilding: vi.fn() }, notices: {} as Notices });
    expect(document.body.querySelector(".level-up")).toBeNull();
    status.destroy();
  });
});
