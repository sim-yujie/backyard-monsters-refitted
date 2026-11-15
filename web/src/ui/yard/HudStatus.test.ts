// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import { levelProgress } from "@/game/yard/experience";
import { YardStore } from "@/game/yard/YardStore";
import type { Notices } from "@/ui/maproom/Notices";
import { HudStatus, boostIcon, hudStatusModel, shortTime } from "./HudStatus";

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
  it("reads protection and running boosts, soonest first", () => {
    const model = hudStatusModel(
      storeWith({
        protected: T0 + 90_000,
        storedata: { BST: { q: 1, e: T0 + 7_200 }, POD: { q: 1, e: T0 + 600 } },
      } as Partial<BaseLoadResponse>),
    );
    expect(model.protectedUntil).toBe(T0 + 90_000);
    expect(model.boosts.map((boost) => boost.item)).toEqual(["POD", "BST"]);
  });

  it("shows nothing for an unprotected yard", () => {
    expect(hudStatusModel(storeWith())).toEqual({ protectedUntil: null, boosts: [] });
  });

  it("shortens a time to its first unit for the strip", () => {
    expect(shortTime(90_000)).toBe("1d");
    expect(shortTime(3_700)).toBe("1h");
    expect(shortTime(45)).toBe("45s");
  });

  it("gives each boost a painted icon", () => {
    expect(boostIcon("POD")).toBe("overdrive");
    expect(boostIcon("MSOD")).toBe("speed");
    expect(boostIcon("BST")).toBe("tools");
  });
});

