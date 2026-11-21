/**
 * The Quality setting (owner, 28 Oct 2026): how much the game downloads, for
 * slow internet and older phones. Kept in this browser only, apart from the
 * Classic look and the effects settings.
 *
 * - `high` (the default on most devices): the game as painted. Monster and champion sheets at
 *   their painted size (`@4x`, `@3x`, Korath 5 and 6 `@2x`), the yard tune at full
 *   quality, ready as soon as the yard opens.
 * - `medium`: the sheets' `@2x` copies (half size, about a quarter of the
 *   bytes; Korath 5 and 6 `@1.5x`), the lighter yard tune, and, when the
 *   player picked it, music off until they turn it on once in this browser:
 *   nothing is downloaded for it until then.
 * - `low`: the sheets' 1x copies (the size Flash drew them, about a tenth of the
 *   bytes), the lighter yard tune, music off at the start of every visit until
 *   the player turns it on, and the map rooms asking the server again a third
 *   as often (Map Room 2 every 3 minutes, not every minute).
 *
 * A player who never chose starts on High, or on Medium on a low-memory
 * device (`defaultQuality`, owner 17 Nov 2026): old phones ran out of
 * graphics memory with the High sheets and drew monsters as green squares.
 * Medium by default plays the music as High does (`musicHeld`).
 *
 * A PC drawing without a graphics card (software rendering: SwiftShader,
 * llvmpipe, Microsoft Basic Render Driver; owner, beta 9) starts on Low:
 * its processor draws every frame, and the lightest sheets help most.
 *
 * Phones and tablets (patch 7.11): iOS closed the tab on iPhones, which
 * loaded every yard monster at `@4x`. A touch device (`touchDevice.ts`) that
 * never chose starts on Medium too, and one whose player chose High still
 * draws its monsters and champions from the Medium copies
 * (`monsterSheetLevel`); the rest of High (music, map art) is as chosen.
 * Safe mode (`safeMode.ts`) can cap the level in use below the choice after
 * the game failed to load twice.
 *
 * The copies are made by `web/tools/sheet_copies.py`, and Pixi reads their
 * size from the `@2x` in the name, so a cell is framed the same at every level.
 */
import { clearSafeMode, lowerQuality, safeModeCap } from "./safeMode";
import { isTouchDevice } from "./touchDevice";

export type Quality = "high" | "medium" | "low";

export const QUALITIES: readonly Quality[] = ["high", "medium", "low"];

/** Where the choice is kept: "high", "medium" or "low"; unset is the device's default (`defaultQuality`). */
export const QUALITY_KEY = "bymr.quality";
/** Set once the player turned music on while on Medium: it is not held off again. */
export const MEDIUM_MUSIC_KEY = "bymr.quality.mediumMusic";

/** How much longer the map rooms wait between asks on Low. */
export const LOW_MAP_REFRESH_FACTOR = 3;

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const isQuality = (value: unknown): value is Quality => value === "high" || value === "medium" || value === "low";

/**
 * A choice that could not be written down (site data blocked): it holds for
 * this page load, so `?quality=low` still rescues such a browser.
 */
let unsavedChoice: Quality | null = null;

/** The Quality the player chose, or null while they never have. */
export const qualityChoice = (store: Storage | null = storage()): Quality | null => {
  try {
    const value = store?.getItem(QUALITY_KEY);
    return isQuality(value) ? value : unsavedChoice;
  } catch {
    return unsavedChoice;
  }
};

/**
 * The biggest picture this device's graphics card can hold, in pixels a side,
 * once a renderer has said (`gpuTextureLimit` in `textureLimit.ts`) or the
 * default Quality's probe has asked (`readDeviceHints`); null until then. Many phones and older PCs hold 4096 or 8192, and WebGL
 * refuses anything bigger: the monster would not be drawn.
 */
let textureLimit: number | null = null;

export const deviceTextureLimit = (): number | null => textureLimit;

/** Remembers the device's texture limit; null forgets it (tests). */
export const setDeviceTextureLimit = (size: number | null): void => {
  textureLimit = size !== null && Number.isFinite(size) && size > 0 ? size : null;
};

/** What the device says about itself, for {@link defaultQuality}; null where it does not say. */
export interface DeviceHints {
  /** `navigator.deviceMemory` in GB (Chrome and Edge; Safari and Firefox do not say). */
  readonly memoryGb: number | null;
  /** The graphics card's `MAX_TEXTURE_SIZE`, in pixels a side. */
  readonly textureLimit: number | null;
  /** Whether it is a phone or a tablet (`isTouchDevice`). */
  readonly touch?: boolean;
  /** Whether WebGL draws in software, with no graphics card (`isSoftwareRenderer`). */
  readonly software?: boolean;
}

