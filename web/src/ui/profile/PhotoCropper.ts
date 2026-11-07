/**
 * The photo crop step (owner, beta 7): the picked picture in a square frame,
 * dragged to move and zoomed with a slider, then drawn into a 256x256 JPEG
 * data URL for the upload. The server makes its own 128x128 copy from it and
 * throws away everything else (metadata included), so this only has to send
 * a small, square JPEG the server can read.
 */

/** The side of the square the crop step sends. */
export const OUTPUT_SIDE = 256;
/** JPEG quality of what it sends (about 20-40 KB, well under the server's 300 KB). */
export const OUTPUT_QUALITY = 0.9;
/** The most it zooms in. */
export const MAX_ZOOM = 3;
/** A picked file larger than this is refused before it is even opened. */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export const NOT_A_PICTURE = "That file is not a picture we can use.";
export const FILE_TOO_BIG = "That file is too big. Pick one under 15 MB.";
export const PICTURE_TOO_SMALL = "That picture is too small.";

/** The part of the picture that shows: a square `side` wide from (`x`, `y`). */
export interface CropSquare {
  readonly x: number;
  readonly y: number;
  readonly side: number;
}

/**
 * The square of a `width` x `height` picture seen at `zoom` (1 = the whole
 * short side) around the centre (`cx`, `cy`), kept inside the picture.
 */
export const cropSquare = (width: number, height: number, zoom: number, cx: number, cy: number): CropSquare => {
  const z = Math.min(MAX_ZOOM, Math.max(1, Number.isFinite(zoom) ? zoom : 1));
  const side = Math.min(width, height) / z;
  const half = side / 2;
  const clamp = (value: number, size: number): number =>
    Math.min(size - half, Math.max(half, Number.isFinite(value) ? value : size / 2));
  return { x: clamp(cx, width) - half, y: clamp(cy, height) - half, side };
};

/** Reads a picked file as a picture, or says why it cannot. */
export const loadPicture = (file: File): Promise<HTMLImageElement> => {
  if (!file.type.startsWith("image/")) return Promise.reject(new Error(NOT_A_PICTURE));
  if (file.size > MAX_FILE_BYTES) return Promise.reject(new Error(FILE_TOO_BIG));
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const picture = new Image();
    picture.decoding = "async";
    picture.onload = () => {
      URL.revokeObjectURL(url);
      if (picture.naturalWidth < 32 || picture.naturalHeight < 32) reject(new Error(PICTURE_TOO_SMALL));
      else resolve(picture);
    };
    picture.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(NOT_A_PICTURE));
    };
    picture.src = url;
  });
};

export interface PhotoCropperOptions {
  /** The picture to crop, already loaded. */
  readonly picture: CanvasImageSource & { readonly naturalWidth: number; readonly naturalHeight: number };
  /**
   * The frame's largest side on screen, in CSS pixels. The style sheet may
   * draw it smaller to fit the window (profile.css, `--crop-side`).
   */
  readonly frame?: number;
}

/**
 * The frame, the zoom slider and the result. Owns no buttons: the profile
 * window puts its own Use / Back under it.
 */
export class PhotoCropper {
  readonly element: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly slider: HTMLInputElement;

  private readonly picture: PhotoCropperOptions["picture"];
  private readonly frame: number;
  private readonly width: number;
  private readonly height: number;
  private zoom = 1;
  private cx: number;
  private cy: number;
  private drag: { id: number; x: number; y: number } | null = null;

