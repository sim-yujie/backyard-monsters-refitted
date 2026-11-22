// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArmyYard, MovePair } from "@/game/maproom/transferPlan";
import { TransferMode, type TransferModeOptions } from "./TransferMode";

/**
 * Move mode on the world map (beta 9 #7, the owner's "B1 steel plates"):
 * plates only while moving, the tray's picks and ticks, the List, and one
 * move of several pairs sent to the server.
 */

const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

const SIZE: Record<string, number> = { C1: 7, C2: 10, C12: 160 };

const yards = (): ArmyYard[] => [
  { baseid: "main", main: true, x: 10, y: 10, capacity: 2160, attack: false, housed: { C1: 60, C2: 10 } },
  { baseid: "a", main: false, x: 11, y: 10, capacity: 540, attack: false, housed: {} },
  { baseid: "b", main: false, x: 12, y: 10, capacity: 540, attack: false, housed: { C1: 5 } },
  { baseid: "c", main: false, x: 13, y: 10, capacity: 540, attack: true, housed: { C2: 3 } },
  { baseid: "far", main: false, x: 40, y: 40, capacity: 675, attack: false, housed: { C12: 2 } },
];

let mode: TransferMode | null = null;
afterEach(() => {
  mode?.destroy();
  mode = null;
  document.body.replaceChildren();
});

const make = (over: Partial<TransferModeOptions> = {}) => {
  const layer = document.createElement("div");
  layer.className = "overlay__layer";
  const modal = document.createElement("div");
  document.body.append(layer, modal);
  const sent: MovePair[][] = [];
  const marks: unknown[] = [];
  const options: TransferModeOptions = {
    layer,
    modal,
    sizeOf: (id) => SIZE[id] ?? 10,
    distance: (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)),
    nameOf: (yard) => (yard.main ? "Main yard" : `${yard.x}, ${yard.y}`),
    // Every yard but "far" is on screen, 100 px wide hexes.
    place: (yard) => (yard.baseid === "far" ? null : { x: yard.x * 100, y: 300, hexWidth: 100 }),
    load: async () => yards(),
    send: vi.fn(async (pairs: readonly MovePair[]) => {
      sent.push([...pairs]);
      return { yards: pairs.map((pair) => ({ baseid: pair.to, housed: { ...pair.moved }, capacity: 540 })) };
    }),
    onMoved: vi.fn(),
    mark: (m) => marks.push(m),
    onEnd: vi.fn(),
    ...over,
  };
  mode = new TransferMode(options);
  return { layer, modal, sent, marks, options };
};

const click = (root: ParentNode, selector: string, nth = 0): void => {
  const node = root.querySelectorAll<HTMLElement>(selector)[nth];
  if (!node) throw new Error(`no ${selector} #${nth}`);
  node.click();
};

