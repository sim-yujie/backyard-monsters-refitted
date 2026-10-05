import { describe, expect, it, vi } from "vitest";
import type { RaidView } from "@/api/raid";
import { RaidWatch } from "./raidWatch";

/** The open raid as presence answers and the raid routes tell it (issue #226 WP4). */

const raid = (over: Partial<RaidView> = {}): RaidView => ({
  id: "r1",
  phase: "warning",
  tribe: "Kozu",
  monsters: { C2: 10 },
  attackAt: 1_000,
  warned: 0,
  ...over,
});

describe("RaidWatch", () => {
  it("takes the server's clock off an answer", () => {
    const watch = new RaidWatch(() => 500_000);
    watch.hear({ now: 600 });
    expect(watch.serverNow()).toBe(600);
  });

  it("hears a raid, and that there is none", () => {
    const watch = new RaidWatch();
    const heard = vi.fn();
    watch.subscribe(heard);
    watch.hear({ raid: raid() });
    expect(watch.current?.id).toBe("r1");
    watch.hear({});
    expect(watch.current).toBeNull();
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("ignores an answer that is not a raid", () => {
    const watch = new RaidWatch();
    watch.hear({ raid: { id: 4, phase: "warning" } });
    expect(watch.current).toBeNull();
  });

  it("never moves one raid backwards on a crossing answer", () => {
    const watch = new RaidWatch();
    watch.set(raid({ warned: 1, attackAt: 900 }));
    watch.hear({ raid: raid({ warned: 0, attackAt: 1_000 }) });
    expect(watch.current).toMatchObject({ warned: 1, attackAt: 900 });

    watch.set(raid({ phase: "fighting" }));
    watch.hear({ raid: raid({ phase: "warning" }) });
    expect(watch.current?.phase).toBe("fighting");
  });

  it("takes a new raid as it comes", () => {
    const watch = new RaidWatch();
    watch.set(raid({ warned: 1 }));
    watch.hear({ raid: raid({ id: "r2", warned: 0 }) });
    expect(watch.current).toMatchObject({ id: "r2", warned: 0 });
  });

  it("takes a route's answer as it is, a later fight included", () => {
    const watch = new RaidWatch();
    watch.set(raid({ attackAt: 900 }));
    watch.set(raid({ attackAt: 950 }));
    expect(watch.current?.attackAt).toBe(950);
  });

  it("tells listeners only of a change", () => {
    const watch = new RaidWatch();
    const heard = vi.fn();
    watch.subscribe(heard);
    watch.hear({ raid: raid() });
    watch.hear({ raid: raid() });
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("keeps a simulated raid until simulate() lets go", () => {
    const watch = new RaidWatch();
    watch.simulate(raid({ id: "pinned" }));
    watch.hear({});
    expect(watch.current?.id).toBe("pinned");
    watch.simulate();
    watch.hear({});
    expect(watch.current).toBeNull();
  });
});
