import { describe, expect, it, vi } from "vitest";
import { mountYardPlugins, YARD_PLUGINS, type YardMounts, type YardPlugin } from "./yardPlugins";
import "./plugins";

/** The own yard's plugin registry for the tutorial's packages (issue #227). */

const mounts = {} as YardMounts;

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
    const plugin = vi.fn();
    YARD_PLUGINS.push(plugin);
    try {
      mountYardPlugins(mounts)();
      expect(plugin).toHaveBeenCalledWith(mounts);
    } finally {
      YARD_PLUGINS.splice(YARD_PLUGINS.indexOf(plugin), 1);
    }
  });
});
