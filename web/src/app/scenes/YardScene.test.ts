// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import type { ViewTarget } from "@/game/attack/attackTarget";
import { MAIN_YARD, outpostTarget } from "@/game/yard/ownYards";
import { hudPoolFor, loadYardFor, refusalNotice } from "./YardScene";

const response = { error: 0, id: 1, baseid: "1000", basesaveid: 1 } as BaseLoadResponse;

const api = () => ({
  loadOwnYard: vi.fn(() => Promise.resolve(response)),
  loadOwnBase: vi.fn(() => Promise.resolve(response)),
  viewBase: vi.fn(() => Promise.resolve(response)),
});

const visit = (kind: ViewTarget["kind"]): ViewTarget => ({
  baseid: "21970243208",
  kind,
  cell: { col: 243, row: 208 },
  name: "Abunakki",
  attack: null,
  refusal: "None of your flingers can reach this cell.",
});

describe("loadYardFor", () => {
  it("loads the player's own yard when there is no target", async () => {
    const loaders = api();
    await loadYardFor(null, loaders);
    expect(loaders.loadOwnYard).toHaveBeenCalledTimes(1);
    expect(loaders.viewBase).not.toHaveBeenCalled();
  });

  it("opens an own outpost by its baseid, and the main yard as it always did (#146)", async () => {
    const loaders = api();
    await loadYardFor(null, loaders, outpostTarget("2000242209", { col: 242, row: 209 }));
    await loadYardFor(null, loaders, MAIN_YARD);
    expect(loaders.loadOwnBase.mock.calls).toEqual([["2000242209"]]);
    expect(loaders.loadOwnYard).toHaveBeenCalledTimes(1);
    expect(loaders.viewBase).not.toHaveBeenCalled();
  });

  it("views a foreign target even when an own outpost was asked for", async () => {
    const loaders = api();
    await loadYardFor(visit("main"), loaders, outpostTarget("2000242209"));
    expect(loaders.loadOwnBase).not.toHaveBeenCalled();
    expect(loaders.viewBase).toHaveBeenCalledTimes(1);
  });

  it("never loads the own yard for a foreign target, and views it by kind", async () => {
    const loaders = api();
    await loadYardFor(visit("wild"), loaders);
    await loadYardFor(visit("main"), loaders);
    expect(loaders.loadOwnYard).not.toHaveBeenCalled();
    expect(loaders.viewBase.mock.calls).toEqual([
      ["21970243208", "wild"],
      ["21970243208", "main"],
    ]);
  });

  it("names Map Room 1 on a Map Room 1 visit, which has no cell", async () => {
    const loaders = api();
    const target: ViewTarget = { baseid: "11", kind: "wild", name: "Kozu Tribe", attack: null, refusal: null, mapversion: 1 };
    await loadYardFor(target, loaders);
    expect(loaders.viewBase.mock.calls).toEqual([["11", "wild", { mapversion: 1 }]]);
  });
});

describe("hudPoolFor (#60)", () => {
  const defender = { resources: { r1: 9, r2: 9, r3: 9, r4: 9 }, credits: 9 };
  const mine = { r1: 1500, r2: 2500, r3: 3500, r4: 4500 };

  it("shows the yard's own pool on the player's own yard", () => {
    expect(hudPoolFor(null, defender)).toEqual(defender);
  });

  it("shows the visitor's own pool on a visit, never the defender's", () => {
    const target = { ...visit("wild"), own: { resources: mine, credits: 42 } };
    expect(hudPoolFor(target, defender)).toEqual({ resources: mine, credits: 42 });
  });

  it("leaves the placeholders when the map never read the own yard", () => {
    expect(hudPoolFor(visit("main"), defender)).toBeNull();
    expect(hudPoolFor({ ...visit("main"), own: { resources: null } }, defender)).toBeNull();
  });
});

describe("refusalNotice (#153)", () => {
  it("says why a visit has no Attack button, as text", () => {
    expect(refusalNotice(visit("wild"))).toBe("No attack from here: None of your flingers can reach this cell.");
  });

  it("says nothing on the own yard, or when the visit can attack", () => {
    const attack = { baseid: "21970243208", kind: "wild" } as unknown as NonNullable<ViewTarget["attack"]>;
    expect(refusalNotice(null)).toBeNull();
    expect(refusalNotice({ ...visit("wild"), attack, refusal: null })).toBeNull();
  });
});
