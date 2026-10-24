/**
 * The bug report's pictures (`ui/bugReport/BugReportDialog.ts`): a picture
 * of the game screen taken when the player opens the form, and the picture
 * the player may add. Both are re-drawn on a canvas and sent as JPEG, which
 * shrinks them and drops anything hidden in the file (a photo's location,
 * the camera), and keeps them under the server's caps
 * (`server/src/config/BugReportConfig.ts`).
 *
 * The screenshot is two layers. The game (Pixi's WebGL canvas) is drawn
 * straight after a fresh render, the only moment its pixels can be read.
 * The menus and panels on top are HTML, so they are copied into an SVG
 * picture with the page's styles and images inlined. Anything that cannot be
 * copied (a browser that refuses, a slow page) leaves the game layer alone.
 */

/** Renders the game now and returns its canvas, to be read at once; null when there is none. */
export type GameFrameSource = () => HTMLCanvasElement | null;

let gameFrame: GameFrameSource | null = null;
let screenName: () => string | null = () => null;

/** The App's renderer (`app/App.ts`); null on tear-down. */
export const setGameFrameSource = (source: GameFrameSource | null): void => {
  gameFrame = source;
};

/** The App's scene manager, for "which screen they were on". */
export const setScreenNameSource = (source: () => string | null): void => {
  screenName = source;
};

/** The screen the player is on now ("yard", "maproom2", ...), or "" when unknown. */
export const currentScreenName = (): string => {
  try {
    return screenName() ?? "";
  } catch {
    return "";
  }
};

/** The screenshot's width at most; a phone's narrower screen stays its own width. */
export const SCREENSHOT_WIDTH = 1280;
/** Under the server's 1.5 MB. */
export const SCREENSHOT_MAX_BYTES = 1_400_000;
/** The added picture's longest side at most. */
export const PICTURE_MAX_SIDE = 1920;
/** Under the server's 3 MB. */
export const PICTURE_MAX_BYTES = 2_900_000;
/** A file bigger than this is not even opened. */
export const PICTURE_FILE_MAX_BYTES = 25_000_000;
/** How long the menus' copy may take before the screenshot goes without them. */
const UI_LAYER_TIMEOUT_MS = 4_000;

const BACKGROUND = "#11141a";

/** Bytes a base64 data URL decodes to. */
export const dataUrlBytes = (dataUrl: string): number => {
  const comma = dataUrl.indexOf(",");
  const body = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
  return Math.floor((body.length * 3) / 4) - padding;
};

/** The canvas as a JPEG data URL under `maxBytes`, trying lower qualities; null if none fits. */
export const encodeJpeg = (canvas: HTMLCanvasElement, maxBytes: number): string | null => {
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (!url.startsWith("data:image/jpeg")) return null;
    if (dataUrlBytes(url) <= maxBytes) return url;
  }
  return null;
};

const blankCanvas = (width: number, height: number): CanvasRenderingContext2D | null => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = BACKGROUND;
  context.fillRect(0, 0, width, height);
  return context;
};

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([promise, new Promise<null>((resolve) => window.setTimeout(() => resolve(null), ms))]);

/**
 * Takes the screenshot: the game, then the menus over it. Resolves with a
 * JPEG data URL, or null when nothing could be drawn.
 *
 * @param root The element holding the game canvas and the HTML on top (`#game-root`).
 */
