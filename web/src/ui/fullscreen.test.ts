import { describe, expect, it, vi } from "vitest";
import { fullscreenAvailable, toggleFullscreen } from "./fullscreen";

const fakeDoc = (inFullscreen: boolean) => {
  const doc = {
    fullscreenEnabled: true,
    fullscreenElement: inFullscreen ? {} : null,
    exitFullscreen: vi.fn(async () => {
      doc.fullscreenElement = null;
    }),
    documentElement: {
      requestFullscreen: vi.fn(async () => {
        doc.fullscreenElement = {};
      }),
    },
  };
  return doc;
};

describe("fullscreen", () => {
  it("enters fullscreen from a window and leaves it from fullscreen", async () => {
    const out = fakeDoc(false);
    expect(await toggleFullscreen(out as unknown as Document)).toBe(true);
    expect(out.documentElement.requestFullscreen).toHaveBeenCalledOnce();

    const inside = fakeDoc(true);
    expect(await toggleFullscreen(inside as unknown as Document)).toBe(false);
    expect(inside.exitFullscreen).toHaveBeenCalledOnce();
  });

  it("stays as it was when the browser refuses", async () => {
    const doc = fakeDoc(false);
    doc.documentElement.requestFullscreen.mockRejectedValueOnce(new Error("denied"));
    expect(await toggleFullscreen(doc as unknown as Document)).toBe(false);
  });

  it("is unavailable where the browser says so", () => {
    expect(fullscreenAvailable({ fullscreenEnabled: false, documentElement: {} } as unknown as Document)).toBe(false);
  });
});
