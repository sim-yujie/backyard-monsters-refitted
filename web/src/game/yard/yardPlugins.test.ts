import { describe, expect, it, vi } from "vitest";
import { mountYardPlugins, YARD_PLUGINS, type YardMounts, type YardPlugin } from "./yardPlugins";
import "./plugins";

/** The own yard's plugin registry for the tutorial's packages (issue #227). */

// A bare stub. Every test hands the registry its own plugins, so no real
// package (`./plugins`, imported so the registry holds them) mounts on it.
const mounts = { store: { kind: "outpost" } } as unknown as YardMounts;

describe("mountYardPlugins", () => {
  it("mounts in order and tears down in reverse", () => {
    const order: string[] = [];
    const plugin =
      (name: string): YardPlugin =>
      () => {
        order.push(`mount ${name}`);
        return () => order.push(`unmount ${name}`);
      };

    const unmount = mountYardPlugins(mounts, [plugin("goals"), () => undefined, plugin("tips")]);
    unmount();

    expect(order).toEqual(["mount goals", "mount tips", "unmount tips", "unmount goals"]);
  });

  it("a plugin that throws is reported and the yard carries on", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const after = vi.fn();

    const unmount = mountYardPlugins(mounts, [
      () => {
        throw new Error("broken");
      },
      after,
    ]);

    expect(after).toHaveBeenCalledWith(mounts);
    expect(error).toHaveBeenCalledOnce();
    unmount();
    error.mockRestore();
  });

  it("mounts the registry by default", () => {
    // The real packages (`./plugins`) are swapped out for a stub while this
    // runs: it tests the default argument only, and a bare `mounts` must never
    // reach a real package, whose mount would throw on it.
    const real = YARD_PLUGINS.splice(0);
    const plugin = vi.fn();
    YARD_PLUGINS.push(plugin);
    const error = vi.spyOn(console, "error");
    try {
      mountYardPlugins(mounts)();
      expect(plugin).toHaveBeenCalledWith(mounts);
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      YARD_PLUGINS.splice(0, YARD_PLUGINS.length, ...real);
    }
    expect(real.length).toBeGreaterThan(0);
    expect(YARD_PLUGINS).toEqual(real);
  });
});
