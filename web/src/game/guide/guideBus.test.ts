import { describe, expect, it, vi } from "vitest";
import { GuideBus } from "./guideBus";

/** The tutorial's event bus (issue #227). */

describe("GuideBus", () => {
  it("tells each listener of its own event, in order, until it unsubscribes", () => {
    const bus = new GuideBus();
    const seen: string[] = [];
    const off = bus.on("carry", ({ type }) => seen.push(`a:${type}`));
    bus.on("carry", ({ type }) => seen.push(`b:${type}`));
    bus.on("placed", () => seen.push("placed"));

    bus.emit("carry", { type: 21 });
    off();
    bus.emit("carry", { type: null });

    expect(seen).toEqual(["a:21", "b:21", "b:null"]);
  });

  it("a listener that throws is reported and the rest still hear", () => {
    const bus = new GuideBus();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const heard = vi.fn();
    bus.on("buildMenu", () => {
      throw new Error("broken tip");
    });
    bus.on("buildMenu", heard);

    bus.emit("buildMenu", { open: true });

    expect(heard).toHaveBeenCalledWith({ open: true });
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it("a listener added during an emit waits for the next one", () => {
    const bus = new GuideBus();
    const late = vi.fn();
    bus.on("banked", () => {
      bus.on("banked", late);
    });

    bus.emit("banked", { banked: { r1: 200 } });
    expect(late).not.toHaveBeenCalled();
    bus.emit("banked", { banked: { r1: 5 } });
    expect(late).toHaveBeenCalledWith({ banked: { r1: 5 } });
  });

  it("clear drops everyone", () => {
    const bus = new GuideBus();
    const heard = vi.fn();
    bus.on("mapOpened", heard);
    bus.clear();
    bus.emit("mapOpened", { map: "mr1" });
    expect(heard).not.toHaveBeenCalled();
  });
});