  constructor(options: PhotoCropperOptions) {
    this.picture = options.picture;
    this.frame = options.frame ?? 240;
    this.width = options.picture.naturalWidth;
    this.height = options.picture.naturalHeight;
    this.cx = this.width / 2;
    this.cy = this.height / 2;

    this.element = document.createElement("div");
    this.element.className = "photo-crop";

    this.canvas = document.createElement("canvas");
    this.canvas.className = "photo-crop__frame";
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.frame * ratio);
    this.canvas.height = Math.round(this.frame * ratio);
    // The side on screen is the style sheet's, so it follows the window as it
    // turns or resizes; this is only its upper bound.
    this.element.style.setProperty("--crop-frame", `${this.frame}px`);
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "Drag to move the photo");
    this.canvas.addEventListener("pointerdown", this.onDown);
    this.canvas.addEventListener("pointermove", this.onMove);
    this.canvas.addEventListener("pointerup", this.onUp);
    this.canvas.addEventListener("pointercancel", this.onUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });

    const zoomRow = document.createElement("label");
    zoomRow.className = "photo-crop__zoom";
    const minus = document.createElement("span");
    minus.className = "photo-crop__zoom-end";
    minus.textContent = "−";
    minus.setAttribute("aria-hidden", "true");
    const plus = document.createElement("span");
    plus.className = "photo-crop__zoom-end";
    plus.textContent = "+";
    plus.setAttribute("aria-hidden", "true");
    this.slider = document.createElement("input");
    this.slider.type = "range";
    this.slider.className = "photo-crop__slider";
    this.slider.min = "1";
    this.slider.max = String(MAX_ZOOM);
    this.slider.step = "0.01";
    this.slider.value = "1";
    this.slider.setAttribute("aria-label", "Zoom");
    this.slider.addEventListener("input", () => this.setZoom(Number(this.slider.value)));
    zoomRow.append(minus, this.slider, plus);

    this.element.append(this.canvas, zoomRow);
    this.draw();
  }

  /** The square that shows now, in the picture's own pixels. */
  get square(): CropSquare {
    return cropSquare(this.width, this.height, this.zoom, this.cx, this.cy);
  }

  setZoom(zoom: number): void {
    this.zoom = Math.min(MAX_ZOOM, Math.max(1, zoom));
    this.slider.value = String(this.zoom);
    this.settle();
  }

  /** Moves the picture by a drag of (`dx`, `dy`) screen pixels. */
  moveBy(dx: number, dy: number): void {
    const shown = this.canvas.getBoundingClientRect().width;
    const perPixel = this.square.side / (shown > 0 ? shown : this.frame);
    this.cx -= dx * perPixel;
    this.cy -= dy * perPixel;
    this.settle();
  }

  /** The crop as a 256x256 JPEG data URL; null when the browser cannot draw. */
  result(): string | null {
    const out = document.createElement("canvas");
    out.width = OUTPUT_SIDE;
    out.height = OUTPUT_SIDE;
    const context = out.getContext("2d");
    if (!context) return null;
    const { x, y, side } = this.square;
    // A white ground under any see-through part of a PNG, which JPEG would turn black.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, OUTPUT_SIDE, OUTPUT_SIDE);
    context.imageSmoothingQuality = "high";
    context.drawImage(this.picture, x, y, side, side, 0, 0, OUTPUT_SIDE, OUTPUT_SIDE);
    const url = out.toDataURL("image/jpeg", OUTPUT_QUALITY);
    return url.startsWith("data:image/jpeg") ? url : null;
  }

  /** Keeps the centre inside the picture, then redraws. */
  private settle(): void {
    const { x, y, side } = this.square;
    this.cx = x + side / 2;
    this.cy = y + side / 2;
    this.draw();
  }

  private draw(): void {
    const context = this.canvas.getContext("2d");
    if (!context) return;
    const { x, y, side } = this.square;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(this.picture, x, y, side, side, 0, 0, this.canvas.width, this.canvas.height);
  }

  private readonly onDown = (event: PointerEvent): void => {
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  private readonly onMove = (event: PointerEvent): void => {
    if (!this.drag || this.drag.id !== event.pointerId) return;
    this.moveBy(event.clientX - this.drag.x, event.clientY - this.drag.y);
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };

  private readonly onUp = (event: PointerEvent): void => {
    if (this.drag?.id === event.pointerId) this.drag = null;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.setZoom(this.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
  };
}
