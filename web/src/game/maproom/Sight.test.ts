import { describe, expect, it, vi } from "vitest";
import { Sight } from "./Sight";
import type { SightResponse } from "@/api/types";

/**
 * The client's fog of war sight cache (issue #331): whether a cell or a zone
 * is inside it, and when a `/worldmapv2/sight` refetch is owed.
 */

const response = (over: Partial<SightResponse> = {}): SightResponse => ({
  error: 0,
  sv: "v1",
  sources: [{ x: 101, y: 101, reach: 6, kind: "own" }],
  revealed: [{ x: 500, y: 500 }],
  ...over,
});

describe("Sight", () => {
  it("sees nothing and answers every zone fogged before the first fetch lands", () => {
    const sight = new Sight({ fetcher: vi.fn() });

    expect(sight.loaded).toBe(false);
    expect(sight.isCellVisible(101, 101)).toBe(false);
    // Fetching normally until sight loads matters more than fog accuracy for
    // the opening frame: a zone is never reported fogged before then.
    expect(sight.isZoneFullyFogged({ id: 0, originX: 100, originY: 100 })).toBe(false);
  });

  it("sees a cell inside an own circle, and one only reachable through a revealed cell", async () => {
    const sight = new Sight({ fetcher: async () => response() });
    await sight.refresh();

    expect(sight.isCellVisible(101, 102)).toBe(true); // 1 step from the source
    expect(sight.isCellVisible(500, 500)).toBe(true); // revealed
    expect(sight.isCellVisible(400, 400)).toBe(false);
  });

  it("reports a zone fully outside every circle and reveal as fully fogged", async () => {
    const sight = new Sight({ fetcher: async () => response() });
    await sight.refresh();

    // Zone 400..410, nowhere near the one source (reach 6 around 101,101) or
    // the one reveal (500,500).
    expect(sight.isZoneFullyFogged({ id: 0, originX: 400, originY: 400 })).toBe(true);
  });

  it("reports a zone touching a circle as not fully fogged", async () => {
    const sight = new Sight({ fetcher: async () => response() });
    await sight.refresh();

    // Zone 100..110 covers the source cell itself.
    expect(sight.isZoneFullyFogged({ id: 0, originX: 100, originY: 100 })).toBe(false);
  });

  it("refresh fires onChange only when sv actually moved", async () => {
    const onChange = vi.fn();
    let current = response({ sv: "v1" });
    const sight = new Sight({ fetcher: async () => current, onChange });

    await sight.refresh();
    expect(onChange).toHaveBeenCalledTimes(1);

    await sight.refresh(); // same sv again
    expect(onChange).toHaveBeenCalledTimes(1);

    current = response({ sv: "v2" });
    await sight.refresh();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("syncVersion is a no-op for an unchanged or missing sv, and refetches when it moved", async () => {
    const fetcher = vi.fn(async () => response({ sv: "v1" }));
    const sight = new Sight({ fetcher });
    await sight.refresh();
    fetcher.mockClear();

    await sight.syncVersion(undefined);
    await sight.syncVersion("v1");
    expect(fetcher).not.toHaveBeenCalled();

    fetcher.mockResolvedValueOnce(response({ sv: "v2" }));
    await sight.syncVersion("v2");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sight.sv).toBe("v2");
  });
});
