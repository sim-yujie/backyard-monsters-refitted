// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import { YardStore, type YardChange } from "@/game/yard/YardStore";
import type { Notices } from "@/ui/maproom/Notices";
import { spokenText } from "@/ui/resourceIcon";
import { MonstersScreen, townHallFor } from "./MonstersScreen";
import type { MonstersFocus, MonstersTab, MonstersTabDefinition } from "./monstersTab";
import { MONSTERS_TABS } from "./tabs";

/**
 * The Monsters screen's frame: the tab strip, the header, the "build one
 * first" note, opening on a tab with a focus, and the tab contract a work
 * package plugs into.
 */

const T0 = 2_000_000;

const building = (id: number, t: number, l: number, extra: Partial<BuildingData> = {}): BuildingData => ({
  id,
  t,
  l,
  X: id * 40,
  Y: 0,
  ...extra,
});

const loadOf = (buildings: BuildingData[], extra: Partial<BaseLoadResponse> = {}): BaseLoadResponse =>
  ({
    error: 0,
    currenttime: T0,
    savetime: T0,
    resources: { r1: 0, r2: 0, r3: 900_000, r4: 3_200_000 },
    credits: 100,
    caps: { r1: 4e6, r2: 4e6, r3: 4_000_000, r4: 4_000_000 },
    buildingdata: Object.fromEntries(buildings.map((one) => [String(one.id), one])),
    buildinghealthdata: {},
    storedata: {},
    lockerdata: {},
    monsters: { housed: { C1: 10 } },
    ...extra,
  }) as unknown as BaseLoadResponse;

/** A tab that records what the screen tells it. */
const spyTab = () => {
  const calls: string[] = [];
  const focuses: MonstersFocus[] = [];
  const tab: MonstersTab = {
    element: Object.assign(document.createElement("div"), { className: "spy-tab" }),
    show: (focus) => {
      calls.push("show");
      focuses.push(focus);
    },
    update: (change: YardChange) => calls.push(`update:${change.reason}`),
    tick: () => calls.push("tick"),
    destroy: () => calls.push("destroy"),
  };
  return { tab, calls, focuses };
};

