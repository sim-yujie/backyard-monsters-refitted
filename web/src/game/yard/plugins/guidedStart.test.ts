// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Container } from "pixi.js";
import type { Onboarding } from "@/api/types";
import { guideBus } from "@/game/guide/guideBus";
import { GUIDE_BUILDS, LINES } from "@/game/guide/steps";
import { clearCanvasTargets } from "@/game/guide/targets";
import { guideTourAvailable } from "@/game/guide/tour";
import type { YardMounts } from "@/game/yard/yardPlugins";
import { GuidedStartRunner } from "./guidedStart";

/**
 * The own yard's guided start runner (issue #227, `docs/design/tutorial.md`
 * §2): Bob follows the server's step, works out the micro step from the
 * screen, and calls the guide's routes, through a stand-in store.
 */

interface Building {
  id: number;
  type: number;
  x: number;
  y: number;
  footprint: [number, number];
  countdown: { kind: string } | null;
}

const harness = (onboarding: Onboarding, buildings: Building[] = []) => {
  const listeners = new Set<() => void>();
  const sent: string[] = [];
  let selected: number | null = null;
  const store = {
    kind: "main",
    save: { onboarding, name: "zz_tut" },
    yard: { buildings, bounds: { yardWidth: 1200, yardHeight: 1200 } },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    building: (id: number) => buildings.find((one) => one.id === id) ?? null,
    refresh: vi.fn(async () => ({ ok: true })),
    run: vi.fn(async (action: { key: string }) => {
      sent.push(action.key);
      return { ok: true, report: { added: 15, housed: 15, retry: false, step: "build-maproom" }, completed: [] };
    }),
  };
  const guide = document.createElement("div");
  document.body.append(guide);
  const scene = {
    openBuildMenu: vi.fn(),
    closeBuildMenu: vi.fn(),
    focusBuilding: vi.fn(),
    closePanel: vi.fn(),
    selectedBuilding: () => selected,
    openMap: vi.fn(),
    openMonsters: vi.fn(),
    openShop: vi.fn(),
    centreOn: vi.fn(),
    plannerOpen: () => false,
    carrying: () => false,
  };
  const mounts = {
    store,
    overlay: { guide },
    scene,
    renderer: { root: new Container(), yardToWorld: (x: number, y: number) => ({ x, y }) },
  } as unknown as YardMounts;
  const runner = new GuidedStartRunner(mounts);
  runner.start();
  runners.push(runner);
  const setStep = (next: Onboarding) => {
    store.save.onboarding = next;
    for (const listener of listeners) listener();
  };
  return {
    runner,
    store,
    guide,
    sent,
    scene,
    setStep,
    select: (id: number | null) => {
      selected = id;
      guideBus.emit("panel", { building: id === null ? null : { id, type: 21 } });
    },
  };
};

const runners: GuidedStartRunner[] = [];

const at = (step: string, extra: Partial<Onboarding["guide"]> = {}): Onboarding => ({
  guide: { state: "active", step, ...extra },
  camp: "none",
  goalsReady: 0,
  tips: {},
});

const text = (guide: HTMLElement) => guide.querySelector(".guide-bob__text")?.textContent ?? "";
const primary = (guide: HTMLElement) => guide.querySelector<HTMLButtonElement>(".guide-bob__action.btn--primary");
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

afterEach(() => {
  while (runners.length) runners.pop()?.destroy();
  guideBus.clear();
  clearCanvasTargets();
  document.body.replaceChildren();
});

describe("the guided start runner", () => {
  it("welcomes a new account by name; Next starts the guide", async () => {
    const { guide, sent } = harness({ guide: { state: "pending" }, camp: "none", goalsReady: 0, tips: {} });
    expect(text(guide)).toBe(LINES.welcome("zz_tut"));
    primary(guide)!.click();
    await settle();
    expect(sent).toEqual(["guide:welcome"]);
  });

  it("walks the build step from the dock button into the menu", () => {
    const { guide } = harness(at("build-sniper"));
    const lines = GUIDE_BUILDS["build-sniper"]!.lines;
    expect(text(guide)).toBe(lines.open);
    guideBus.emit("buildMenu", { open: true });
    expect(text(guide)).toBe(lines.tab);
    guideBus.emit("buildMenu", { open: false });
    expect(text(guide)).toBe(lines.open);
  });

  it("finish: tap the building, then Bob's own free Finish now", async () => {
    const tower: Building = { id: 7, type: 21, x: 300, y: -300, footprint: [70, 70], countdown: { kind: "build" } };
    const { guide, sent, select, scene } = harness(at("finish-sniper", { building: 7 }), [tower]);
    expect(text(guide)).toBe(GUIDE_BUILDS["build-sniper"]!.lines.finishTap);
    select(7);
    expect(text(guide)).toBe(GUIDE_BUILDS["build-sniper"]!.lines.finishNow);
    expect(primary(guide)!.getAttribute("data-tut")).toBe("guide-finish");
    primary(guide)!.click();
    await settle();
    expect(sent).toEqual(["guide-finish:7"]);
    expect(scene.closePanel).toHaveBeenCalled();
  });

  it("asks for the Pokeys once at the pokeys step, then says his line until Next", async () => {
    const housing: Building = { id: 8, type: 15, x: 300, y: 100, footprint: [80, 80], countdown: null };
    const { guide, sent, setStep } = harness(at("pokeys"), [housing]);
    await settle();
    expect(sent).toEqual(["guide:army"]);
    setStep(at("build-maproom"));
    expect(text(guide)).toBe(LINES.pokeys);
    primary(guide)!.click();
    expect(text(guide)).toBe(GUIDE_BUILDS["build-maproom"]!.lines.open);
  });

  it("Skip asks first, and skips only when confirmed", async () => {
    const { guide, sent } = harness(at("collect"));
    guide.querySelector<HTMLButtonElement>(".guide-bob__skip")!.click();
    expect(text(guide)).toBe(LINES.skipAsk);
    const keep = [...guide.querySelectorAll<HTMLButtonElement>(".guide-bob__action")].find(
      (button) => button.textContent === "Keep going",
    )!;
    keep.click();
    expect(text(guide)).toBe(LINES.collect);
    guide.querySelector<HTMLButtonElement>(".guide-bob__skip")!.click();
    primary(guide)!.click();
    await settle();
    expect(sent).toEqual(["guide:skip"]);
  });

  it("is silent when the guide is over, and offers Help's tour instead", () => {
    const { guide } = harness({ guide: { state: "done" }, camp: "none", goalsReady: 0, tips: {} });
    expect(guide.querySelector<HTMLElement>(".guide-bob")?.hidden ?? true).toBe(true);
    expect(guideTourAvailable()).toBe(true);
  });

  it("offers no tour while the guide runs", () => {
    harness(at("collect"));
    expect(guideTourAvailable()).toBe(false);
  });

  it("steps out of the way while the Goals panel is open", () => {
    const { guide } = harness(at("finish-now"));
    expect(text(guide)).toBe(LINES.finishNow);
    const root = document.createElement("div");
    document.body.append(root);
    guideBus.emit("screen", { id: "goals" as never, root, header: null });
    expect(guide.querySelector<HTMLElement>(".guide-bob")?.hidden).toBe(true);
  });
});
