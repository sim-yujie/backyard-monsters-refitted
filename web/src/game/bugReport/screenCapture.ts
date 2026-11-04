/**
 * The bug report's pictures (`ui/bugReport/BugReportDialog.ts`): a picture
 * of the game screen taken when the player opens the form, and the picture
 * the player may add. Both are re-drawn on a canvas and sent as JPEG, which
 * shrinks them and drops anything hidden in the file (a photo's location,
 * the camera), and keeps them under the server's caps
 * (`server/src/config/BugReportConfig.ts`).
 *
 * The screenshot is two layers. The game is drawn by Pixi into a texture of
 * its own and read back (`gameFrameOf`).
 * The menus and panels on top are HTML, so they are copied into an SVG
 * picture with the page's styles, images and fonts inlined, and `<html>`'s
 * attributes (the window style, the font choice) on the picture's root so the
 * windows look as the player sees them. Anything that cannot be
 * copied (a browser that refuses, a slow page) leaves the game layer alone.
 */
import type { Container, ExtractOptions, ICanvas, Rectangle } from "pixi.js";

/**
 * The game as a picture (`picture`, read at once), and the page's game canvas
 * (`canvas`), which the copy of the menus leaves out.
 */
export interface GameFrame {
  readonly picture: HTMLCanvasElement;
  readonly canvas: HTMLCanvasElement;
}

/** Renders the game now and returns it; null when there is none. */
export type GameFrameSource = () => GameFrame | null;

/** What the last screenshot took and how long, for the dev console (`window.__bugReportShot`). */
export interface CaptureStats {
  /** "extract" (Pixi drew it into a texture of its own), "canvas" (read off the page), or "none". */
  game: "extract" | "canvas" | "none";
  /** Pictures inlined into the menus' copy, and their bytes. */
  images: number;
  imageBytes: number;
  /** Pictures the copy could not have (another site, too big, failed), so they show blank. */
  missing: string[];
  fontBytes: number;
  /** The SVG picture's own size. */
  svgBytes: number;
  uiMs: number;
  totalMs: number;
}

let lastStats: CaptureStats | null = null;

/** The last screenshot's figures; null before the first. */
export const lastCaptureStats = (): CaptureStats | null => lastStats;

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

/** The parts of Pixi's Application the screenshot uses. */
export interface GameApp {
  readonly canvas: HTMLCanvasElement;
  readonly stage: Container;
  readonly screen: Rectangle;
  readonly renderer: { readonly resolution: number; readonly extract: { canvas(options: ExtractOptions): ICanvas } };
  render(): void;
}

/**
 * The game as it is now. Pixi draws the stage into a texture of its own and
 * reads it back, which works whatever the browser has done with the page
 * canvas: a WebGL canvas made without `preserveDrawingBuffer` can read back
 * empty once the frame has been shown. Drawn at no more than the screenshot's
 * width, so a big screen reads back no more than it needs. If that fails, the
 * page canvas right after a fresh render, as before.
 */
export const gameFrameOf = (app: GameApp): GameFrame => {
  const canvas = app.canvas;
  try {
    const resolution = Math.min(app.renderer.resolution, SCREENSHOT_WIDTH / Math.max(1, app.screen.width));
    const picture = app.renderer.extract.canvas({ target: app.stage, frame: app.screen, resolution, clearColor: BACKGROUND });
    if (picture instanceof HTMLCanvasElement && picture.width > 0 && picture.height > 0) return { picture, canvas };
  } catch {
    // Read the page canvas instead.
  }
  app.render();
  return { picture: canvas, canvas };
};

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([promise, new Promise<null>((resolve) => window.setTimeout(() => resolve(null), ms))]);

const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Times the menus' picture is drawn, and the pause between. An SVG picture
 * may fetch and decode the art its styles name only once it is first drawn,
 * so the first draw can miss window frames and pictures; later ones have them.
 */