/** At or under this much memory (GB) a device starts on Medium. */
export const LOW_MEMORY_GB = 4;
/** At or under this texture limit a device starts on Medium (iPhones do not report memory). */
export const LOW_TEXTURE_LIMIT = 4096;

/**
 * The Quality a player who never chose starts on (owner, 17 Nov 2026):
 * Low where WebGL draws in software, with no graphics card (beta 9);
 * Medium on a device with 4 GB of memory or less, or a graphics card that
 * holds 4096 px a side or less, or on any phone or tablet (patch 7.11:
 * iPhones report neither, and iOS closed the tab on the High sheets); High
 * otherwise, and where the device says nothing. Never written down, so the
 * same player on a desktop later still gets High.
 */
export const defaultQuality = (hints: DeviceHints): Quality =>
  hints.software === true
    ? "low"
    : hints.touch === true ||
        (hints.memoryGb !== null && hints.memoryGb <= LOW_MEMORY_GB) ||
        (hints.textureLimit !== null && hints.textureLimit <= LOW_TEXTURE_LIMIT)
      ? "medium"
      : "high";

/** `navigator.deviceMemory`, or null where the browser does not say. */
export const deviceMemoryGb = (nav: unknown = typeof navigator === "undefined" ? undefined : navigator): number | null => {
  try {
    const memory = (nav as { deviceMemory?: unknown } | undefined)?.deviceMemory;
    return typeof memory === "number" && Number.isFinite(memory) && memory > 0 ? memory : null;
  } catch {
    return null;
  }
};

/**
 * The graphics card's name WebGL gives, unmasked where the browser allows;
 * null with nothing to read.
 */
export const readRendererName = (gl: WebGLRenderingContext): string | null => {
  try {
    // Firefox already gives the real (rounded) name here, and warns about the
    // debug extension; Chrome and Safari give "WebKit WebGL" without it.
    const plain = gl.getParameter(gl.RENDERER) as unknown;
    if (typeof plain === "string" && plain !== "" && !/^WebKit WebGL$/i.test(plain)) return plain;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const unmasked = info ? (gl.getParameter(info.UNMASKED_RENDERER_WEBGL) as unknown) : null;
    if (typeof unmasked === "string" && unmasked !== "") return unmasked;
    return typeof plain === "string" && plain !== "" ? plain : null;
  } catch {
    return null;
  }
};

/**
 * Whether a renderer's name is a software one, drawing on the processor with
 * no graphics card: Chrome's SwiftShader, Mesa's llvmpipe, softpipe and
 * lavapipe, Windows' Microsoft Basic Render Driver, Apple's Software Renderer
 * ("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader
 * driver)", "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 ...)").
 */
export const isSoftwareRenderer = (name: string | null): boolean =>
  name !== null && /swiftshader|llvmpipe|softpipe|lavapipe|basic render|software/i.test(name);

/** What a throwaway WebGL context says: its texture limit and renderer name, null where it does not say. */
export interface GraphicsProbe {
  readonly textureLimit: number | null;
  readonly renderer: string | null;
}

/**
 * Asks a throwaway WebGL context (WebGL 2, else 1, as `app/graphicsOff.ts`
 * does) for the graphics card's texture limit and name, and lets it go at
 * once so it does not hold one of the browser's few WebGL slots. Nulls with
 * no WebGL.
 */
export const probeGraphics = (
  makeCanvas: () => HTMLCanvasElement | null = () => (typeof document === "undefined" ? null : document.createElement("canvas")),
): GraphicsProbe => {
  const none: GraphicsProbe = { textureLimit: null, renderer: null };
  try {
    const canvas = makeCanvas();
    if (!canvas) return none;
    const gl =
      (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) return none;
    const size: unknown = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const renderer = readRendererName(gl);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { textureLimit: typeof size === "number" && Number.isFinite(size) && size > 0 ? size : null, renderer };
  } catch {
    return none;
  }
};

/** The graphics card's texture limit, from a throwaway context ({@link probeGraphics}). Null with no WebGL. */
export const probeTextureLimit = (makeCanvas?: () => HTMLCanvasElement | null): number | null =>
  probeGraphics(makeCanvas).textureLimit;

/**
 * This device's hints. One throwaway context (`probeGraphics`) names the
 * renderer, so a PC with no graphics card is known, low on memory or not (a
 * phone or tablet low on memory is not probed, as before). The texture limit is the renderer's when it has already said
 * (`gpuTextureLimit`), else the throwaway context's, kept as the device's
 * limit so the first sheets fetched step down too (`sheetForDevice`): a phone
 * or tablet is on Medium either way, but an old one's small limit must be
 * known before its first sheets are picked.
 */
