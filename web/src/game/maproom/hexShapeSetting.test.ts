import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetHexShape, loadHexShape } from "./hexShapeSetting";

afterEach(() => forgetHexShape());

describe("loadHexShape", () => {
  it("asks once and keeps the answer", async () => {
    const fetch = vi.fn(async () => "pointy" as const);
    expect(await loadHexShape(fetch)).toBe("pointy");
    expect(await loadHexShape(fetch)).toBe("pointy");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("answers flat on a failed fetch and asks again next time", async () => {
    expect(await loadHexShape(async () => Promise.reject(new Error("offline")))).toBe("flat");
    expect(await loadHexShape(async () => "pointy")).toBe("pointy");
  });
});