describe("HudStatus", () => {
  it("draws the strip, and a level gained opens the level-up box once", async () => {
    const store = storeWith({ protected: T0 + 3_700, playerlevel: 1, playerpoints: 100 } as Partial<BaseLoadResponse>);
    const status = new HudStatus({ store, scene: { selectBuilding: vi.fn() }, notices: {} as Notices });
    document.body.append(status.element);

    const shield = status.element.querySelector<HTMLButtonElement>(".hud-status__shield");
    expect(shield?.textContent).toBe("1h");
    expect(shield?.getAttribute("aria-label")).toBe("Protected 1h 1m");
    expect(status.element.querySelector<HTMLElement>(".hud-status__boosts")?.hidden).toBe(true);

    store.mergeWrite({ playerlevel: 2, playerpoints: 1_000 } as Partial<BaseLoadResponse>);
    expect(document.body.querySelector(".level-up")?.textContent).toContain("You reached level 2!");

    status.destroy();
  });

  it("holds the level-up box while Bob's guided start runs, then shows the level reached", () => {
    const guide = (state: string, step = "build-housing") => ({ onboarding: { guide: { state, step } } });
    const store = storeWith({ playerlevel: 1, playerpoints: 100, ...guide("active") } as unknown as Partial<BaseLoadResponse>);
    const status = new HudStatus({ store, scene: { selectBuilding: vi.fn() }, notices: {} as Notices });

    // Finish now on the Sniper Tower: level 2, with Bob still pointing at Build.
    store.mergeWrite({ playerlevel: 2, playerpoints: 1_000 } as Partial<BaseLoadResponse>);
    expect(document.body.querySelector(".level-up")).toBeNull();

    store.mergeWrite({ playerlevel: 3, playerpoints: 3_600 } as Partial<BaseLoadResponse>);
    expect(document.body.querySelector(".level-up")).toBeNull();

    // The guide ends: one box, for the level reached.
    store.mergeWrite(guide("done") as unknown as Partial<BaseLoadResponse>);
    const boxes = document.body.querySelectorAll(".level-up");
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.textContent).toContain("You reached level 3!");

    store.mergeWrite({ playerpoints: 3_700 } as Partial<BaseLoadResponse>);
    expect(document.body.querySelectorAll(".level-up")).toHaveLength(1);
    status.destroy();
  });

  it("shows a level gained before the guide's first line once the guide is skipped", () => {
    const guide = (state: string) => ({ onboarding: { guide: { state, step: "welcome" } } });
    const store = storeWith({ playerlevel: 1, playerpoints: 100, ...guide("pending") } as unknown as Partial<BaseLoadResponse>);
    const status = new HudStatus({ store, scene: { selectBuilding: vi.fn() }, notices: {} as Notices });

    store.mergeWrite({ playerlevel: 2, playerpoints: 1_000 } as Partial<BaseLoadResponse>);
    expect(document.body.querySelector(".level-up")).toBeNull();
    store.mergeWrite(guide("skipped") as unknown as Partial<BaseLoadResponse>);
    expect(document.body.querySelector(".level-up")?.textContent).toContain("You reached level 2!");
    status.destroy();
  });

  it("does not announce the level the yard opened with", () => {
    const store = storeWith({ playerlevel: 4, playerpoints: 6_000 } as Partial<BaseLoadResponse>);
    const status = new HudStatus({ store, scene: { selectBuilding: vi.fn() }, notices: {} as Notices });
    expect(document.body.querySelector(".level-up")).toBeNull();
    status.destroy();
  });

  it("folds every boost into one button with a count; a tap lists their names and times", () => {
    const store = storeWith({
      storedata: { BST: { q: 1, e: T0 + 7_200 }, POD: { q: 1, e: T0 + 600 }, MSOD: { q: 1, e: T0 + 90_000 } },
    } as Partial<BaseLoadResponse>);
    const status = new HudStatus({ store, scene: { selectBuilding: vi.fn() }, notices: {} as Notices });
    document.body.append(status.element);

    // Unprotected: no shield; three boosts: one button saying 3.
    expect(status.element.querySelector<HTMLElement>(".hud-status__shield")?.hidden).toBe(true);
    const boosts = status.element.querySelector<HTMLButtonElement>(".hud-status__boosts")!;
    expect(boosts.hidden).toBe(false);
    expect(boosts.querySelector(".hud-status__count")?.textContent).toBe("3");
    expect(boosts.getAttribute("aria-label")).toBe("3 boosts running");
    expect(status.element.querySelectorAll("button")).toHaveLength(2);

    const list = status.element.querySelector<HTMLElement>(".hud-status__list")!;
    expect(list.hidden).toBe(true);
    boosts.click();
    expect(list.hidden).toBe(false);
    expect(boosts.getAttribute("aria-expanded")).toBe("true");
    const rows = [...list.querySelectorAll(".hud-status__row")];
    expect(rows.map((row) => row.querySelector(".hud-status__title")?.textContent)).toEqual([
      "Production Overdrive",
      "Sharper Tools",
      "Monster Speed Buff",
    ]);
    expect(rows.map((row) => row.querySelector(".hud-status__left")?.textContent)).toEqual(["10m 0s", "2h 0m", "1d 1h"]);

    // A press elsewhere shuts it; so does Escape, and another tap.
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(list.hidden).toBe(true);
    boosts.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(list.hidden).toBe(true);
    boosts.click();
    boosts.click();
    expect(list.hidden).toBe(true);
    status.destroy();
  });

  it("the shield opens protection's exact time, and an open list shuts when its subject ends", () => {
    const store = storeWith({ protected: T0 + 90_000, storedata: { BST: { q: 1, e: T0 + 7_200 } } } as Partial<BaseLoadResponse>);
    const status = new HudStatus({ store, scene: { selectBuilding: vi.fn() }, notices: {} as Notices });
    document.body.append(status.element);
    const shield = status.element.querySelector<HTMLButtonElement>(".hud-status__shield")!;
    const list = status.element.querySelector<HTMLElement>(".hud-status__list")!;
    shield.click();
    expect(status.openList).toBe("shield");
    expect(list.querySelector(".hud-status__left")?.textContent).toBe("1d 1h");

    // Over to the boosts: the same list, now the boost.
    status.element.querySelector<HTMLButtonElement>(".hud-status__boosts")!.click();
    expect(status.openList).toBe("boosts");
    expect(shield.getAttribute("aria-expanded")).toBe("false");
    expect(list.querySelector(".hud-status__title")?.textContent).toBe("Sharper Tools");

    // The last boost gone: the button and its list go.
    store.mergeWrite({ storedata: {} } as Partial<BaseLoadResponse>);
    expect(status.element.querySelector<HTMLElement>(".hud-status__boosts")?.hidden).toBe(true);
    expect(list.hidden).toBe(true);
    expect(status.openList).toBeNull();
    status.destroy();
  });
});