export const UI_DRAW_PASSES = 3;
export const UI_SETTLE_MS = 120;

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

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

  const started = now();
  const stats: CaptureStats = { game: "none", images: 0, imageBytes: 0, missing: [], fontBytes: 0, svgBytes: 0, uiMs: 0, totalMs: 0 };
  lastStats = stats;
  const finish = (url: string | null): string | null => {
    stats.totalMs = Math.round(now() - started);
    return url;
  };

  const game = blankCanvas(outWidth, outHeight);
  if (!game) return null;
  let gameCanvas: HTMLCanvasElement | null = null;
  try {
    // Before anything awaits: the App renders the game and hands it over at
    // once (`app/App.ts`).
    const frame = gameFrame?.() ?? null;
    if (frame) {
      gameCanvas = frame.canvas;
      game.drawImage(frame.picture, 0, 0, outWidth, outHeight);
      stats.game = frame.picture === frame.canvas ? "canvas" : "extract";
    }
  } catch {
    // No game layer; the menus may still show.
  }

  const shot = blankCanvas(outWidth, outHeight);
  if (shot && root) {
    try {
      const uiStarted = now();
      const ui = await withTimeout(drawUiLayer(root, gameCanvas, width, height, stats), UI_LAYER_TIMEOUT_MS);
      if (ui) {
        for (let pass = 0; pass < UI_DRAW_PASSES; pass++) {
          if (pass > 0) await wait(UI_SETTLE_MS);
          shot.drawImage(game.canvas, 0, 0);
          shot.drawImage(ui, 0, 0, outWidth, outHeight);
        }
        stats.uiMs = Math.round(now() - uiStarted);
        const url = encodeJpeg(shot.canvas, SCREENSHOT_MAX_BYTES);
        if (url) return finish(url);
      }
    } catch {
      // A browser that will not read the copy back (Safari) gets the game alone.
    }
  }
  try {
    return finish(encodeJpeg(game.canvas, SCREENSHOT_MAX_BYTES));
  } catch {
    return finish(null);
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

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)(\?|#|$)/i;

/** Pictures already turned into data URLs, by address: a second report reads none again. */
const inlinedCache = new Map<string, string>();
const INLINED_CACHE_MAX = 400;

/** Forgets the pictures kept for the next screenshot (tests). */
export const clearInlinedImages = (): void => inlinedCache.clear();

/**
 * Same-origin images as data URLs, so the SVG copy can show them (an SVG
 * picture loads nothing from addresses); others are left out and noted in
 * `stats.missing`.
 */
export const inlineUrls = async (
  refs: readonly { url: string; base: string }[],
  stats?: Pick<CaptureStats, "images" | "imageBytes" | "missing">,
): Promise<Map<string, string>> => {
  const found = new Map<string, string>();
  const wanted = new Map<string, string>();
  for (const { url, base } of refs) {
    if (!url || url.startsWith("data:") || url.startsWith("#") || FONT_FILE.test(url) || wanted.has(url)) continue;
    if (wanted.size >= MAX_INLINED) break;
    wanted.set(url, base);
  }
  const miss = (url: string): void => {
    stats?.missing.push(url);
  };
  await Promise.all(
    [...wanted].map(async ([url, base]) => {
      try {
        const absolute = new URL(url, base);
        if (absolute.origin !== window.location.origin) return miss(url);
        let data = inlinedCache.get(absolute.href);
        if (!data) {
          const response = await fetch(absolute.href, { cache: "force-cache" });
          if (!response.ok) return miss(url);
          const blob = await response.blob();
          const image = blob.type.startsWith("image/") || (!blob.type && IMAGE_FILE.test(absolute.pathname));
          if (blob.size > MAX_INLINED_BYTES || !image) return miss(url);
          data = await readAsDataUrl(blob);
          if (inlinedCache.size < INLINED_CACHE_MAX) inlinedCache.set(absolute.href, data);
        }
        found.set(url, data);
        if (stats) {
          stats.images += 1;
          stats.imageBytes += dataUrlBytes(data);
        }
      } catch {
        miss(url);
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

type SheetText = { text: string; base: string };

const isFontFace = (rule: CSSRule): boolean =>
  (typeof CSSFontFaceRule !== "undefined" && rule instanceof CSSFontFaceRule) || rule.cssText.startsWith("@font-face");

/**
 * Every style rule on the page that can be read, with its sheet's address for
 * relative URLs; the @font-face rules apart, as their files are inlined
 * separately (`inlineFonts`).
 */
const pageStyles = (sheets: Iterable<CSSStyleSheet> = Array.from(document.styleSheets)): { styles: SheetText[]; fonts: SheetText[] } => {
  const styles: SheetText[] = [];
  const fonts: SheetText[] = [];
  for (const sheet of sheets) {
    try {
      const base = sheet.href ?? window.location.href;
      const rules = Array.from(sheet.cssRules);
      for (const rule of rules) if (isFontFace(rule)) fonts.push({ text: rule.cssText, base });
      styles.push({ text: rules.filter((rule) => !isFontFace(rule)).map((rule) => rule.cssText).join("\n"), base });
    } catch {
      // Another site's sheet cannot be read.
    }
  }
  return { styles, fonts };
};

/** All the font files the copy may carry; over this it keeps the plain font stack. */
export const MAX_FONT_BYTES = 1_500_000;

const unquote = (family: string): string => family.trim().replace(/^(['"])(.*)\1$/, "$2");

const fontFamilyOf = (faceText: string): string => {
  const match = /font-family:\s*([^;}]+)/.exec(faceText);
  return match?.[1] ? unquote(match[1]) : "";
};

/** The font families the page has loaded; null when the browser cannot say (then every face is kept). */
const loadedFontFamilies = (): Set<string> | null => {
  try {
    const set = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!set) return null;
    const families = new Set<string>();
    set.forEach((face) => {
      if (face.status === "loaded") families.add(unquote(face.family));
    });
    return families.size > 0 ? families : null;
  } catch {
    return null;
  }
};

/**
 * The page's @font-face rules with their (same-origin) font files as data
 * URLs, so the copy shows the player's font choice (Game font, Clear, Extra
 * readable): an SVG picture cannot load fonts from addresses. Only the
 * families the page has loaded are carried. Resolves with "" when the files
 * cannot be had or together pass `MAX_FONT_BYTES`; the copy then keeps the
 * plain font stack, as before.
 */
export const inlineFonts = async (
  faces: readonly SheetText[],
  used: Set<string> | null = loadedFontFamilies(),
  maxBytes: number = MAX_FONT_BYTES,
): Promise<string> => {
  const wanted = used ? faces.filter((face) => used.has(fontFamilyOf(face.text))) : [...faces];
  const files = new Map<string, URL>();
  for (const face of wanted) {
    for (const match of face.text.matchAll(URL_IN_CSS)) {
      const url = match[2] ?? "";
      if (!url || url.startsWith("data:") || files.has(url)) continue;
      try {
        const absolute = new URL(url, face.base);
        if (absolute.origin === window.location.origin) files.set(url, absolute);
      } catch {
        // Not an address.
      }
    }
  }
  try {
    const blobs = await Promise.all(
      [...files].map(async ([url, absolute]) => {
        const response = await fetch(absolute.href, { cache: "force-cache" });
        return response.ok ? ([url, await response.blob()] as const) : null;
      }),
    );
    let total = 0;
    const inlined = new Map<string, string>();
    for (const entry of blobs) {
      if (!entry) continue;
      total += entry[1].size;
      if (total > maxBytes) return "";
      inlined.set(entry[0], await readAsDataUrl(entry[1]));
    }
    return wanted
      .filter((face) => [...face.text.matchAll(URL_IN_CSS)].some((match) => inlined.has(match[2] ?? "") || (match[2] ?? "").startsWith("data:")))
      .map((face) => replaceUrls(face.text, inlined))
      .join("\n");
  } catch {
    return "";
  }
};

/** Looks the copy takes from <html> and <body>, which it has no element for. */
const INHERITED_LOOK = [
  "font-family",
  "font-size",
  "font-weight",
  "font-synthesis",
  "line-height",
  "color",
  "-webkit-font-smoothing",
] as const;

/** `element`'s font and text colour as style text; empty where the browser gives nothing. */
const inheritedLook = (element: Element | null): string => {
  if (!element) return "";
  try {
    const computed = window.getComputedStyle(element);
    return INHERITED_LOOK.map((name) => [name, computed.getPropertyValue(name)] as const)
      .filter(([, value]) => value)
      .map(([name, value]) => `${name}:${value};`)
      .join("");
  } catch {
    return "";
  }
};

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const PLAIN_NAME = /^[A-Za-z_][\w.-]*$/;
const SVG_OWN = new Set(["xmlns", "width", "height", "viewbox", "style"]);

/**
 * `<html>`'s attributes (`data-skin`, `data-font`, class, ...) and look as
 * attributes for the copy's `<svg>`. In the SVG picture `:root` is the
 * `<svg>`, so without them every `:root[data-skin="scrap"]` rule fails and the
 * windows show the base look rather than the player's window style.
 */
export const rootAttributes = (page: Document = document): string => {
  const html = page.documentElement;
  const parts: string[] = [];
  for (const attribute of Array.from(html.attributes)) {
    const name = attribute.name.toLowerCase();
    if (!PLAIN_NAME.test(attribute.name) || SVG_OWN.has(name) || name.startsWith("xmlns")) continue;
    parts.push(`${attribute.name}="${escapeAttribute(attribute.value)}"`);
  }
  // The inline style last, so its custom properties win over the computed look.
  const style = inheritedLook(html) + (html.getAttribute("style") ?? "");
  if (style) parts.push(`style="${escapeAttribute(style)}"`);
  return parts.join(" ");
};

/** The SVG picture of the menus: `html` (the copied `#game-root`) with `css`, under `<html>`'s attributes. */
export const uiSvgMarkup = (html: string, css: string, width: number, height: number, page: Document = document): string => {
  const attributes = rootAttributes(page);
  const wrapperStyle = `position:relative;width:${width}px;height:${height}px;overflow:hidden;${inheritedLook(page.body)}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"` +
    `${attributes ? ` ${attributes}` : ""}>` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="${escapeAttribute(wrapperStyle)}">` +
    `<style><![CDATA[${css.replaceAll("]]>", "]] >")}]]></style>${html}</div></foreignObject></svg>`
  );
};

/**
 * Tiny <img>s of every inlined picture the copy's <img>s do not already
 * carry (window frames, buttons, icons named in the styles). An SVG picture
 * waits for its <img>s before it counts as loaded, but not for its styles'
 * art, which it would only start on the first draw; with these the art is
 * loaded, under the same address, before the copy is drawn.
 */
export const preloadImages = (inlined: ReadonlyMap<string, string>, images: readonly Element[] = []): string => {
  const carried = new Set(images.map((image) => image.getAttribute("src") ?? ""));
  const extra = [...new Set(inlined.values())].filter((data) => !carried.has(data));
  if (extra.length === 0) return "";
  const tags = extra.map((data) => `<img src="${escapeAttribute(data)}" width="1" height="1" decoding="sync" alt=""/>`).join("");
  return (
    `<div xmlns="http://www.w3.org/1999/xhtml" aria-hidden="true" ` +
    `style="position:absolute;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0.01;pointer-events:none">${tags}</div>`
  );
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
  stats?: CaptureStats,
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
  const { styles, fonts } = pageStyles();
  const fontFaces = inlineFonts(fonts);
  const page = window.location.href;
  const refs = images.map((image) => ({ url: image.getAttribute("src") ?? "", base: page })).filter((ref) => ref.url);
  for (const element of styled) {
    for (const match of (element.getAttribute("style") ?? "").matchAll(URL_IN_CSS)) refs.push({ url: match[2] ?? "", base: page });
  }
  // A stylesheet's relative URL is relative to the sheet.
  for (const style of styles) {
    for (const match of style.text.matchAll(URL_IN_CSS)) refs.push({ url: match[2] ?? "", base: style.base });
  }
  const inlined = await inlineUrls(refs, stats);

  for (const image of images) {
    const data = inlined.get(image.getAttribute("src") ?? "");
    if (data) image.setAttribute("src", data);
    else image.removeAttribute("src");
    image.removeAttribute("srcset");
    image.removeAttribute("sizes");
    image.removeAttribute("loading");
    // Drawn as soon as the copy is, not after it.
    image.setAttribute("decoding", "sync");
  }
  // A <picture>'s <source> would win over the inlined <img src>.
  clone.querySelectorAll("source").forEach((source) => source.remove());
  for (const element of styled) {
    element.setAttribute("style", replaceUrls(element.getAttribute("style") ?? "", inlined));
  }
  const fontCss = await fontFaces;
  if (stats) stats.fontBytes = fontCss.length;
  const css = [fontCss, ...styles.map((style) => replaceUrls(style.text, inlined))].join("\n");

  const html = new XMLSerializer().serializeToString(clone) + preloadImages(inlined, images);
  const svg = uiSvgMarkup(html, css, width, height);
  if (stats) stats.svgBytes = svg.length;

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
