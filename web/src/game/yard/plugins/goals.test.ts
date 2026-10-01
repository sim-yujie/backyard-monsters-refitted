// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoalClaimReport, GoalsActions, GoalsStateReport, GoalView } from "@/api/goals";
import type { YardActionResult } from "@/game/yard/YardStore";
import { guideBus } from "@/game/guide/guideBus";
import { YardDock } from "@/ui/yard/YardDock";
import type { YardMounts } from "../yardPlugins";
import { GoalsDoor, goalsPlugin, startGrant } from "./goals";

/**
 * The Goals button, its badge, the first read and Claim with its balls
 * (issue #227), against stand-in mounts.
 */

const goal = (id: string, status: GoalView["status"]): GoalView => ({
  id,
  order: 1,
  name: `Goal ${id}`,
  description: "",
  reward: { r1: 2000, r2: 2000, r3: 0, r4: 0 },
  status,
});

const ok = <R>(report: R): YardActionResult<R> => ({ ok: true, report, completed: [] });

/** A store holding a pool and the badge count, whose listeners can be poked. */
const storeOf = (goalsReady: number, kind: "main" | "outpost" = "main") => {
  const listeners = new Set<() => void>();
  const store = {
    kind,
    save: { onboarding: { guide: { state: "done" }, camp: "none", goalsReady, tips: {} } },
    resources: { r1: 9000, r2: 0, r3: 0, r4: 0 },
    caps: { r1: 10_000, r2: 10_000, r3: 10_000, r4: 10_000 },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    run: vi.fn(),
    notify: () => listeners.forEach((listener) => listener()),
  };
  return store;
};

const mountsOf = (store: ReturnType<typeof storeOf>) => {
  const dock = new YardDock({ onBuild: vi.fn(), onMap: vi.fn() } as never);
  document.body.append(dock.element);
  const content = document.body.appendChild(document.createElement("div"));
  const renderer = {
    throwGrant: vi.fn(() => ({ totals: { r1: 1000, r2: 2000 }, ends: { r1: 1, r2: 1 }, balls: 6, group: 4 })),
    cancelBank: vi.fn(),
  };
  const hud = { expectBank: vi.fn(), hold: vi.fn(), deliver: vi.fn(), showChange: vi.fn() };
  const notices = { show: vi.fn() };
  const mounts = {
    store,
    dock,
    overlay: { content, modal: content, guide: content },
    renderer,
    hud,
    notices,
    canvas: document.createElement("canvas"),
    camera: { screenToWorld: (point: { x: number; y: number }) => point },
  } as unknown as YardMounts;
  return { mounts, renderer, hud, notices, dock };
};