export const readDeviceHints = (probe: () => GraphicsProbe = probeGraphics): DeviceHints => {
  const memoryGb = deviceMemoryGb();
  const touch = isTouchDevice();
  // A phone or tablet low on memory is on Medium already and draws on its own
  // graphics chip: it is spared the throwaway context, as before beta 9.
  if (touch && memoryGb !== null && memoryGb <= LOW_MEMORY_GB) return { memoryGb, textureLimit: deviceTextureLimit(), touch };
  const probed = probe();
  let limit = deviceTextureLimit();
  if (limit === null && probed.textureLimit !== null) {
    limit = probed.textureLimit;
    setDeviceTextureLimit(limit);
  }
  return { memoryGb, textureLimit: limit, touch, software: isSoftwareRenderer(probed.renderer) };
};

/** The device's default, decided once a page load (`readDeviceHints` probes at most once). */
let deviceDefault: Quality | null = null;

/** {@link defaultQuality} for this device, decided at its first use and kept for the page load. */
export const deviceDefaultQuality = (): Quality => (deviceDefault ??= defaultQuality(readDeviceHints()));

/** Forgets the device's default, or sets it (tests). */
export const setDeviceDefaultQuality = (level: Quality | null): void => {
  deviceDefault = level;
};

/**
 * The Quality in use: the player's choice, else the device's default
 * ({@link defaultQuality}); and never above safe mode's cap, while there is
 * one (`safeMode.ts`).
 */
export const quality = (store: Storage | null = storage(), fallback: () => Quality = deviceDefaultQuality): Quality =>
  lowerQuality(qualityChoice(store) ?? fallback(), safeModeCap(store));

const listeners = new Set<(level: Quality) => void>();

