import { SNAPSHOT_BACKGROUND, SNAPSHOT_SIZE, type SnapshotSize } from "./yardSnapshot";

/**
 * The yard picture's last step: the drawn yard at exactly `size`, and the
 * caption in its bottom-right corner (the player, then the game's name), in
 * the game's font on a dark tab so it reads over grass or lava.
 */

/** The game's display font (`ui/styles/tokens.css`), then what the system has. */
const FONT = '"Titan One", "Segoe UI", system-ui, sans-serif';
const TOP_LINE_PX = 34;
const LINE_PX = 22;
const MARGIN = 24;
const PADDING_X = 18;
const PADDING_Y = 12;
const LINE_GAP = 6;

/**
 * Waits for the game font, a second at most: a canvas draws with whatever is
 * loaded at that moment, and a picture made before the font arrived would
 * carry the fallback for good.
 */
const fontReady = async (): Promise<void> => {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts?.load) return;
  await Promise.race([
    Promise.all([fonts.load(`${TOP_LINE_PX}px ${FONT}`), fonts.load(`${LINE_PX}px ${FONT}`)]).catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]);
};

/**
 * The finished picture: `source` stretched to `size` (it is drawn to that
 * shape, so only a pixel of rounding is taken up) with `lines` in the corner.
 * Null where the browser gives no 2D canvas.
 */
export const composeSnapshot = async (
  source: CanvasImageSource,
  lines: readonly string[],
  size: SnapshotSize = SNAPSHOT_SIZE,
): Promise<HTMLCanvasElement | null> => {
  await fontReady();
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = SNAPSHOT_BACKGROUND;
  context.fillRect(0, 0, size.width, size.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, size.width, size.height);
  if (lines.length > 0) drawCaption(context, lines, size);
  return canvas;
};

const fontFor = (index: number): string => `${index === 0 ? TOP_LINE_PX : LINE_PX}px ${FONT}`;

const drawCaption = (context: CanvasRenderingContext2D, lines: readonly string[], size: SnapshotSize): void => {
  const widths = lines.map((line, index) => {
    context.font = fontFor(index);
    return context.measureText(line).width;
  });
  const heights = lines.map((_, index) => (index === 0 ? TOP_LINE_PX : LINE_PX));
  const boxWidth = Math.max(...widths) + PADDING_X * 2;
  const boxHeight = heights.reduce((sum, height) => sum + height, 0) + LINE_GAP * (lines.length - 1) + PADDING_Y * 2;
  const left = size.width - MARGIN - boxWidth;
  const top = size.height - MARGIN - boxHeight;

  context.fillStyle = "rgba(10, 12, 16, 0.72)";
  context.beginPath();
  if (typeof context.roundRect === "function") context.roundRect(left, top, boxWidth, boxHeight, 12);
  else context.rect(left, top, boxWidth, boxHeight);
  context.fill();

  context.textAlign = "right";
  context.textBaseline = "top";
  let y = top + PADDING_Y;
  lines.forEach((line, index) => {
    context.font = fontFor(index);
    context.fillStyle = index === 0 ? "#ffffff" : "#f2c14e";
    context.fillText(line, left + boxWidth - PADDING_X, y);
    y += heights[index]! + LINE_GAP;
  });
};

/** The picture as a PNG file's contents. */
export const pictureBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The picture could not be made into a PNG."))), "image/png");
  });
