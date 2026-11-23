// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArmyYard, MovePair } from "@/game/maproom/transferPlan";
import { TransferMode, type TransferModeOptions } from "./TransferMode";

/**
 * Move mode on the world map (beta 9 #7, the owner's "B1 steel plates", made
 * simpler 23 Nov): plates only while moving; Bring to starts with every yard
 * ticked and every count at 0; Move from goes to one target; counts never go
 * past the target's room; one move of several pairs sent to the server.
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
  document.body.append(layer);
  const sent: MovePair[][] = [];
  const marks: unknown[] = [];
  const options: TransferModeOptions = {
    layer,
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
  return { layer, sent, marks, options };
};

const click = (root: ParentNode, selector: string, nth = 0): void => {
  const node = root.querySelectorAll<HTMLElement>(selector)[nth];
  if (!node) throw new Error(`no ${selector} #${nth}`);
  node.click();
};

const go = (layer: HTMLElement) => layer.querySelector<HTMLButtonElement>(".xfer-go")!;
/** The chips' "picked/most", in tray order. */
const counts = (layer: HTMLElement): string[] =>
  [...layer.querySelectorAll<HTMLElement>(".xfer-chip")].map((chip) =>
    (chip.querySelector(".xfer-chip__count, .xfer-step__n")?.textContent ?? "").replace(/\s/g, ""),
  );
