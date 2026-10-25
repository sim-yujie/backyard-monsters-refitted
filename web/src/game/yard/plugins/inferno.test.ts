// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InfernoLoadState } from "@/api/inferno";
import { SCREEN_SHAKE_KEY } from "@/game/attack/juice";
import { CAVERN_NOTES, EARTHQUAKE, ENTER_CAVERN, TRANSFER_MONSTERS } from "@/game/inferno/emergenceText";
import { YardView } from "@/game/yard/YardRenderer";
import type { YardMounts } from "@/game/yard/yardPlugins";
import { infernoYardPlugin, resetInfernoPlugin } from "./inferno";

/**
 * Moloch's cave on the own main yard (Inferno WP 1.10): shown only when the
 * load says so, a tap opens its note or menu, and a raise plays the
 * earthquake, whose shake keeps to the screen-shake setting.
 */

const hoisted = vi.hoisted(() => ({
  hit: true,
  levels: [] as number[],
  fresh: { cave: { level: 0 } },
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

const loadState = (level: number, raised: number | null = null, shown = true): InfernoLoadState => ({
  now: 1_000,
  cave: { shown, level, maxLevel: 5 },
  emergence: { lastAt: raised === null ? null : 900, nextAt: 0, done: level >= 5 },
  descent: { level: 0, destroyed: [], passed: false },
  hasYard: false,
  korathNotice: false,
  raised,
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

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The frames handed to `requestAnimationFrame`, run by hand. */
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  hoisted.hit = true;
  hoisted.levels = [];
  hoisted.fresh = { cave: { level: 0 } };
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
});
