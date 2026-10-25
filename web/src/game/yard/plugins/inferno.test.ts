// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InfernoLoadState, MolochRaidView } from "@/api/inferno";
import type * as RaidModule from "@/api/raid";
import type { RaidResult } from "@/api/raid";
import { SCREEN_SHAKE_KEY } from "@/game/attack/juice";
import { emergencePlaying } from "@/game/inferno/emergenceHold";
import {
  CAVERN_DEFENCE,
  CAVERN_NOTES,
  EARTHQUAKE,
  ENGAGE_ATTACK,
  ENTER_CAVERN,
  EXIT_CAVERN,
  MOLOCH_ALERT_TITLE,
  TRANSFER_MONSTERS,
} from "@/game/inferno/emergenceText";
import { consumeRaidResult, consumeRaidRun, setRaidResult } from "@/game/raid/raidSession";
import { INFERNO_YARD, MAIN_YARD } from "@/game/yard/ownYards";
import { YardView } from "@/game/yard/YardRenderer";
import type { YardMounts } from "@/game/yard/yardPlugins";
import { infernoYardPlugin, resetInfernoPlugin } from "./inferno";

/**
 * Moloch's cave on the own main yard (Inferno WP 1.10): shown only when the
 * load says so, a tap opens its note or menu, and a raise plays the
 * earthquake, whose shake keeps to the screen-shake setting, with Bob's tips
 * and the achievement card held back while it plays; then Moloch's warning,
 * whose "Engage Attack" starts his raid (WP 1.9), and "stage passed" after it.
 */

const hoisted = vi.hoisted(() => ({
  hit: true,
  levels: [] as number[],
  fresh: { cave: { level: 0 } },
  start: vi.fn(),
}));

vi.mock("@/api/raid", async (importOriginal) => ({
  ...(await importOriginal<typeof RaidModule>()),
  raidApi: { start: hoisted.start },
}));

vi.mock("@/game/inferno/CaveSprite", () => ({
  CaveSprite: class {
    readonly view = { onRender: null };
    place(): void {}
    setLevel(level: number): void {
      hoisted.levels.push(level);
    }
    contains(): boolean {
      return hoisted.hit;
    }
    destroy(): void {}
  },
}));

vi.mock("@/api/inferno", () => ({
  loadInfernoState: vi.fn(async () => hoisted.fresh),
}));

const molochRaid: MolochRaidView = {
  id: "m1",
  phase: "warning",
  tribe: "moloch",
  monsters: { IC1: 12, IC3: 4 },
  attackAt: 1_000,
  warned: 0,
  groups: [
    { monster: "IC1", count: 12 },
    { monster: "IC3", count: 4 },
  ],
};

const loadState = (
  level: number,
  raised: number | null = null,
  shown = true,
  raid: MolochRaidView | null = raised === null ? null : molochRaid,
): InfernoLoadState => ({
  now: 1_000,
  cave: { shown, level, maxLevel: 5 },
  emergence: { lastAt: raised === null ? null : 900, nextAt: 0, done: level >= 5 },
  descent: { level: 0, destroyed: [], passed: false },
  hasYard: false,
  korathNotice: false,
  raised,
  raid,
});

const mount = (state: InfernoLoadState | undefined, { kind = "main", townHall = 5 } = {}) => {
  const modal = document.createElement("div");
  const content = document.createElement("div");
  const canvas = document.createElement("canvas");
  document.body.append(modal, content, canvas);
  const pivot = { set: vi.fn() };
  const renderer = {
    shown: null,
    zoom: 1,
    view: YardView.ISO,
    root: { pivot },
    standAmongBuildings: vi.fn(),
    leaveBuildings: vi.fn(),
  };
  const scene = {
    closePanel: vi.fn(),
    centreOn: vi.fn(),
    plannerOpen: () => false,
    carrying: () => false,
    selectedBuilding: () => null,
    focusBuilding: vi.fn(),
    openRaid: vi.fn(),
    openYard: vi.fn(),
  };
  const notices = { show: vi.fn() };
  const mounts = {
    store: {
      kind,
      save: state ? { infernostate: state } : {},
      yard: { townHall: townHall > 0 ? { id: 1, level: townHall } : null },
    },
    overlay: { modal, content },
    renderer,
    camera: { screenToWorld: (point: { x: number; y: number }) => point },
    canvas,
    notices,
    scene,
  } as unknown as YardMounts;
  const teardown = infernoYardPlugin(mounts);
  return { modal, content, canvas, pivot, renderer, scene, notices, teardown };
};

const tap = (canvas: HTMLCanvasElement): void => {
  canvas.dispatchEvent(new PointerEvent("pointerdown", { clientX: 10, clientY: 10, pointerType: "touch" }));
  canvas.dispatchEvent(new PointerEvent("pointerup", { clientX: 11, clientY: 10, pointerType: "touch" }));
};