/** Calls `listener` whenever the player picks a level; returns the unsubscribe. */
export const onQualityChange = (listener: (level: Quality) => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * The player picks a level (Settings, "Use Low", `?quality=`). It also ends
 * safe mode: the cap goes, and its count starts afresh.
 */
export const setQuality = (level: Quality, store: Storage | null = storage()): void => {
  try {
    if (!store) throw new Error("no storage");
    store.setItem(QUALITY_KEY, level);
    unsavedChoice = null;
  } catch {
    // Site data blocked: nothing to remember it by, so it holds for this page load only.
    unsavedChoice = level;
  }
  clearSafeMode(store);
  for (const listener of listeners) listener(level);
};

/**
 * The Quality copies of a painted sheet, or null for a sheet that is not a big
 * painting (no `@2x` or more in its name). Medium is the `@2x` copy of a sheet
 * painted at 3x or 4x; Korath 5 and 6 are painted at only 2x, as any more would
 * pass the 8192 px many graphics cards cannot hold, so theirs is the `@1.5x`
 * copy. Low is always the 1x copy, the size Flash drew it.
 */
export const sheetCopies = (file: string): { medium: string; low: string } | null => {
  const painted = /@(\d+)x(\.\w+)$/.exec(file);
  const scale = Number(painted?.[1] ?? 0);
  if (!painted || scale < 2) return null;
  const name = file.slice(0, painted.index);
  const ext = painted[2] ?? "";
  return { medium: `${name}@${scale >= 3 ? 2 : 1.5}x${ext}`, low: `${name}${ext}` };
};

/**
 * The copy of a painted sheet to download: `monsters/pokey-anim@4x.png` as it
 * is on High, `monsters/pokey-anim@2x.png` on Medium, `monsters/pokey-anim.png`
 * on Low (`sheetCopies`). A sheet that is not a big painting is left alone.
 */
export const sheetAtQuality = (file: string, level: Quality = quality()): string => {
  const copies = level === "high" ? null : sheetCopies(file);
  if (!copies) return file;
  return level === "medium" ? copies.medium : copies.low;
};

/**
 * The level monster and champion sheets are drawn from: the Quality in use,
 * but never above Medium on a phone or tablet (patch 7.11). A `@4x` sheet is
 * four times the memory of its `@2x` copy, a phone's screen shows no
 * difference, and a yard of them made iOS close the tab.
 */
export const monsterSheetLevel = (level: Quality = quality(), touch: boolean = isTouchDevice()): Quality =>
  touch && level === "high" ? "medium" : level;

/** The resolution a sheet file names (`@4x`, `@1.5x`), as Pixi reads it; 1 without one. */
export const sheetResolution = (file: string): number => Number(/@(\d+(?:\.\d+)?)x\./.exec(file)?.[1] ?? 1);

/**
 * `sheetAtQuality`, stepping down to a smaller copy when the one asked for is
 * bigger than the graphics card can hold (`limit`): a `@4x` painting 9,000 px
 * wide on a card that holds 8192 is fetched as its `@2x` copy, so the phone
 * never downloads and decodes the big one. `size` is the sheet's 1x size (its
 * table row, with any repaint layout). When even the 1x copy is too big, or the
 * limit is not known yet, the copy asked for (or the 1x) is returned and the
 * sheet cutter copes (`MonsterSheetTextures`).
 */
export const sheetForDevice = (
  file: string,
  size: { readonly width: number; readonly height: number },
  limit: number | null = deviceTextureLimit(),
  level: Quality = quality(),
  touch: boolean = isTouchDevice(),
): string => {
  const chosen = sheetAtQuality(file, level);
  const copies = sheetCopies(file);
  if (!copies) return chosen;
  const fitted = limit === null ? chosen : fittedCopy(file, copies, chosen, size, limit);
  // A sheet too heavy for a small device at its `@2x` (beta 9): its 1x copy instead.
  const small = touch || (limit !== null && limit <= LOW_TEXTURE_LIMIT);
  return small && fitted === copies.medium && SMALL_DEVICE_1X_SHEETS.has(file) ? copies.low : fitted;
};

/** The biggest copy, from `chosen` down, that fits a card holding `limit` px a side; else the 1x. */
const fittedCopy = (
  file: string,
  copies: { readonly medium: string; readonly low: string },
  chosen: string,
  size: { readonly width: number; readonly height: number },
  limit: number,
): string => {
  const ladder = [file, copies.medium, copies.low];
  for (const copy of ladder.slice(ladder.indexOf(chosen))) {
    const scale = sheetResolution(copy);
    if (size.width * scale <= limit && size.height * scale <= limit) return copy;
  }
  return copies.low;
};

/**
 * Painted sheets a phone, a tablet or a card that holds 4096 px or less draws
 * from their 1x copy even where the `@2x` would fit (beta 9, owner 21 Nov
 * 2026, card b9-speed-picks): Fomor level 6's `@2x` is 3968 x 1470, about
 * 30 MB of graphics memory with its mipmaps for one monster, and its 1x copy
 * (375 KB) looks the same at a phone's zoom. The owner added the four
 * heaviest `@2x` sheets (pick "merge-plus4"), each a quarter of the memory as
 * its 1x copy (sizes without mipmaps): Korath 3 (4096 x 3672, 57 MB), Korath 2
 * (3808 x 2754, 40 MB), Drull 3 (3648 x 2550, 36 MB) and Gorgo 3
 * (3296 x 2640, 33 MB). By the painted file's name.
 */
export const SMALL_DEVICE_1X_SHEETS: ReadonlySet<string> = new Set([
  "monsters/fly_6-repaint@4x.png",
  "monsters/korath_3-repaint@4x.png",
  "monsters/korath_2-repaint@4x.png",
  "monsters/dragon_3-repaint@4x.png",
  "monsters/ape_3-repaint@4x.png",
]);

/** Whether the yard tune is the lighter copy (Medium and Low). */
export const lightMusic = (level: Quality = quality()): boolean => level !== "high";

/**
 * Whether the music waits, off, until the player turns it on: every visit on
 * Low; on Medium until they have once turned it on in this browser. Only on a
 * level the player chose (owner, 17 Nov 2026): a player put on Medium by the
 * device's default ({@link defaultQuality}) hears the music as on High, in
 * its lighter copy ({@link lightMusic}).
 */
export const musicHeld = (level: Quality = quality(), store: Storage | null = storage()): boolean => {
  if (qualityChoice(store) !== level) return false;
  if (level === "low") return true;
  if (level !== "medium") return false;
  try {
    return store?.getItem(MEDIUM_MUSIC_KEY) !== "1";
  } catch {
    return true;
  }
};

/** The player turned music on: on Medium, it is not held off again in this browser. */
export const noteMusicTurnedOn = (level: Quality = quality(), store: Storage | null = storage()): void => {
  if (level !== "medium") return;
  try {
    store?.setItem(MEDIUM_MUSIC_KEY, "1");
  } catch {
    // Site data blocked: the music waits again next visit.
  }
};

/** How long a map room waits before asking the server again: `normal`, or three times it on Low. */
export const mapRefreshSeconds = (normal: number, level: Quality = quality()): number =>
  level === "low" ? normal * LOW_MAP_REFRESH_FACTOR : normal;