const setup = (buildings: BuildingData[], options: { tabs?: MonstersTabDefinition[]; load?: Partial<BaseLoadResponse> } = {}) => {
  const api = {
    state: vi.fn(() => new Promise<YardResponse<null>>(() => undefined)),
  } as unknown as YardApi;
  const store = new YardStore({
    save: loadOf(buildings, options.load),
    api,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  const onClose = vi.fn();
  const screen = new MonstersScreen({
    binding: { store, scene: { selectBuilding: vi.fn() }, notices: {} as Notices },
    onClose,
    ...(options.tabs ? { tabs: options.tabs } : {}),
  }).mount(document.body);
  return { screen, store, onClose, element: screen.element };
};

afterEach(() => {
  document.body.replaceChildren();
});

const HALL = building(1, 14, 6);
const LOCKER = building(2, 8, 2);
const HOUSING = building(3, 15, 1);

const tabButton = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (one) => one.textContent === label,
  )!;

describe("MonstersScreen: the frame", () => {
  it("starts closed and opens on the tab asked for, the five tabs in order", () => {
    const { screen, element } = setup([HALL, LOCKER]);
    expect(element.hidden).toBe(true);
    screen.open("unlock");
    expect(element.hidden).toBe(false);
    expect([...element.querySelectorAll('[role="tab"]')].map((one) => one.textContent)).toEqual([
      "Unlock",
      "Hatch",
      "Housing",
      "Train",
      "Lab",
    ]);
    expect(tabButton(element, "Unlock").getAttribute("aria-selected")).toBe("true");
    expect(element.querySelector(".locker")).not.toBeNull();
  });

  it("shows housing used / total and goo and putty in full, with their caps", () => {
    const { screen, element } = setup([HALL, LOCKER, HOUSING]);
    screen.open("unlock");
    const header = element.querySelector<HTMLElement>(".monsters-header")!;
    expect(header.querySelector(".monsters-header__value")!.textContent).toBe("100 / 200");
    expect(header.querySelector('[role="meter"]')!.getAttribute("aria-valuenow")).toBe("100");
    const [goo, putty] = [...header.querySelectorAll<HTMLElement>(".monsters-header__resource")];
    expect(spokenText(goo!)).toBe("Goo 3,200,000 / 4,000,000");
    expect(spokenText(putty!)).toBe("Putty 900,000 / 4,000,000");
  });

  it("says what to build, and the Town Hall it needs, for a tab with no building", () => {
    const { screen, element } = setup([building(1, 14, 2), LOCKER]);
    screen.open("train");
    const note = element.querySelector<HTMLElement>(".monsters-empty")!;
    expect(note.querySelector(".monsters-empty__title")!.textContent).toBe("No Monster Academy yet");
    expect(note.querySelector(".monsters-empty__gate")!.textContent).toBe(
      "Needs Town Hall 3: yours is level 2.",
    );
    screen.open("hatch");
    expect(element.querySelector(".monsters-empty__gate")!.textContent).toBe(
      "Needs Town Hall 1: yours is level 2, so you can build one now.",
    );
  });

  it("knows each monster building's Town Hall", () => {
    expect([8, 13, 15, 16, 26, 116].map(townHallFor)).toEqual([2, 1, 1, 3, 3, 5]);
  });

  it("switches tabs from the strip, by click and by arrow keys", () => {
    const { screen, element } = setup([HALL, LOCKER, HOUSING]);
    screen.open("unlock");
    tabButton(element, "Housing").click();
    expect(screen.activeTab).toBe("housing");
    tabButton(element, "Housing").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(screen.activeTab).toBe("train");
    tabButton(element, "Train").dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(screen.activeTab).toBe("unlock");
  });

  it("closes from × and Escape, and opens again where it was", () => {
    const { screen, element, onClose } = setup([HALL, LOCKER, HOUSING]);
    screen.open("housing");
    element.querySelector<HTMLButtonElement>(".monsters-screen__close")!.click();
    expect(element.hidden).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    screen.open();
    expect(screen.activeTab).toBe("housing");
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(screen.isOpen).toBe(false);
  });

  it("stands beside the building panel when told", () => {
    const { screen, element } = setup([HALL, LOCKER]);
    screen.besidePanel(true);
    expect(element.classList.contains("monsters-screen--beside-panel")).toBe(true);
    screen.besidePanel(false);
    expect(element.classList.contains("monsters-screen--beside-panel")).toBe(false);
  });
});

describe("MonstersScreen: the tab contract", () => {
  const withSpy = () => {
    const spy = spyTab();
    const create = vi.fn(() => spy.tab);
    const tabs = MONSTERS_TABS.map((definition) =>
      definition.id === "hatch" ? { ...definition, create } : definition,
    );
    return { spy, create, tabs };
  };

  it("creates a tab the first time it is shown, and shows it with the opener's focus", () => {
    const { spy, create, tabs } = withSpy();
    const { screen, element } = setup([HALL, LOCKER, building(4, 13, 1)], { tabs });
    screen.open("unlock");
    expect(create).not.toHaveBeenCalled();
    screen.open("hatch", { buildingId: 4 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(element.querySelector(".spy-tab")).not.toBeNull();
    expect(spy.focuses).toEqual([{ buildingId: 4 }]);
    screen.open("unlock");
    screen.open("hatch");
    expect(create).toHaveBeenCalledTimes(1);
    expect(spy.calls.filter((call) => call === "show")).toHaveLength(2);
  });

  it("passes store changes, pending ones included, and the tick to the visible tab only", () => {
    const { spy, tabs } = withSpy();
    const { screen, store } = setup([HALL, LOCKER, building(4, 13, 1)], { tabs });
    screen.open("hatch");
    screen.tick();
    void store.refresh();
    expect(spy.calls).toContain("tick");
    expect(spy.calls).toContain("update:pending");
    spy.calls.length = 0;
    screen.open("unlock");
    screen.tick();
    void store.refresh();
    expect(spy.calls).toEqual([]);
  });

  it("destroys every tab it made", () => {
    const { spy, tabs } = withSpy();
    const { screen } = setup([HALL, LOCKER, building(4, 13, 1)], { tabs });
    screen.open("hatch");
    screen.destroy();
    expect(spy.calls).toContain("destroy");
  });

  it("tells the visible tab when it is hidden: another tab, or the screen closing", () => {
    const { spy, tabs } = withSpy();
    const hidden = vi.fn();
    spy.tab.hide = hidden;
    const { screen } = setup([HALL, LOCKER, building(4, 13, 1)], { tabs });
    screen.open("hatch");
    screen.open("hatch", { buildingId: 4 });
    expect(hidden).not.toHaveBeenCalled();
    screen.open("unlock");
    expect(hidden).toHaveBeenCalledTimes(1);
    screen.open("hatch");
    screen.close();
    expect(hidden).toHaveBeenCalledTimes(2);
    screen.close();
    expect(hidden).toHaveBeenCalledTimes(2);
  });

  it("does not create a tab whose building is missing", () => {
    const { create, tabs } = withSpy();
    const { screen } = setup([HALL, LOCKER], { tabs });
    screen.open("hatch");
    expect(create).not.toHaveBeenCalled();
  });
});
