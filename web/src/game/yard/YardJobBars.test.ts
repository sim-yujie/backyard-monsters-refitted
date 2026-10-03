import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import { readYard, type Yard } from "./yardModel";
import {
  jobBarScale,
  jobBarStates,
  showsJobBarText,
  TEXT_MIN_ZOOM,
  YardJobBars,
} from "./YardJobBars";

/**
 * The progress bars drawn over running builds and upgrades (#139): which
 * buildings get one, what it reads, and that a foreign yard gets none.
 */

const SAVED = 1_700_000_000;
const CANNON = 20;

const yardOf = (rows: BuildingData[], options: { foreign?: boolean } = {}): Yard =>
  readYard(
    {
      error: 0,
      currenttime: SAVED,
      savetime: SAVED,
      buildingdata: Object.fromEntries(rows.map((row) => [String(row.id), row])),
      buildinghealthdata: {},
      storedata: {},
    } as unknown as BaseLoadResponse,
    options,
  );

const row = (id: number, extra: Partial<BuildingData> = {}): BuildingData => ({
  id,
  t: CANNON,
  l: 4,
  X: id * 40,
  Y: 0,
  ...extra,
});

/** Idle, upgrading, building, fortifying and a damaged upgrade. */
const mixed = (): BuildingData[] => [
  row(1),
  row(2, { cU: 600, cL: 1_200 }),
  row(3, { l: 0, cB: 30, cL: 60 }),
  row(4, { cF: 500 }),
  row(5, { cU: 900, cL: 1_800, hp: 10 }),
];

describe("jobBarStates", () => {
  it("one bar per running build or upgrade, reading the panel's progress", () => {
    const bars = jobBarStates(yardOf(mixed()), SAVED);

    expect(bars.map((bar) => bar.id).sort()).toEqual([2, 3, 5]);
    const byId = new Map(bars.map((bar) => [bar.id, bar]));
    expect(byId.get(2)).toEqual({
      id: 2,
      kind: "upgrade",
      fraction: 0.5,
      remaining: 600,
      paused: false,
      label: "10m 0s",
    });
    expect(byId.get(3)).toMatchObject({ kind: "build", fraction: 0.5, label: "30s" });
  });

  it("a paused job keeps its bar, greyed and marked Paused", () => {
    const bar = jobBarStates(yardOf(mixed()), SAVED + 400).find((one) => one.id === 5);
    expect(bar).toMatchObject({ paused: true, remaining: 900, fraction: 0.5, label: "Paused" });
  });

  it("counts down with the clock and drops a bar once its time is up", () => {
    const later = jobBarStates(yardOf(mixed()), SAVED + 300);
    expect(later.find((bar) => bar.id === 2)).toMatchObject({ remaining: 300, fraction: 0.75 });

    const done = jobBarStates(yardOf(mixed()), SAVED + 600);
    expect(done.map((bar) => bar.id)).not.toContain(2);
    // The build ended at +30; the frozen upgrade is still there.
    expect(done.map((bar) => bar.id)).not.toContain(3);
    expect(done.map((bar) => bar.id)).toContain(5);
  });

  it("an older job with no stored length reads against the table's time", () => {
    // Cannon L4 → L5 is 24,300 s by the table.
    const [bar] = jobBarStates(yardOf([row(2, { cU: 19_440 })]), SAVED);
    expect(bar?.fraction).toBeCloseTo(0.2, 5);
  });

  it("none on somebody else's yard", () => {
    expect(jobBarStates(yardOf(mixed(), { foreign: true }), SAVED)).toEqual([]);
  });
});

