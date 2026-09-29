// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { MAIN_YARD, outpostTarget, type OwnYardTarget } from "@/game/yard/ownYards";
import type { YardChange, YardListener, YardStore, YardUiBinding } from "@/game/yard/YardStore";
import { Notices } from "@/ui/maproom/Notices";
import { dockButtonsFor, waitingText, YardDock, type YardDockOptions } from "./YardDock";

/**
 * The yard's round buttons (#171, option B): which show on the main yard, an
 * outpost and a visit, what each press reports, and the Monsters badge.
 */

const T0 = 1_800_000_000;

interface Fake {
  save: BaseLoadResponse;
  listeners: Set<YardListener>;
  emit(change?: Partial<YardChange>): void;
}

const fakeBinding = (
  target: OwnYardTarget,
  openMonsters?: ReturnType<typeof vi.fn>,
): { binding: YardUiBinding; fake: Fake } => {
  const listeners = new Set<YardListener>();
  const fake: Fake = {
    save: {
      savetime: T0,
      currenttime: T0,
      // A full Twig Snapper: something to collect.
      buildingdata: { "1": { X: 0, Y: 0, id: 1, t: 1, st: 720, pr: 0 } },
      buildinghealthdata: {},
      storedata: {},
      outposts: [[242, 209, "2000242209"]],
    } as unknown as BaseLoadResponse,
    listeners,
    emit: (change = {}) => {
      for (const listener of [...listeners]) {
        listener({ reason: "refresh", completed: [], predicted: [], ...change });
      }
    },
  };
  const store = {
    get save() {
      return fake.save;
    },
    target,
    kind: target.kind,
    resources: {},
    caps: null,
    now: () => T0,
    isRunning: () => false,
    subscribe: (listener: YardListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    binding: {
      store: store as unknown as YardStore,
      scene: { selectBuilding: () => {}, ...(openMonsters ? { openMonsters } : {}) },
      notices: new Notices(),
    },
    fake,
  };
};

const OUTPOST = outpostTarget("2000242209", { col: 242, row: 209 });

describe("dockButtonsFor", () => {
  const own: Pick<YardDockOptions, "onBuild" | "onYardSelect"> = {
    onBuild: () => {},
    onYardSelect: () => {},
  };

  it("shows everything on the main yard", () => {
    const { binding } = fakeBinding(MAIN_YARD, vi.fn());
    expect(dockButtonsFor(own, binding)).toEqual({
      build: true,
      collect: true,
      kits: false,
      monsters: true,
      switcher: true,
      home: false,
      attack: false,
    });
  });

  it("drops Collect all on an outpost, which banks by itself (#146)", () => {
    const { binding } = fakeBinding(OUTPOST, vi.fn());
    expect(dockButtonsFor(own, binding)).toMatchObject({
      build: true,
      collect: false,
      monsters: true,
      switcher: true,
    });
  });

  it("shows only the ways out and the attack on a visit", () => {
    expect(dockButtonsFor({ onHome: () => {}, onAttack: () => {} }, null)).toEqual({
      build: false,
      collect: false,
      kits: false,
      monsters: false,
      switcher: false,
      home: true,
      attack: true,
    });
  });

  it("shows Kits on an own outpost only (#188)", () => {
    const withKits = { ...own, onKits: () => {} };
    expect(dockButtonsFor(withKits, fakeBinding(OUTPOST, vi.fn()).binding).kits).toBe(true);
    expect(dockButtonsFor(withKits, fakeBinding(MAIN_YARD, vi.fn()).binding).kits).toBe(false);
    expect(dockButtonsFor(withKits, null).kits).toBe(false);
    expect(dockButtonsFor(own, fakeBinding(OUTPOST, vi.fn()).binding).kits).toBe(false);
  });

  it("waits for the own yard's binding before Collect all, Monsters and the switcher", () => {
    expect(dockButtonsFor(own, null)).toMatchObject({ build: true, collect: false, monsters: false, switcher: false });
  });
});

describe("YardDock", () => {
  let dock: YardDock | null = null;
  let options: {
    onMap: ReturnType<typeof vi.fn>;
    onLayout: ReturnType<typeof vi.fn>;
    onBuild: ReturnType<typeof vi.fn>;
    onYardSelect: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    options = { onMap: vi.fn(), onLayout: vi.fn(), onBuild: vi.fn(), onYardSelect: vi.fn() };
  });

  afterEach(() => {
    dock?.destroy();
    dock = null;
    vi.useRealTimers();
  });

  const button = (name: string): HTMLButtonElement =>
    dock!.element.querySelector<HTMLButtonElement>(`[data-dock="${name}"]`)!;
  const collect = (): HTMLElement => dock!.element.querySelector<HTMLElement>(".yard-collect")!;

  it("draws Kits on an outpost, in Collect all's place, and reports its press (#188)", () => {
    const onKits = vi.fn();
    dock = new YardDock({ ...options, onKits }).mount(document.body);
    expect(button("kits").hidden).toBe(true);

    dock.bind(fakeBinding(OUTPOST, vi.fn()).binding);
    expect(button("kits").hidden).toBe(false);
    expect(button("kits").textContent).toBe("Kits");
    button("kits").click();
    expect(onKits).toHaveBeenCalledTimes(1);

    dock.bind(fakeBinding(MAIN_YARD, vi.fn()).binding);
    expect(button("kits").hidden).toBe(true);
  });

  it("is real buttons with their words, reporting each press", () => {
    dock = new YardDock(options).mount(document.body);
    for (const [name, word] of [
      ["map", "Map"],
      ["layout", "Layout"],
      ["monsters", "Monsters"],
      ["build", "Build"],
    ] as const) {
      expect(button(name).tagName).toBe("BUTTON");
      expect(button(name).type).toBe("button");
      expect(button(name).querySelector(".yard-dock__label")!.textContent).toBe(word);
    }
    button("map").click();
    expect(options.onMap).toHaveBeenCalledOnce();
    button("layout").click();
    expect(options.onLayout).toHaveBeenCalledOnce();
    // Build waits for the yard's store.
    expect(button("build").disabled).toBe(true);
    dock.setBuild({ disabled: false, carrying: false, open: false });
    button("build").click();
    expect(options.onBuild).toHaveBeenCalledOnce();
  });

  it("shows Collect all, Monsters and the switcher on the main yard", () => {
    const openMonsters = vi.fn();
    const { binding } = fakeBinding(MAIN_YARD, openMonsters);
    dock = new YardDock(options).mount(document.body);
    expect(collect().hidden).toBe(true);
    expect(button("monsters").hidden).toBe(true);

    dock.bind(binding);
    expect(collect().hidden).toBe(false);
    expect(collect().querySelector(".yard-collect__amount")!.textContent).toBe("720");
    expect(button("monsters").hidden).toBe(false);
    expect(dock.element.querySelector<HTMLElement>(".yard-switcher")!.hidden).toBe(false);
    button("monsters").click();
    expect(openMonsters).toHaveBeenCalledWith("unlock");

    dock.bind(null);
    expect(collect().hidden).toBe(true);
    expect(button("monsters").hidden).toBe(true);
    expect(dock.element.querySelector<HTMLElement>(".yard-switcher")!.hidden).toBe(true);
  });

  it("has no Collect all on an outpost, and keeps Monsters and the switcher", () => {
    const { binding } = fakeBinding(OUTPOST, vi.fn());
    dock = new YardDock(options).mount(document.body);
    dock.bind(binding);
    expect(collect().hidden).toBe(true);
    expect(button("monsters").hidden).toBe(false);
    expect(dock.element.querySelector<HTMLElement>(".yard-switcher")!.hidden).toBe(false);
    expect(dock.shown.collect).toBe(false);
  });

  it("offers Home and Attack on a visit, and no Build", () => {
    const onHome = vi.fn();
    const onAttack = vi.fn();
    dock = new YardDock({ onMap: vi.fn(), onLayout: vi.fn(), onHome, onAttack }).mount(document.body);
    expect(button("build")).toBeNull();
    expect(dock.element.querySelector(".yard-switcher")).toBeNull();
    button("home").click();
    expect(onHome).toHaveBeenCalledOnce();
    expect(button("attack").disabled).toBe(true);
    dock.setAttack({ disabled: false, title: "Attack Kozu's yard" });
    expect(button("attack").title).toBe("Attack Kozu's yard");
    button("attack").click();
    expect(onAttack).toHaveBeenCalledOnce();
  });

  it("turns Build into Stop while a building is in hand", () => {
    dock = new YardDock(options).mount(document.body);
    dock.setBuild({ disabled: false, carrying: true, open: true });
    expect(button("build").querySelector(".yard-dock__label")!.textContent).toBe("Stop");
    expect(button("build").getAttribute("aria-expanded")).toBe("true");
    expect(button("build").title).toMatch(/without building it/);
    dock.setBuild({ disabled: false, carrying: false, open: false });
    expect(button("build").querySelector(".yard-dock__label")!.textContent).toBe("Build");
    expect(button("build").getAttribute("aria-expanded")).toBe("false");
  });

  it("names Layout with what it does, or what would unlock it", () => {
    dock = new YardDock(options).mount(document.body);
    dock.setLayout({ disabled: true, open: false, label: "Layout", title: "Build a Yard Planner first." });
    expect(button("layout").disabled).toBe(true);
    expect(button("layout").getAttribute("aria-label")).toBe("Layout. Build a Yard Planner first.");
    dock.setLayout({ disabled: false, open: true, label: "Close layout", title: "Leave the layout planner (P)" });
    expect(button("layout").getAttribute("aria-pressed")).toBe("true");
    expect(button("layout").querySelector(".yard-dock__label")!.textContent).toBe("Close layout");
  });

  it("badges Monsters with the monsters waiting for room, and follows the store", () => {
    const { binding, fake } = fakeBinding(MAIN_YARD, vi.fn());
    dock = new YardDock(options).mount(document.body);
    dock.bind(binding);
    const badge = (): HTMLElement => button("monsters").querySelector<HTMLElement>(".yard-dock__badge")!;
    expect(badge().hidden).toBe(true);
    expect(button("monsters").getAttribute("aria-label")).toBe("Monsters");

    fake.save = {
      ...fake.save,
      monsters: { hstage: [2, 0, 2], h: [["C14", 0], ["C1", 10], ["C3", 0]] },
    } as unknown as BaseLoadResponse;
    fake.emit();
    expect(badge().hidden).toBe(false);
    expect(badge().textContent).toBe("2");
    expect(button("monsters").getAttribute("aria-label")).toBe(`Monsters. ${waitingText(2)}`);
    expect(button("monsters").title).toBe("Monsters: 2 monsters are waiting for room");
  });

  it("stops listening to the store when unbound or destroyed", () => {
    const { binding, fake } = fakeBinding(MAIN_YARD, vi.fn());
    dock = new YardDock(options).mount(document.body);
    dock.bind(binding);
    expect(fake.listeners.size).toBe(1);
    dock.bind(binding);
    expect(fake.listeners.size).toBe(1);
    dock.destroy();
    dock = null;
    expect(fake.listeners.size).toBe(0);
  });
});

describe("waitingText", () => {
  it("counts one and many", () => {
    expect(waitingText(1)).toBe("1 monster is waiting for room");
    expect(waitingText(3)).toBe("3 monsters are waiting for room");
  });
});
