// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, CompletedJob } from "@/api/types";
import { JobKind, type YardJob } from "@/game/yard/jobs";
import { YardView } from "@/game/yard/YardRenderer";
import { YardChangeReason, type YardChange, type YardListener } from "@/game/yard/YardStore";
import { hatcheriesFor, hatchingMonster, HatchWalkOuts, plannedWalks } from "./hatchWalkOut";

/** Hatched monsters walk out of their Hatchery to Housing (issue #228). */

const save = {
  monsters: {
    housed: { C1: 15, C2: 2 },
    hid: [4, 9],
    h: [
      ["C1", 15, []],
      ["C2", 0, []],
    ],
    hstage: [1, 1],
  },
} as unknown as BaseLoadResponse;

const hatchJob = (building: number): YardJob => ({
  kind: JobKind.HATCH,
  key: `hatch:${building}`,
  id: building,
  buildingId: building,
  endsAt: 100,
  holdsWorker: false,
});

const hatched = (monster: string, count: number): CompletedJob => ({
  kind: "hatch",
  id: monster,
  t: null,
  at: 100,
  detail: { count },
});

const predicted = (...jobs: YardJob[]): YardChange => ({ reason: YardChangeReason.PREDICTED, completed: [], predicted: jobs });
const answered = (...completed: CompletedJob[]): YardChange => ({ reason: YardChangeReason.REFRESH, completed, predicted: [] });

describe("which Hatchery makes what", () => {
  it("reads the monster a hatchery is making, or null for an idle one or a stranger", () => {
    expect(hatchingMonster(save.monsters, 4)).toBe("C1");
    expect(hatchingMonster(save.monsters, 7)).toBeNull();
    const idle = { ...save.monsters, h: [["", 0, []]] } as BaseLoadResponse["monsters"];
    expect(hatchingMonster(idle, 4)).toBeNull();
  });

  it("lists every hatchery, those making the monster first", () => {
    expect(hatcheriesFor(save.monsters, "C2")).toEqual([9, 4]);
    expect(hatcheriesFor(save.monsters, "C5")).toEqual([4, 9]);
  });
});

describe("plannedWalks", () => {
  it("walks a predicted hatch from its Hatchery, the pens held at what is housed now", () => {
    const { walks, ahead } = plannedWalks(predicted(hatchJob(4)), save, new Map());
    expect(walks).toEqual([{ monster: "C1", count: 1, hatcheries: [4], cap: 15 }]);
    expect([...ahead]).toEqual([["C1", 1]]);
  });

  it("walks only what the server hatched beyond the predictions, and starts the count again", () => {
    const after = { ...save, monsters: { ...save.monsters, housed: { C1: 18, C2: 2 } } } as BaseLoadResponse;
    const { walks, ahead } = plannedWalks(answered(hatched("C1", 3), hatched("C2", 1)), after, new Map([["C1", 1], ["C2", 1]]));
    expect(walks).toEqual([{ monster: "C1", count: 2, hatcheries: [4, 9], cap: 16 }]);
    expect(ahead.size).toBe(0);
  });

  it("forgets a predicted hatch the server did not make", () => {
    expect(plannedWalks(answered(), save, new Map([["C1", 1]])).ahead.size).toBe(0);
    // ... so the next one the server makes walks.
    expect(plannedWalks(answered(hatched("C1", 1)), save, new Map()).walks).toHaveLength(1);
  });

  it("walks nothing for other changes and other jobs", () => {
    const upgrade: YardJob = { ...hatchJob(4), kind: JobKind.UPGRADE, key: "upgrade:4" };
    expect(plannedWalks(predicted(upgrade, hatchJob(7)), save, new Map()).walks).toEqual([]);
    const away: YardChange = { reason: YardChangeReason.AWAY, completed: [hatched("C1", 5)], predicted: [] };
    const kept = plannedWalks(away, save, new Map([["C1", 1]]));
    expect(kept.walks).toEqual([]);
    expect([...kept.ahead]).toEqual([["C1", 1]]);
  });
});

describe("HatchWalkOuts", () => {
  const yard = {
    buildings: [
      { id: 4, type: 13, x: 0, y: 0, footprint: [100, 100] },
      { id: 5, type: 15, x: 200, y: 0, footprint: [80, 80] },
    ],
    bounds: { yardWidth: 1000 },
  };
  const made: HatchWalkOuts[] = [];

  afterEach(() => {
    while (made.length) made.pop()?.destroy();
  });

  const setUp = (options: { view?: YardView; quiet?: boolean } = {}) => {
    let listener: YardListener = () => {};
    const release = vi.fn();
    const renderer = {
      standAmongBuildings: vi.fn(),
      leaveBuildings: vi.fn(),
      yardToWorld: (x: number, y: number) => ({ x, y }),
      holdLife: vi.fn(() => release),
      view: options.view ?? YardView.ISO,
    };
    const store = {
      save,
      yard,
      subscribe: (next: YardListener) => {
        listener = next;
        return () => {
          listener = () => {};
        };
      },
    } as unknown as ConstructorParameters<typeof HatchWalkOuts>[0]["store"];
    const walks = new HatchWalkOuts({ store, renderer, quiet: () => options.quiet ?? false });
    made.push(walks);
    return { walks, renderer, release, emit: (change: YardChange) => listener(change) };
  };

  it("walks a hatched Pokey out and keeps it out of the pen until the walk is over", () => {
    const { walks, renderer, release, emit } = setUp();
    emit(predicted(hatchJob(4)));
    expect(walks.walking).toBe(1);
    expect(renderer.holdLife).toHaveBeenCalledWith("C1", 15);
    expect(release).not.toHaveBeenCalled();

    walks.destroy();
    expect(release).toHaveBeenCalledOnce();
    expect(walks.walking).toBe(0);
  });

  it("walks nothing in the blueprint or with the planner open", () => {
    for (const options of [{ view: YardView.BLUEPRINT }, { quiet: true }]) {
      const { walks, renderer, emit } = setUp(options);
      emit(predicted(hatchJob(4)));
      expect(walks.walking).toBe(0);
      expect(renderer.holdLife).not.toHaveBeenCalled();
    }
  });

  it("lets the pen go when there is no Housing to walk to", () => {
    const { walks, release, emit } = setUp();
    yard.buildings.pop();
    try {
      emit(predicted(hatchJob(4)));
      expect(walks.walking).toBe(0);
      expect(release).toHaveBeenCalledOnce();
    } finally {
      yard.buildings.push({ id: 5, type: 15, x: 200, y: 0, footprint: [80, 80] });
    }
  });
});