const actionsOf = (goals: GoalView[]) => {
  const actions = {
    state: vi.fn(() => Promise.resolve(ok<GoalsStateReport>({ goals }))),
    claim: vi.fn((id: string) =>
      Promise.resolve(
        ok<GoalClaimReport>({
          id,
          credited: { r1: 1000, r2: 2000, r3: 0, r4: 0 },
          overflow: { r1: 1000, r2: 0, r3: 0, r4: 0 },
          points: 80,
        }),
      ),
    ),
  } satisfies GoalsActions;
  return actions;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("the Goals button", () => {
  it("sits on the dock tagged for Bob, with the ready count as its badge", () => {
    const store = storeOf(2);
    const { mounts, dock } = mountsOf(store);
    const door = new GoalsDoor(mounts, actionsOf([]));
    expect(dock.element.querySelector('[data-tut="dock-goals"]')).toBe(door.button);
    const badge = door.button.querySelector<HTMLElement>(".goals-badge")!;
    expect(badge.textContent).toBe("2");
    expect(door.button.getAttribute("aria-label")).toBe("Goals. 2 goals ready to claim");

    store.save.onboarding.goalsReady = 0;
    store.notify();
    expect(badge.hidden).toBe(true);
    door.destroy();
    expect(dock.element.querySelector('[data-tut="dock-goals"]')).toBeNull();
  });

  it("is only on the main yard, and reads the list once as the yard opens (the baseline's first read)", async () => {
    const outpost = mountsOf(storeOf(0, "outpost"));
    expect(goalsPlugin(outpost.mounts)).toBeUndefined();
    expect(outpost.dock.element.querySelector('[data-tut="dock-goals"]')).toBeNull();

    const store = storeOf(0);
    const { mounts } = mountsOf(store);
    store.run.mockResolvedValue(ok({ goals: [] }));
    const teardown = goalsPlugin(mounts);
    expect(store.run).toHaveBeenCalledTimes(1);
    expect(store.run.mock.calls[0]![0]).toMatchObject({ key: "goals:state" });
    await settle();
    teardown?.();
  });
});

describe("the Goals panel and the guide", () => {
  it("emits screen \"goals\" as it opens and screenClosed as it closes", async () => {
    const { mounts } = mountsOf(storeOf(0));
    const opened = vi.fn();
    const closed = vi.fn();
    const offOpen = guideBus.on("screen", opened);
    const offClose = guideBus.on("screenClosed", closed);
    const door = new GoalsDoor(mounts, actionsOf([]));

    door.toggle();
    expect(opened).toHaveBeenCalledTimes(1);
    const payload = opened.mock.calls[0]![0];
    expect(payload.id).toBe("goals");
    expect(payload.root.getAttribute("data-tut")).toBe("goals-panel");
    expect(payload.header.classList.contains("panel__titlebar")).toBe(true);
    expect(closed).not.toHaveBeenCalled();

    door.toggle();
    expect(closed).toHaveBeenCalledWith({ id: "goals" });
    await settle();

    // Closed by tearing the yard down, too.
    door.toggle();
    door.destroy();
    expect(closed).toHaveBeenCalledTimes(2);
    offOpen();
    offClose();
  });
});

describe("Claim", () => {
  it("throws the capped figure's balls from the button, then hands them the server's answer", async () => {
    const store = storeOf(1);
    const { mounts, renderer, hud } = mountsOf(store);
    const actions = actionsOf([goal("T1", "ready"), goal("T2", "open")]);
    const door = new GoalsDoor(mounts, actions);
    door.button.getBoundingClientRect = () => ({ left: 100, top: 500, width: 60, height: 60 }) as DOMRect;
    door.toggle();
    await settle();

    const button = document.querySelector<HTMLButtonElement>(".goals-claim")!;
    expect(button.textContent).toContain("(storage full)");
    button.click();
    // 9,000 of 10,000 held: only 1,000 twigs fly.
    expect(renderer.throwGrant).toHaveBeenCalledWith({ r1: 1000, r2: 2000 }, expect.anything(), expect.any(Function));
    expect(hud.expectBank).toHaveBeenCalledWith("r1", 1);
    await settle();
    expect(actions.claim).toHaveBeenCalledWith("T1");
    expect(hud.hold).toHaveBeenCalledWith("r1", 1000);
    expect(hud.hold).toHaveBeenCalledWith("r2", 2000);
    // The list is read again for what the claim opened.
    expect(actions.state).toHaveBeenCalledTimes(2);
    door.destroy();
  });

  it("a refusal takes the balls back and shows why", async () => {
    const store = storeOf(1);
    const { mounts, renderer } = mountsOf(store);
    const actions = actionsOf([goal("T1", "ready")]);
    actions.claim.mockResolvedValueOnce({
      ok: false,
      refusal: { reason: "notMet", message: "That goal is not finished yet.", detail: {} },
    } as never);
    const door = new GoalsDoor(mounts, actions);
    door.button.getBoundingClientRect = () => ({ left: 100, top: 500, width: 60, height: 60 }) as DOMRect;
    door.toggle();
    await settle();
    document.querySelector<HTMLButtonElement>(".goals-claim")!.click();
    await settle();
    expect(renderer.cancelBank).toHaveBeenCalledWith(4);
    expect(document.querySelector("[role=alert]")?.textContent).toBe("That goal is not finished yet.");
    door.destroy();
  });

  it("nothing flies without a point to throw from", () => {
    const fx = { throwGrant: vi.fn(), cancelBank: vi.fn() };
    const hud = { expectBank: vi.fn(), hold: vi.fn(), deliver: vi.fn(), showChange: vi.fn() };
    expect(startGrant({ r1: 100 }, null, fx as never, hud)).toBeNull();
    expect(fx.throwGrant).not.toHaveBeenCalled();
  });
});