const engageButton = (root: ParentNode): HTMLButtonElement => {
  const found = [...root.querySelectorAll("button")].find((one) => one.textContent === ENGAGE_ATTACK);
  if (!found) throw new Error("no Engage Attack");
  return found;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The frames handed to `requestAnimationFrame`, run by hand. */
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  hoisted.hit = true;
  hoisted.levels = [];
  hoisted.fresh = { cave: { level: 0 } };
  hoisted.start.mockReset();
  // jsdom has no PointerEvent; a MouseEvent with a pointerType is all the plugin reads.
  if (typeof PointerEvent === "undefined") {
    vi.stubGlobal(
      "PointerEvent",
      class extends MouseEvent {
        readonly pointerType: string;
        constructor(type: string, init: MouseEventInit & { pointerType?: string } = {}) {
          super(type, init);
          this.pointerType = init.pointerType ?? "mouse";
        }
      },
    );
  }
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  resetInfernoPlugin();
  document.body.replaceChildren();
});

describe("whether the cave mounts", () => {
  it("stands among the buildings at the load's level on the own main yard", () => {
    const { renderer, teardown } = mount(loadState(3));
    expect(renderer.standAmongBuildings).toHaveBeenCalledTimes(1);
    expect(hoisted.levels).toEqual([3]);
    teardown?.();
    expect(renderer.leaveBuildings).toHaveBeenCalledTimes(1);
  });

  it("stays away from an outpost, a load without the Inferno and a cave not shown", () => {
    expect(mount(loadState(3), { kind: "outpost" }).teardown).toBeUndefined();
    expect(mount(undefined).teardown).toBeUndefined();
    expect(mount(loadState(0, null, false)).teardown).toBeUndefined();
  });
});

describe("the cave in the Inferno yard (WP 1.18)", () => {
  it("stands at its top level with no load state, and Exit Cavern opens the main yard", async () => {
    const { canvas, modal, scene, renderer, teardown } = mount(undefined, { kind: "inferno" });
    expect(hoisted.levels).toEqual([5]);
    expect(renderer.standAmongBuildings).toHaveBeenCalledTimes(1);
    tap(canvas);
    await settle();
    const buttons = [...modal.querySelectorAll("button")].map((one) => one.textContent);
    expect(buttons).toContain(EXIT_CAVERN);
    expect(buttons).not.toContain(ENTER_CAVERN);
    expect(buttons).not.toContain(TRANSFER_MONSTERS);
    [...modal.querySelectorAll("button")].find((one) => one.textContent === EXIT_CAVERN)!.click();
    expect(scene.openYard).toHaveBeenCalledWith(MAIN_YARD);
    teardown?.();
    expect(renderer.leaveBuildings).toHaveBeenCalledTimes(1);
  });
});

describe("a tap on the cave", () => {
  it("gives the note for its level below 5", async () => {
    const { canvas, modal, teardown } = mount(loadState(2));
    tap(canvas);
    await settle();
    expect(modal.textContent).toContain(CAVERN_NOTES[1]);
    teardown?.();
  });

  it("opens the menu at level 5, whose buttons say what is still to come", async () => {
    const { canvas, modal, notices, teardown } = mount(loadState(5));
    tap(canvas);
    await settle();
    const buttons = [...modal.querySelectorAll("button")].map((one) => one.textContent);
    expect(buttons).toEqual(expect.arrayContaining([TRANSFER_MONSTERS, ENTER_CAVERN]));
    [...modal.querySelectorAll("button")].find((one) => one.textContent === ENTER_CAVERN)!.click();
    expect(notices.show).toHaveBeenCalledWith("inferno", expect.any(String), expect.anything());
    teardown?.();
  });

  it("goes down to the Inferno yard once the Descent is won (WP 1.18)", async () => {
    const { canvas, modal, scene, notices, teardown } = mount({ ...loadState(5), hasYard: true });
    tap(canvas);
    await settle();
    [...modal.querySelectorAll("button")].find((one) => one.textContent === ENTER_CAVERN)!.click();
    expect(scene.openYard).toHaveBeenCalledWith(INFERNO_YARD);
    expect(notices.show).not.toHaveBeenCalled();
    teardown?.();
  });

  it("takes the server's fresher level before answering", async () => {
    hoisted.fresh = { cave: { level: 5 } };
    const { canvas, modal, teardown } = mount(loadState(4));
    tap(canvas);
    await settle();
    expect(modal.textContent).toContain(ENTER_CAVERN);
    teardown?.();
  });

  it("ignores a drag and a press beside the cave", async () => {
    const { canvas, modal, teardown } = mount(loadState(2));
    canvas.dispatchEvent(new PointerEvent("pointerdown", { clientX: 10, clientY: 10, pointerType: "touch" }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { clientX: 60, clientY: 10, pointerType: "touch" }));
    hoisted.hit = false;
    tap(canvas);
    await settle();
    expect(modal.querySelector(".popup-backdrop")).toBeNull();
    teardown?.();
  });
});

