import { describe, expect, test } from "bun:test";
import type { ClientSafeError } from "../../middleware/clientSafeError.js";
import type { ChampionData } from "../../schemas/ChampionSchema.js";
import { catchUpChampions } from "./catchUpChampions.js";
import type { ChampionSave } from "./champion.js";
import { frozenBlob, planChampionFreeze, planChampionThaw } from "./chamber.js";

/**
 * The Champion Chamber (`services/yard/chamber.ts`): freeze and thaw as
 * `client/scripts/CHAMPIONCHAMBER.as:103-221` did them.
 */

const NOW = 1_800_000_000;
const HOUR = 3_600;

const CAGE = { id: 3, t: 114, x: 0, y: 0, l: 1 };
const CHAMBER = { id: 4, t: 119, x: 200, y: 0, l: 1, fz: "[]" };

const gorgo = (overrides: Partial<ChampionData> = {}): ChampionData => ({
  t: 1,
  hp: 40_000,
  l: 1,
  ft: NOW + 5 * HOUR,
  fd: 2,
  fb: 0,
  pl: 1,
  status: 0,
  ...overrides,
});

const yard = (champion: ChampionData[], chamber: Record<string, unknown> = {}): ChampionSave => ({
  buildingdata: { "3": { ...CAGE }, "4": { ...CHAMBER, ...chamber } },
  buildinghealthdata: {},
  champion,
});

const refusal = (plan: () => unknown): unknown => {
  try {
    plan();
  } catch (err) {
    return ((err as ClientSafeError).data as { reason?: unknown }).reason;
  }
  throw new Error("expected a refusal");
};

describe("champion/freeze", () => {
  test("stops the feed clock (relative ft), status 1, and writes the chamber's fz", () => {
    const outcome = planChampionFreeze(yard([gorgo({ nm: "Kong" })]), NOW);
    const frozen = outcome.slices.champion[0]!;
    expect(frozen).toMatchObject({ status: 1, ft: 5 * HOUR, nm: "Kong" });
    expect(JSON.parse(String(outcome.slices.buildingdata["4"]!.fz))).toEqual([
      { nm: "Kong", t: 1, hp: 40_000, l: 1, ft: 5 * HOUR, fd: 2, fb: 0, pl: 1, status: 1 },
    ]);
  });

  test("refuses an injured or hungry champion, and without a chamber", () => {
    expect(refusal(() => planChampionFreeze(yard([gorgo({ hp: 39_999 })]), NOW))).toBe("injured");
    expect(refusal(() => planChampionFreeze(yard([gorgo({ ft: NOW - 1 })]), NOW))).toBe("hungry");
    expect(refusal(() => planChampionFreeze(yard([]), NOW))).toBe("noChampion");
    const none: ChampionSave = { buildingdata: { "3": { ...CAGE } }, champion: [gorgo()] };
    expect(refusal(() => planChampionFreeze(none, NOW))).toBe("noChamber");
    expect(refusal(() => planChampionFreeze(yard([gorgo()], { cB: 50 }), NOW))).toBe("busy");
  });

  test("a frozen champion neither heals nor starves", () => {
    const save = { champion: [gorgo({ status: 1, ft: HOUR, hp: 1 })] };
    expect(catchUpChampions(save, NOW - 100 * HOUR, NOW)).toEqual([]);
    expect(save.champion[0]).toMatchObject({ hp: 1, ft: HOUR });
  });
});

describe("champion/thaw", () => {
  test("restarts the clock where it stopped and puts it back in the cage", () => {
    const later = NOW + 30 * 24 * HOUR;
    const frozen = planChampionFreeze(yard([gorgo()]), NOW).slices.champion;
    const outcome = planChampionThaw(yard(frozen), 1, later);
    expect(outcome.slices.champion[0]).toMatchObject({ status: 0, ft: later + 5 * HOUR, fd: 2 });
    expect(outcome.slices.buildingdata["4"]!.fz).toBe("[]");
  });

  test("refuses while a champion is in the cage, the chamber is damaged, or none is frozen", () => {
    const frozenDrull = gorgo({ t: 2, status: 1, ft: HOUR, hp: 12_000 });
    expect(refusal(() => planChampionThaw(yard([gorgo(), frozenDrull]), 2, NOW))).toBe("championInCage");
    expect(refusal(() => planChampionThaw(yard([frozenDrull], { hp: 100 }), 2, NOW))).toBe("damaged");
    expect(refusal(() => planChampionThaw(yard([frozenDrull]), 1, NOW))).toBe("notFrozen");
    const noCage: ChampionSave = { buildingdata: { "4": { ...CHAMBER } }, champion: [frozenDrull] };
    expect(refusal(() => planChampionThaw(noCage, 2, NOW))).toBe("noCage");
  });

  test("swaps champions: freeze one, raise or thaw another", () => {
    const frozenDrull = gorgo({ t: 2, status: 1, ft: HOUR, hp: 12_000 });
    const afterFreeze = planChampionFreeze(yard([gorgo(), frozenDrull]), NOW).slices.champion;
    const afterThaw = planChampionThaw(yard(afterFreeze), 2, NOW).slices.champion;
    expect(afterThaw.map((one) => [one.t, one.status])).toEqual([
      [1, 1],
      [2, 0],
    ]);
    expect(JSON.parse(frozenBlob(afterThaw)).map((one: { t: number }) => one.t)).toEqual([1]);
  });
});

describe("champion/freeze and thaw for Krallen", () => {
  const krallen = (overrides: Partial<ChampionData> = {}) => gorgo({ t: 5, l: 5, hp: 62_000, ...overrides });

  test("Krallen freezes beside the basic champion in the cage", () => {
    const outcome = planChampionFreeze(yard([gorgo(), krallen()]), NOW, 5);
    expect(outcome.slices.champion.map((one) => [one.t, one.status])).toEqual([
      [1, 0],
      [5, 1],
    ]);
  });

  test("a frozen Krallen thaws while the basic champion is in the cage", () => {
    const save = yard([gorgo(), krallen({ status: 1, ft: HOUR })]);
    const thawed = planChampionThaw(save, 5, NOW).slices.champion;
    expect(thawed.map((one) => [one.t, one.status])).toEqual([
      [1, 0],
      [5, 0],
    ]);
  });
});