export const captureScreen = async (
  root: HTMLElement | null = document.querySelector<HTMLElement>("#game-root"),
): Promise<string | null> => {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const scale = Math.min(1, SCREENSHOT_WIDTH / width);
  const outWidth = Math.round(width * scale);
  const outHeight = Math.round(height * scale);

  const game = blankCanvas(outWidth, outHeight);
  if (!game) return null;
  let gameCanvas: HTMLCanvasElement | null = null;
  try {
    // Straight after the render, before anything awaits: WebGL keeps its
    // pixels only until the frame is shown.
    gameCanvas = gameFrame?.() ?? null;
    if (gameCanvas) game.drawImage(gameCanvas, 0, 0, outWidth, outHeight);
  } catch {
    // No game layer; the menus may still show.
  }

  const shot = blankCanvas(outWidth, outHeight);
  if (shot && root) {
    try {
      const ui = await withTimeout(drawUiLayer(root, gameCanvas, width, height), UI_LAYER_TIMEOUT_MS);
      if (ui) {
        shot.drawImage(game.canvas, 0, 0);
        shot.drawImage(ui, 0, 0, outWidth, outHeight);
        const url = encodeJpeg(shot.canvas, SCREENSHOT_MAX_BYTES);
        if (url) return url;
      }
    } catch {
      // A browser that will not read the copy back (Safari) gets the game alone.
    }
  }
  try {
    return encodeJpeg(game.canvas, SCREENSHOT_MAX_BYTES);
  } catch {
    return null;
  }
};

/** Images fetched for the copy at most, and the largest one. */
const MAX_INLINED = 200;
const MAX_INLINED_BYTES = 2_000_000;
const URL_IN_CSS = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
const FONT_FILE = /\.(woff2?|ttf|otf|eot)(\?|#|$)/i;

const readAsDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** Same-origin images as data URLs, so the SVG copy can show them; others are left out. */
const inlineUrls = async (refs: readonly { url: string; base: string }[]): Promise<Map<string, string>> => {
  const found = new Map<string, string>();
  const wanted = new Map<string, string>();
  for (const { url, base } of refs) {
    if (!url || url.startsWith("data:") || url.startsWith("#") || FONT_FILE.test(url) || wanted.has(url)) continue;
    if (wanted.size >= MAX_INLINED) break;
    wanted.set(url, base);
  }
  await Promise.all(
    [...wanted].map(async ([url, base]) => {
      try {
        const absolute = new URL(url, base);
        if (absolute.origin !== window.location.origin) return;
        const response = await fetch(absolute.href, { cache: "force-cache" });
        if (!response.ok) return;
        const blob = await response.blob();
        if (blob.size > MAX_INLINED_BYTES || !blob.type.startsWith("image/")) return;
        found.set(url, await readAsDataUrl(blob));
      } catch {
        // Left out of the copy.
      }
    }),
  );
  return found;
};

const replaceUrls = (text: string, inlined: Map<string, string>): string =>
  text.replace(URL_IN_CSS, (whole, _quote: string, url: string) => {
    const data = inlined.get(url);
    return data ? `url("${data}")` : url.startsWith("data:") ? whole : "none";
  });

/** Every style rule on the page that can be read, with its sheet's address for relative URLs. */
const pageStyles = (): { text: string; base: string }[] => {
  const styles: { text: string; base: string }[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = Array.from(sheet.cssRules)
        // Fonts are left out: the copy falls back to the plain font stack.
        .filter((rule) => !(typeof CSSFontFaceRule !== "undefined" && rule instanceof CSSFontFaceRule))
        .map((rule) => rule.cssText)
        .join("\n");
      styles.push({ text: rules, base: sheet.href ?? window.location.href });
    } catch {
      // Another site's sheet cannot be read.
    }
  }
  return styles;
};

/**
 * The HTML over the game as a picture the size of the window, with the game
 * canvas itself left out (it is drawn separately).
 */