describe("the earthquake on a raise", () => {
  const raise = async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const mounted = mount(loadState(2, 2));
    await vi.advanceTimersByTimeAsync(3_000);
    return mounted;
  };

  it("turns the camera to the cave, grows it, shows EARTHQUAKE and shakes the yard", async () => {
    const { content, scene, pivot, teardown } = await raise();
    expect(scene.centreOn).toHaveBeenCalledTimes(1);
    expect(hoisted.levels).toEqual([2, 1, 2]);
    expect(content.textContent).toContain(EARTHQUAKE);
    expect(frames).toHaveLength(1);
    frames[0]!(performance.now());
    expect(pivot.set).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(content.textContent).not.toContain(EARTHQUAKE);
    teardown?.();
    expect(pivot.set).toHaveBeenLastCalledWith(0, 0);
  });

  it("does not shake with screen shake turned off in the settings", async () => {
    localStorage.setItem(SCREEN_SHAKE_KEY, "0");
    const { content, pivot, teardown } = await raise();
    expect(content.textContent).toContain(EARTHQUAKE);
    expect(frames).toHaveLength(0);
    expect(pivot.set).not.toHaveBeenCalled();
    teardown?.();
  });

  it("does not shake for a player who asked for reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    const { content, teardown } = await raise();
    expect(content.textContent).toContain(EARTHQUAKE);
    expect(frames).toHaveLength(0);
    teardown?.();
  });

  it("plays a raise once, not again when the yard opens on the same load", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const state = loadState(2, 2);
    mount(state).teardown?.();
    const again = mount(state);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(again.scene.centreOn).not.toHaveBeenCalled();
    again.teardown?.();
  });

  it("holds Bob's tips and the achievement card back from load until Moloch's warning is answered", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    hoisted.start.mockRejectedValue(new Error("offline"));
    expect(emergencePlaying()).toBe(false);
    const { modal, teardown } = mount(loadState(2, 2));
    expect(emergencePlaying()).toBe(true);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(modal.textContent).toContain(MOLOCH_ALERT_TITLE);
    expect(emergencePlaying()).toBe(true);
    // The server out of reach: the warning stays, and holds on.
    engageButton(modal).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(engageButton(modal).disabled).toBe(false);
    expect(emergencePlaying()).toBe(true);
    teardown?.();
  });

  it("lets go when the yard closes mid-raise, and holds nothing without a raise", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mount(loadState(2, 2)).teardown?.();
    expect(emergencePlaying()).toBe(false);
    const quiet = mount(loadState(2));
    expect(emergencePlaying()).toBe(false);
    quiet.teardown?.();
  });
});

describe("Moloch's raid", () => {
  it("warns with his army three seconds after the earthquake, and Engage Attack hands his fight to the raid scene", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    hoisted.start.mockImplementation(async (id: string) => ({
      error: 0,
      raid: { ...molochRaid, id, phase: "fighting" },
      fight: { seed: 1 },
    }));
    const { modal, scene, teardown } = mount(loadState(2, 2));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(modal.textContent).not.toContain(MOLOCH_ALERT_TITLE);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(modal.querySelectorAll(".inferno-army__card")).toHaveLength(2);
    engageButton(modal).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(hoisted.start).toHaveBeenCalledWith("m1");
    expect(scene.openRaid).toHaveBeenCalledTimes(1);
    expect(consumeRaidRun()?.raid).toMatchObject({ id: "m1", phase: "fighting" });
    expect(modal.textContent).not.toContain(MOLOCH_ALERT_TITLE);
    expect(emergencePlaying()).toBe(false);
    teardown?.();
  });

  it("grows the cave with no earthquake and no warning when the raise came without a raid", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { modal, content, scene, teardown } = mount(loadState(1, 1, true, null));
    await vi.advanceTimersByTimeAsync(3_000);
    // Moloch's first words still come; then nothing more.
    modal.querySelector("button")?.click();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(scene.centreOn).toHaveBeenCalledTimes(1);
    expect(hoisted.levels.at(-1)).toBe(1);
    expect(content.textContent).not.toContain(EARTHQUAKE);
    expect(modal.textContent).not.toContain(MOLOCH_ALERT_TITLE);
    expect(emergencePlaying()).toBe(false);
    teardown?.();
  });

  it("shows stage passed when the yard opens on what his raid landed, and leaves a wild raid's result alone", async () => {
    const landed = (tribe: string): RaidResult => ({
      id: "m1",
      tribe,
      at: 1,
      defended: false,
      health: 0.4,
      stolen: { r1: 0, r2: 0, r3: 0, r4: 0 },
      shiny: 0,
      damaged: [],
      housedLost: 0,
    });
    setRaidResult(landed("moloch"));
    const after = mount(loadState(2));
    expect(after.modal.textContent).toContain(CAVERN_DEFENCE);
    after.teardown?.();
    document.body.replaceChildren();

    setRaidResult(landed("Kozu"));
    const wild = mount(loadState(2));
    expect(wild.modal.textContent).not.toContain(CAVERN_DEFENCE);
    expect(consumeRaidResult()?.tribe).toBe("Kozu");
    wild.teardown?.();
  });
});
