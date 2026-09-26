// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import type { ViewTarget } from "@/game/attack/attackTarget";
import { loadYardFor } from "./YardScene";

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
