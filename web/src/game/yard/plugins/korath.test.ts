// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, ChampionSaveEntry } from "@/api/types";
import { holdForEmergence } from "@/game/inferno/emergenceHold";
import { KORATH_UNLOCKED_LINE, KORATH_UNLOCKED_TITLE, korathStep, korathStepText } from "@/game/inferno/korathNotice";
import type { YardMounts } from "@/game/yard/yardPlugins";
import { korathPlugin, resetKorathPlugin } from "./korath";

/**
 * "Korath unlocked" (Inferno WP 5.2): the step the popup points at, from the
 * cage and the Chamber, and the plugin that shows it once on the main yard
 * when the load asks, at a quiet moment, then tells the server.
 */

const NOW = 1_800_000_000;
const CAGE = { id: 3, t: 114, X: 0, Y: 0, l: 1 };
const CHAMBER = { id: 9, t: 119, X: 100, Y: 0, l: 1 };

const gorgo = (overrides: Partial<ChampionSaveEntry> = {}): ChampionSaveEntry => ({
  t: 1,
  hp: 40_000,
  l: 1,
  ft: NOW + 3_600,
  fd: 0,
  fb: 0,
  pl: 1,
  status: 0,
  ...overrides,
});

const saveOf = (buildings: object[], champion: ChampionSaveEntry[] = [], korathNotice = true): BaseLoadResponse =>
  ({
    buildingdata: Object.fromEntries(buildings.map((one) => [String((one as { id: number }).id), one])),
    champion,
    infernostate: { korathUnlocked: true, korathNotice },
  }) as unknown as BaseLoadResponse;

describe("korathStep: where the popup sends the player (Flash's mm_goal1_completed1-4)", () => {
  it("no cage: build one; a cage still going up: wait", () => {
    expect(korathStep(saveOf([]))).toEqual({ kind: "buildCage" });
    expect(korathStep(saveOf([{ ...CAGE, cB: 500 }]))).toEqual({ kind: "cageBuilding" });
  });

  it("a free cage: open it; an egg in it: open it to cancel", () => {
    expect(korathStep(saveOf([CAGE]))).toEqual({ kind: "openCage", cage: 3 });
    expect(korathStep(saveOf([CAGE], [gorgo({ status: 3 })]))).toEqual({ kind: "egg", cage: 3 });
    // A juiced or frozen champion leaves the cage free.
    expect(korathStep(saveOf([CAGE], [gorgo({ status: 2 })]))).toEqual({ kind: "openCage", cage: 3 });
  });

  it("a champion in the cage: freeze it in the Chamber, or build one; named as the player named it", () => {
    expect(korathStep(saveOf([CAGE, CHAMBER], [gorgo()]))).toEqual({
      kind: "openChamber",
      chamber: 9,
      champion: "Gorgo",
    });
    expect(korathStep(saveOf([CAGE], [gorgo({ nm: " Bruno " })]))).toEqual({ kind: "buildChamber", champion: "Bruno" });
  });

  it("keeps every line short (the owner wants little text)", () => {
    const steps = [
      korathStep(saveOf([])),
      korathStep(saveOf([{ ...CAGE, cB: 500 }])),
      korathStep(saveOf([CAGE])),
      korathStep(saveOf([CAGE], [gorgo({ status: 3 })])),
      korathStep(saveOf([CAGE, CHAMBER], [gorgo()])),
      korathStep(saveOf([CAGE], [gorgo()])),
    ];
    for (const step of steps) {
      const { line, button } = korathStepText(step);
      expect(line.split(" ").length).toBeLessThanOrEqual(13);
      expect(button.length).toBeLessThanOrEqual(13);
    }
    expect(korathStepText({ kind: "openCage", cage: 3 })).toEqual({
      line: "Open your Champion Cage to raise him.",
      button: "Open Cage",
    });
  });
});

describe("the Korath plugin", () => {
  let modal: HTMLDivElement;
  const seen = vi.fn(async () => ({ error: 0 }));

  const mount = (save: BaseLoadResponse, kind = "main") => {
    const scene = {
      plannerOpen: () => false,
      carrying: () => false,
      focusBuilding: vi.fn(),
      openBuildMenu: vi.fn(),
    };
    const mounts = { store: { kind, save }, overlay: { modal }, scene } as unknown as YardMounts;
    const teardown = korathPlugin(mounts, seen);
    return { scene, teardown };
  };
  const title = () => modal.querySelector(".panel__title, h2")?.textContent ?? "";

  beforeEach(() => {
    vi.useFakeTimers();
    resetKorathPlugin();
    seen.mockClear();
    modal = document.createElement("div");
    document.body.append(modal);
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("shows once a moment after the main yard opens, and tells the server", () => {
    const { scene } = mount(saveOf([CAGE]));
    expect(modal.textContent).toBe("");
    vi.advanceTimersByTime(1_500);
    expect(title()).toContain(KORATH_UNLOCKED_TITLE);
    expect(modal.textContent).toContain(KORATH_UNLOCKED_LINE);
    expect(seen).toHaveBeenCalledTimes(1);

    const open = [...modal.querySelectorAll("button")].find((one) => one.textContent === "Open Cage");
    open!.click();
    expect(scene.focusBuilding).toHaveBeenCalledWith(3);
    expect(modal.querySelector(".popup-backdrop")).toBeNull();

    // The same tab opening the yard again on the same load: not again.
    mount(saveOf([CAGE]));
    vi.advanceTimersByTime(5_000);
    expect(modal.textContent).toBe("");
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("goes to the Build menu at the cage when there is none", () => {
    const { scene } = mount(saveOf([]));
    vi.advanceTimersByTime(1_500);
    [...modal.querySelectorAll("button")].find((one) => one.textContent === "Build Cage")!.click();
    expect(scene.openBuildMenu).toHaveBeenCalledWith(114);
  });

  it("does nothing when the load does not ask, on an outpost, or without an infernostate", () => {
    mount(saveOf([CAGE], [], false));
    mount(saveOf([CAGE]), "outpost");
    mount({ buildingdata: {} } as unknown as BaseLoadResponse);
    vi.advanceTimersByTime(5_000);
    expect(modal.textContent).toBe("");
    expect(seen).not.toHaveBeenCalled();
  });

  it("waits while another popup or Moloch's emergence is on screen", () => {
    const other = document.createElement("div");
    other.className = "popup-backdrop";
    document.body.append(other);
    const release = holdForEmergence();
    mount(saveOf([CAGE]));
    vi.advanceTimersByTime(3_000);
    expect(seen).not.toHaveBeenCalled();
    other.remove();
    vi.advanceTimersByTime(3_000);
    expect(seen).not.toHaveBeenCalled();
    release();
    vi.advanceTimersByTime(1_000);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(title()).toContain(KORATH_UNLOCKED_TITLE);
  });

  it("a yard closed before the moment comes shows nothing", () => {
    const { teardown } = mount(saveOf([CAGE]));
    teardown?.();
    vi.advanceTimersByTime(5_000);
    expect(seen).not.toHaveBeenCalled();
  });
});