/** Opens a chip's stepper and presses one of its buttons. */
const step = (layer: HTMLElement, nth: number, which: "less" | "more" | "max" | "ok"): void => {
  if (!layer.querySelector(`.xfer-chip.is-stepping`)) click(layer, ".xfer-chip", nth);
  const index = { less: 0, more: 1, max: 2, ok: 3 }[which];
  click(layer, ".xfer-chip.is-stepping .xfer-step", index);
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

  it("the tray has the chips, All, the room and Go: no Near 5, All home, List or Even", async () => {
    const { layer } = make();
    await mode!.start("main", "out");
    expect(layer.querySelector(".xfer-quick, .xfer-listb, .xfer-split, .xfer-list")).toBeNull();
    await mode!.start("main", "in");
    expect(layer.querySelector(".xfer-quick, .xfer-listb, .xfer-split, .xfer-list")).toBeNull();
    expect(layer.querySelector(".xfer-all")).not.toBeNull();
  });

  it("Move from: every count starts at 0; a tap sets the one target, another moves it, tapping it again clears it", async () => {
    const { layer } = make();
    await mode!.start("main", "out");
    expect(counts(layer)).toEqual(["0/60", "0/10"]);
    expect(go(layer).disabled).toBe(true);
    expect(go(layer).textContent).toBe("Tap a yard");
    mode!.tapCell(11, 10);
    expect(go(layer).textContent).toBe("Pick monsters");
    step(layer, 0, "more");
    step(layer, 0, "more");
    expect(go(layer).disabled).toBe(false);
    expect(go(layer).textContent).toBe("Move 2" + "11, 10");
    mode!.tapCell(12, 10);
    expect(layer.querySelectorAll(".xfer-plate.is-on").length).toBe(1);
    expect(layer.querySelector<HTMLElement>(".xfer-plate.is-on")?.dataset["baseid"]).toBe("b");
    expect(go(layer).textContent).toBe("Move 2" + "12, 10");
    mode!.tapCell(12, 10);
    expect(layer.querySelector(".xfer-plate.is-on")).toBeNull();
    expect(go(layer).textContent).toBe("Tap a yard");
    expect(go(layer).disabled).toBe(true);
  });

  it("All fills in roster order until the target is full; + and Max stop there; Go sends one pair", async () => {
    const { layer, sent } = make();
    await mode!.start("main", "out");
    // b has 505 free: 60 Pokeys (420), then 8 Octo-oozes (80).
    mode!.tapCell(12, 10);
    click(layer, ".xfer-all");
    expect(counts(layer)).toEqual(["60/60", "8/10"]);
    expect(layer.querySelector(".xfer-status")?.textContent).toContain("Full");
    click(layer, ".xfer-chip", 1);
    const [less, more, max] = [...layer.querySelectorAll<HTMLButtonElement>(".xfer-chip.is-stepping .xfer-step")];
    expect(less!.disabled).toBe(false);
    expect(more!.disabled).toBe(true);
    expect(max!.disabled).toBe(true);
    expect(go(layer).textContent).toBe("Move 68" + "12, 10");
    click(layer, ".xfer-go");
    await flush();
    expect(sent).toEqual([[{ from: "main", to: "b", moved: { C1: 60, C2: 8 } }]]);
  });

  it("Move from: counts picked before a target are cut to the room of the yard tapped", async () => {
    const { layer } = make();
    await mode!.start("main", "out");
    click(layer, ".xfer-all");
    expect(counts(layer)).toEqual(["60/60", "10/10"]);
    // far (off screen) has 355 free: 50 Pokeys, no Octo-ooze.
    mode!.tapCell(40, 40);
    expect(counts(layer)).toEqual(["50/60", "0/10"]);
    expect(go(layer).textContent).toBe("Move 50" + "40, 40");
  });

  it("a yard under attack cannot be the target", async () => {
    const { layer } = make();
    await mode!.start("main", "out");
    mode!.tapCell(13, 10);
    expect(layer.querySelector(".xfer-plate.is-on")).toBeNull();
  });

  it("Bring to: every yard with monsters starts ticked, never one under attack, and every count at 0", async () => {
    const { layer, sent } = make();
    await mode!.start("main", "in");
    expect(layer.querySelector(".xfer-tray .panel__title")?.textContent).toBe("Bring to Main yard");
    // b and far (off screen) ticked; c is under attack, a is empty.
    expect([...layer.querySelectorAll<HTMLElement>(".xfer-plate.is-on")].map((p) => p.dataset["baseid"])).toEqual(["b"]);
    expect(counts(layer)).toEqual(["0/5", "0/2"]);
    expect(go(layer).disabled).toBe(true);
    expect(go(layer).textContent).toBe("Pick monsters");
    step(layer, 1, "max");
    expect(go(layer).disabled).toBe(false);
    expect(go(layer).textContent).toBe("Bring 2 home");
    click(layer, ".xfer-go");
    await flush();
    expect(sent).toEqual([[{ from: "far", to: "main", moved: { C12: 2 } }]]);
  });

  it("Bring to: unticking a yard takes its monsters off the counts, and the picks stay cut when it is ticked again", async () => {
    const { layer } = make();
    await mode!.start("main", "in");
    step(layer, 0, "max");
    expect(counts(layer)[0]).toBe("5/5");
    mode!.tapCell(12, 10);
    expect(counts(layer)).toEqual(["0/0", "0/2"]);
    expect(layer.querySelectorAll<HTMLButtonElement>(".xfer-chip")[0]!.disabled).toBe(true);
    mode!.tapCell(12, 10);
    expect(counts(layer)).toEqual(["0/5", "0/2"]);
  });

  it("Bring to an outpost: the main yard gives first", async () => {
    const { layer, sent } = make();
    await mode!.start("a", "in");
    expect(counts(layer)).toEqual(["0/65", "0/10", "0/2"]);
    step(layer, 0, "max");
    step(layer, 0, "ok");
    click(layer, ".xfer-go");
    await flush();
    expect(sent[0]).toEqual([
      { from: "main", to: "a", moved: { C1: 60 } },
      { from: "b", to: "a", moved: { C1: 5 } },
    ]);
  });

  it("a refused move says why, reads the yards again and stays open", async () => {
    const load = vi.fn(async () => yards());
    const { layer } = make({ load, send: async () => Promise.reject(new Error("there is not enough Monster Housing at the destination.")) });
    await mode!.start("main", "out");
    mode!.tapCell(11, 10);
    step(layer, 0, "max");
    click(layer, ".xfer-go");
    await flush();
    expect(layer.querySelector(".xfer-toast")?.textContent).toContain("not enough Monster Housing");
    expect(load).toHaveBeenCalledTimes(2);
    expect(mode!.active).toBe(true);
  });

  it("outlines the anchor and the target on the map, and clears them at the end", async () => {
    const { layer, marks } = make();
    await mode!.start("main", "out");
    mode!.tapCell(11, 10);
    expect(marks.at(-1)).toEqual([
      { col: 10, row: 10, kind: "anchor" },
      { col: 11, row: 10, kind: "on" },
    ]);
    const before = marks.length;
    mode!.tapCell(12, 10);
    expect(marks.at(-1)).toEqual([
      { col: 10, row: 10, kind: "anchor" },
      { col: 12, row: 10, kind: "on" },
    ]);
    // A count changing does not redraw the outlines.
    step(layer, 0, "more");
    expect(marks.length).toBe(before + 1);
    mode!.end();
    expect(marks.at(-1)).toBeNull();
  });
});