const drawUiLayer = async (
  root: HTMLElement,
  gameCanvas: HTMLCanvasElement | null,
  width: number,
  height: number,
): Promise<HTMLImageElement | null> => {
  const clone = root.cloneNode(true) as HTMLElement;

  // Canvases: the game's goes; any other is copied as a picture.
  const sourceCanvases = Array.from(root.querySelectorAll("canvas"));
  const cloneCanvases = Array.from(clone.querySelectorAll("canvas"));
  sourceCanvases.forEach((source, index) => {
    const copy = cloneCanvases[index];
    if (!copy) return;
    if (source === gameCanvas) {
      copy.remove();
      return;
    }
    try {
      const picture = document.createElement("img");
      picture.src = source.toDataURL();
      picture.className = source.className;
      picture.setAttribute("style", source.getAttribute("style") ?? "");
      picture.width = source.clientWidth || source.width;
      picture.height = source.clientHeight || source.height;
      copy.replaceWith(picture);
    } catch {
      copy.remove();
    }
  });

  // What the player has typed is a property, not an attribute.
  const sourceFields = Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"));
  const cloneFields = Array.from(clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"));
  sourceFields.forEach((source, index) => {
    const copy = cloneFields[index];
    if (!copy) return;
    if (copy instanceof HTMLTextAreaElement) copy.textContent = source.value;
    else if (source.type !== "password") copy.setAttribute("value", source.value);
    else copy.setAttribute("value", "");
  });
  clone.querySelectorAll("script").forEach((script) => script.remove());

  // Pictures: <img> sources and every url() in the styles and style attributes.
  const images = Array.from(clone.querySelectorAll("img"));
  const styled = Array.from(clone.querySelectorAll<HTMLElement>("[style]"));
  const styles = pageStyles();
  const page = window.location.href;
  const refs = images.map((image) => ({ url: image.getAttribute("src") ?? "", base: page })).filter((ref) => ref.url);
  for (const element of styled) {
    for (const match of (element.getAttribute("style") ?? "").matchAll(URL_IN_CSS)) refs.push({ url: match[2] ?? "", base: page });
  }
  // A stylesheet's relative URL is relative to the sheet.
  for (const style of styles) {
    for (const match of style.text.matchAll(URL_IN_CSS)) refs.push({ url: match[2] ?? "", base: style.base });
  }
  const inlined = await inlineUrls(refs);

  for (const image of images) {
    const data = inlined.get(image.getAttribute("src") ?? "");
    if (data) image.setAttribute("src", data);
    else image.removeAttribute("src");
    image.removeAttribute("srcset");
    image.removeAttribute("loading");
  }
  for (const element of styled) {
    element.setAttribute("style", replaceUrls(element.getAttribute("style") ?? "", inlined));
  }
  const css = styles.map((style) => replaceUrls(style.text, inlined)).join("\n").replaceAll("]]>", "]] >");

  const html = new XMLSerializer().serializeToString(clone);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${width}px;height:${height}px;overflow:hidden">` +
    `<style><![CDATA[${css}]]></style>${html}</div></foreignObject></svg>`;

  const picture = new Image();
  picture.width = width;
  picture.height = height;
  picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await picture.decode();
  return picture;
};

/** Why an added picture was not taken; the form shows the message. */
export class PictureError extends Error {}

const loadImage = (file: Blob): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new PictureError("That picture couldn't be opened. Try a JPEG or PNG."));
    };
    image.src = url;
  });

/**
 * The player's picture, shrunk to `PICTURE_MAX_SIDE` and re-drawn as a JPEG
 * under `PICTURE_MAX_BYTES`, which leaves out the file's hidden details.
 *
 * @throws {PictureError} When it is not a picture, is too big, or cannot be opened.
 */
export const preparePicture = async (file: File): Promise<string> => {
  if (!file.type.startsWith("image/")) throw new PictureError("Please pick a picture (JPEG, PNG or WebP).");
  if (file.size > PICTURE_FILE_MAX_BYTES) throw new PictureError("That picture is too big. Please pick a smaller one.");
  const image = await loadImage(file);
  const longest = Math.max(image.naturalWidth, image.naturalHeight, 1);
  const scale = Math.min(1, PICTURE_MAX_SIDE / longest);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new PictureError("That picture couldn't be opened. Try a JPEG or PNG.");
  // A see-through PNG would turn black as a JPEG.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const url = encodeJpeg(canvas, PICTURE_MAX_BYTES);
  if (!url) throw new PictureError("That picture is too big. Please pick a smaller one.");
  return url;
};
