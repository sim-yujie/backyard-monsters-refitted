// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { composeSnapshot } from "./snapshotPicture";
import { SNAPSHOT_SIZE } from "./yardSnapshot";

/** The yard picture's last step: exactly 1920 x 1080, the caption in the bottom-right corner. */

/** A 2D context that notes what is drawn on it. */
const recordingContext = () => {
  const calls: { name: string; args: unknown[] }[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
    };
  const context = {
    fillStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "",
    fillRect: record("fillRect"),
    drawImage: record("drawImage"),
    beginPath: record("beginPath"),
    roundRect: record("roundRect"),
    rect: record("rect"),
    fill: record("fill"),
    fillText: record("fillText"),
    measureText: (text: string) => ({ width: text.length * 10 }),
  };
  return { context, calls };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("composeSnapshot", () => {
  it("stretches the drawn yard to the picture's size and writes the caption in the corner", async () => {
    const { context, calls } = recordingContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
    const source = document.createElement("canvas");

    const picture = await composeSnapshot(source, ["Kevin · Level 32", "Backyard Monsters Revamped"]);

    expect(picture?.width).toBe(SNAPSHOT_SIZE.width);
    expect(picture?.height).toBe(SNAPSHOT_SIZE.height);
    expect(calls.find((call) => call.name === "drawImage")?.args).toEqual([source, 0, 0, 1920, 1080]);
    const texts = calls.filter((call) => call.name === "fillText");
    expect(texts.map((call) => call.args[0])).toEqual(["Kevin · Level 32", "Backyard Monsters Revamped"]);
    // Right-aligned inside the picture, near its right and bottom edges.
    for (const call of texts) {
      expect(call.args[1] as number).toBeGreaterThan(1800);
      expect(call.args[1] as number).toBeLessThanOrEqual(1920);
      expect(call.args[2] as number).toBeGreaterThan(900);
    }
    expect(context.textAlign).toBe("right");
  });

  it("is null where the browser gives no 2D canvas", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(await composeSnapshot(document.createElement("canvas"), ["x"])).toBeNull();
  });
});
