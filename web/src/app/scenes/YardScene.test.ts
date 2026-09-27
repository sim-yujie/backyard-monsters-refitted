// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import type { ViewTarget } from "@/game/attack/attackTarget";
import { hudPoolFor, loadYardFor } from "./YardScene";

const response = { error: 0, id: 1, baseid: "1000", basesaveid: 1 } as BaseLoadResponse;

const api = () => ({
  loadOwnYard: vi.fn(() => Promise.resolve(response)),
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