describe("TransferMode", () => {
  it("shows no plates until a move starts, then one per own yard in sight, and none after it ends", async () => {
    const { layer } = make();
    expect(layer.querySelector(".xfer-plate")).toBeNull();
    await mode!.start("main", "out");
    expect(layer.querySelectorAll(".xfer-plate").length).toBe(4);
    expect(layer.querySelector(".xfer-plate.is-anchor")?.textContent).toContain("From");
    expect(layer.querySelector(".xfer-plate.is-attack")).not.toBeNull();
    expect(layer.querySelector(".xfer-tray .panel__title")?.textContent).toBe("Move from Main yard");
    mode!.end();
    expect(layer.querySelector(".xfer-plate")).toBeNull();
    expect(layer.querySelector(".xfer-tray")).toBeNull();
  });

  it("Go waits for a pick and a tick, and says so", async () => {
    const { layer } = make();
    await mode!.start("main", "out");
    const go = () => layer.querySelector<HTMLButtonElement>(".xfer-go")!;
    expect(go().disabled).toBe(true);
    expect(go().textContent).toBe("Pick monsters");
    click(layer, ".xfer-chip__face", 0);
    expect(go().textContent).toBe("Tap outposts");
    mode!.tapCell(11, 10);
    expect(go().disabled).toBe(false);
    expect(go().textContent).toContain("Move 60");
  });

  it("Near 5 ticks the nearest outposts with room, never one under attack; Go sends one pair each", async () => {
    const { layer, sent, options } = make();
    await mode!.start("main", "out");
    click(layer, ".xfer-chip__face", 0);
    click(layer, ".xfer-quick");
    expect(layer.querySelectorAll(".xfer-plate.is-on").length).toBe(2);
    expect(layer.querySelector(".xfer-plate.is-attack.is-on")).toBeNull();
    click(layer, ".xfer-go");
    await flush();
    // Even split by default, the outpost off screen included: 20 each.
    expect(sent).toEqual([
      [
        { from: "main", to: "a", moved: { C1: 20 } },
        { from: "main", to: "b", moved: { C1: 20 } },
        { from: "main", to: "far", moved: { C1: 20 } },
      ],
    ]);
    expect(options.onMoved).toHaveBeenCalledWith(["main", "a", "main", "b", "main", "far"]);
    expect(layer.querySelector(".xfer-toast")?.textContent).toContain("60");
  });

  it("a yard under attack cannot be ticked", async () => {
    const { layer } = make();
    await mode!.start("main", "out");
    mode!.tapCell(13, 10);
    expect(layer.querySelector(".xfer-plate.is-on")).toBeNull();
  });

  it("the stepper sets a number below all", async () => {
    const { layer, sent } = make();
    await mode!.start("main", "out");
    click(layer, ".xfer-chip__count", 0);
    expect(layer.querySelector(".xfer-chip.is-stepping")).not.toBeNull();
    click(layer, ".xfer-step", 0); // −: 59
    click(layer, ".xfer-step", 0); // −: 58
    mode!.tapCell(11, 10);
    click(layer, ".xfer-go");
    await flush();
    expect(sent[0]).toEqual([{ from: "main", to: "a", moved: { C1: 58 } }]);
  });

  it("bringing home starts with every type picked; All home ticks every outpost with monsters", async () => {
    const { layer, sent } = make();
    await mode!.start("main", "in");
    expect(layer.querySelector(".xfer-tray .panel__title")?.textContent).toBe("Bring to Main yard");
    click(layer, ".xfer-quick");
    click(layer, ".xfer-go");
    await flush();
    expect(sent[0]).toEqual([
      { from: "b", to: "main", moved: { C1: 5 } },
      { from: "far", to: "main", moved: { C12: 2 } },
    ]);
  });

  it("the List shows yards off screen too, searchable, and ticking a row ticks the yard", async () => {
    const { layer, modal } = make();
    await mode!.start("main", "in");
    click(layer, ".xfer-listb");
    const rows = () => [...modal.querySelectorAll<HTMLButtonElement>(".xfer-row")];
    expect(rows().map((row) => row.querySelector("b")?.textContent)).toEqual(["12, 10", "40, 40"]);
    const search = modal.querySelector<HTMLInputElement>(".xfer-list__input")!;
    search.value = "40,4";
    search.dispatchEvent(new Event("input"));
    expect(rows().length).toBe(1);
    rows()[0]!.click();
    expect(rows()[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(layer.querySelector(".xfer-go")?.textContent).toContain("Bring 2 home");
  });

  it("a refused move says why, reads the yards again and stays open", async () => {
    const load = vi.fn(async () => yards());
    const { layer } = make({ load, send: async () => Promise.reject(new Error("there is not enough Monster Housing at the destination.")) });
    await mode!.start("main", "out");
    click(layer, ".xfer-chip__face", 0);
    mode!.tapCell(11, 10);
    click(layer, ".xfer-go");
    await flush();
    expect(layer.querySelector(".xfer-toast")?.textContent).toContain("not enough Monster Housing");
    expect(load).toHaveBeenCalledTimes(2);
    expect(mode!.active).toBe(true);
  });

  it("outlines the anchor and the ticked yards on the map, and clears them at the end", async () => {
    const { marks } = make();
    await mode!.start("main", "out");
    mode!.tapCell(11, 10);
    expect(marks.at(-1)).toEqual([
      { col: 10, row: 10, kind: "anchor" },
      { col: 11, row: 10, kind: "on" },
    ]);
    mode!.end();
    expect(marks.at(-1)).toBeNull();
  });
});