describe("zoom", () => {
  it("the bar grows against a shrinking yard, to a limit, and never shrinks below world size", () => {
    expect(jobBarScale(2)).toBe(1);
    expect(jobBarScale(1)).toBe(1);
    expect(jobBarScale(0.8)).toBeCloseTo(1.25, 5);
    expect(jobBarScale(0.1)).toBe(1.8);
  });

  it("the time text goes at small zoom; the bar stays", () => {
    expect(showsJobBarText(0.9)).toBe(true);
    expect(showsJobBarText(TEXT_MIN_ZOOM)).toBe(true);
    expect(showsJobBarText(0.3)).toBe(false);
  });
});

describe("YardJobBars", () => {
  const anchor = (id: number) => ({ x: id * 100, y: -id * 10 });

  it("draws nothing until it has a clock", () => {
    const bars = new YardJobBars(anchor);
    bars.show(yardOf(mixed()));
    expect(bars.ids).toEqual([]);
    expect(bars.root.children).toHaveLength(0);
  });

  it("draws a bar over each running job, in depth order, above its anchor", () => {
    const bars = new YardJobBars(anchor);
    bars.setClock(() => SAVED);
    const yard = yardOf(mixed());
    bars.show(yard);

    const expected = yard.buildings.map((one) => one.id).filter((id) => [2, 3, 5].includes(id));
    expect(bars.ids).toEqual(expected);
    const first = bars.root.children[0];
    expect(first?.position.x).toBe(expected[0]! * 100);
    expect(first?.position.y).toBeLessThan(-expected[0]! * 10);
  });

  it("stops drawing when the clock is taken away, and on a foreign yard", () => {
    const bars = new YardJobBars(anchor);
    bars.setClock(() => SAVED);
    bars.show(yardOf(mixed()));
    bars.setClock(null);
    expect(bars.ids).toEqual([]);

    bars.setClock(() => SAVED);
    bars.show(yardOf(mixed(), { foreign: true }));
    expect(bars.ids).toEqual([]);
  });

  it("hides a bar the moment its time is up, before the store redraws the yard", () => {
    let now = SAVED;
    const bars = new YardJobBars(anchor);
    bars.setClock(() => now);
    bars.show(yardOf(mixed()));
    expect(bars.ids).toContain(2);

    now = SAVED + 600;
    bars.update();
    expect(bars.ids).not.toContain(2);
    expect(bars.ids).toContain(5);
    // A planner move re-anchors the bars; a finished one stays hidden.
    bars.reposition();
    expect(bars.ids).not.toContain(2);
  });

  it("hides the bar of a building that is not drawn", () => {
    const bars = new YardJobBars((id) => (id === 2 ? null : anchor(id)));
    bars.setClock(() => SAVED);
    bars.show(yardOf(mixed()));
    expect(bars.ids).not.toContain(2);
    expect(bars.ids).toContain(3);
    // It still has a bar, so its countdown badge stays hidden (#230).
    expect([...bars.barIds].sort()).toEqual([2, 3, 5]);
  });

  it("sits a fixed gap above its anchor, whatever the building (#230)", () => {
    const bars = new YardJobBars(anchor);
    bars.setClock(() => SAVED);
    bars.show(yardOf(mixed()));
    const gaps = bars.root.children.map((bar, index) => {
      const id = bars.ids[index]!;
      return anchor(id).y - bar.position.y;
    });
    expect(new Set(gaps).size).toBe(1);
    expect(gaps[0]).toBeGreaterThan(0);
    expect(gaps[0]).toBeLessThanOrEqual(8);
  });

  it("names no bars without a clock", () => {
    const bars = new YardJobBars(anchor);
    bars.show(yardOf(mixed()));
    expect(bars.barIds.size).toBe(0);
  });

  it("hides the text at small zoom and keeps the bar", () => {
    const bars = new YardJobBars(anchor);
    bars.setClock(() => SAVED);
    bars.show(yardOf(mixed()));
    bars.setZoom(0.3);

    const bar = bars.root.children[0];
    const text = bar?.children[2];
    expect(bar?.visible).toBe(true);
    expect(text?.visible).toBe(false);
    expect(bar?.scale.x).toBe(1.8);
  });
});
