import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { juiceGoo, juicePreview, juicerRate, juicerStatus } from "./juice";

/** The Juicer rules the Housing tab and the Bunker panel price with (server: `services/yard/juice.ts`). */

const saveOf = (buildingdata: Record<string, object>, extra: object = {}): BaseLoadResponse =>
  ({ buildingdata, buildinghealthdata: {}, academy: {}, ...extra }) as unknown as BaseLoadResponse;

describe("juicer", () => {
  it("rates 60/80/100% by level, clamped", () => {
    expect([0, 1, 2, 3, 4].map(juicerRate)).toEqual([0.6, 0.6, 0.8, 1, 1]);
  });

  it("works when built, idle and above half health; says why not otherwise", () => {
    expect(juicerStatus(saveOf({}))).toEqual({ ok: false, problem: "noJuicer", id: null });
    expect(juicerStatus(saveOf({ "4": { id: 4, t: 9, l: 3 } }))).toEqual({ ok: true, id: 4, level: 3, rate: 1 });
    expect(juicerStatus(saveOf({ "4": { id: 4, t: 9, l: 0, cB: 5 } }))).toMatchObject({ problem: "building" });
    expect(juicerStatus(saveOf({ "4": { id: 4, t: 9, l: 1, cU: 5 } }))).toMatchObject({ problem: "upgrading" });
    // Level 1: 16,000 health.
    const at = (hp: number) => juicerStatus(saveOf({ "4": { id: 4, t: 9, l: 1 } }, { buildinghealthdata: { "4": hp } }));
    expect(at(8_000)).toMatchObject({ ok: false, problem: "damaged" });
    expect(at(8_001)).toMatchObject({ ok: true });
  });

  it("prefers a working Juicer, the highest level first", () => {
    const status = juicerStatus(
      saveOf({
        "1": { id: 1, t: 9, l: 3, cU: 60 },
        "2": { id: 2, t: 9, l: 1 },
        "3": { id: 3, t: 9, l: 2 },
      }),
    );
    expect(status).toEqual({ ok: true, id: 3, level: 2, rate: 0.8 });
  });
});

describe("juice goo", () => {
  it("is ceil(cResource × rate) per monster at its academy level", () => {
    const save = saveOf({}, { academy: { C1: { level: 3 } } });
    // Pokey at level 3: 675; 675 × 0.8 = 540; 675 × 0.6 = 405.
    expect(juiceGoo(save, "C1", 2, 0.8)).toBe(1_080);
    expect(juiceGoo(save, "C1", 1, 0.6)).toBe(405);
    expect(juiceGoo(save, "C2", 1, 0.6)).toBe(300);
  });

  it("previews the cap: what lands and what is lost; a pool over the cap takes nothing", () => {
    const save = saveOf({});
    const caps = { r1: 10_000, r2: 10_000, r3: 10_000, r4: 10_000 };
    expect(juicePreview(save, { C2: 10 }, 1, { r1: 0, r2: 0, r3: 0, r4: 7_000 }, caps)).toEqual({
      count: 10,
      goo: 5_000,
      credited: 3_000,
      lost: 2_000,
    });
    expect(juicePreview(save, { C2: 1 }, 1, { r1: 0, r2: 0, r3: 0, r4: 12_000 }, caps)).toMatchObject({
      credited: 0,
      lost: 500,
    });
    expect(juicePreview(save, { C2: 1 }, 1, { r1: 0, r2: 0, r3: 0, r4: 12_000 }, null)).toMatchObject({
      credited: 500,
      lost: 0,
    });
  });
});
