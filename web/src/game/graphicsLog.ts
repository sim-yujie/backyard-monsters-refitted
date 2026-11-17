import type { Renderer } from "pixi.js";
import { reportCaughtError } from "@/game/bugReport/errorReporter";
import { deviceMemoryGb, deviceTextureLimit, quality, qualityChoice, type Quality } from "@/game/quality";

/**
 * Graphics problems, sent to the owner's dashboard with the game's other
 * browser errors (`bugReport/errorReporter.ts`, table `bym.app_error`), so
 * there is real data on which phones and which pictures go wrong (owner,
 * 17 Nov 2026: old phones drew some monsters as green squares).
 *
 * What is sent: the WebGL context lost or restored, a picture (monster
 * sheet, building art) that did not load or decode, and a picture still over
 * the graphics card's texture limit, cut through a canvas or not cuttable at
 * all. Each entry is one line of text, with the device's graphics details
 * ({@link GraphicsDevice}) after it. Pixi uploads pictures without asking
 * WebGL for errors, so an upload error on its own is not seen; on a phone it
 * usually ends in a lost context, which is.
 *
 * Kept small: one entry per kind per picture per page load, at most
 * {@link LOAD_MAX} a page load and {@link SESSION_MAX} a browser tab
 * session (a handled over-limit picture has its own, smaller budget,
 * {@link HANDLED_LOAD_MAX}), on top of the error reporter's own batch caps.
 */

export type GraphicsProblem = "context-lost" | "context-restored" | "sheet-failed" | "sheet-over-limit" | "sheet-cut-failed";

const PROBLEM_WORDS: Record<GraphicsProblem, string> = {
  "context-lost": "WebGL context lost",
  "context-restored": "WebGL context restored",
  "sheet-failed": "picture did not load",
  "sheet-over-limit": "picture over the texture limit, cut through a canvas",
  "sheet-cut-failed": "picture over the texture limit, could not be cut",
};

/** Entries one page load may send. */
export const LOAD_MAX = 8;
/** Entries one browser tab may send, across reloads. */
export const SESSION_MAX = 20;
/** Where the tab's count is kept (`sessionStorage`). */
export const SESSION_KEY = "bymr.graphicsLog.sent";
/**
 * A picture over the limit that was cut through a canvas is handled, and a
 * 4096 phone meets several at every yard (the 3D towers' turret strips), so
 * these have a budget of their own and never use up the one for real
 * failures: one a page load, three a tab session.
 */
export const HANDLED_LOAD_MAX = 1;
export const HANDLED_SESSION_MAX = 3;
export const HANDLED_SESSION_KEY = "bymr.graphicsLog.handled";

const SUBJECT_MAX = 80;
const DETAIL_MAX = 100;
const GPU_MAX = 100;
const AGENT_MAX = 60;
/** What the server keeps of a message (`ERROR_TEXT_LIMITS.messageMax`). */
const MESSAGE_MAX = 500;

/** The device's graphics details each entry carries. */
export interface GraphicsDevice {
  /** The graphics card's name as WebGL gives it (unmasked where the browser allows). */
  readonly gpu: string | null;
  /** `MAX_TEXTURE_SIZE`, in pixels a side. */
  readonly maxTexture: number | null;
  /** `navigator.deviceMemory`, in GB. */
  readonly memoryGb: number | null;
  readonly quality: Quality;
  /** Whether the player picked the Quality (false: the device's default). */
  readonly qualityChosen: boolean;
  readonly dpr: number | null;
  /** The screen in CSS pixels. */
  readonly screen: { readonly width: number; readonly height: number } | null;
  /** The system and browser, short ({@link shortAgent}). */
  readonly agent: string;
}

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** One line, without the page's own address. */
const tidy = (text: string): string => text.replace(/https?:\/\/[^\s/]+/gi, "").replace(/\s+/g, " ").trim();

/**
 * A picture's name for an entry: its last two path parts, without address or
 * query, and the copy apart: `monsters/krallen_1_rev_65-repaint@2x.png` is
 * `monsters/krallen_1_rev_65-repaint.png (@2x)`, the 1x copy `(1x)`. Written
 * as one word, the server takes `name@2x.png` for an email address and
 * blanks it (`errorText.ts`).
 */
export const pictureName = (url: string | null | undefined): string => {
  if (!url) return "";
  const path = url.replace(/^[a-z]+:\/\/[^/]+/i, "").replace(/[?#].*$/, "");
  const name = path.split("/").filter(Boolean).slice(-2).join("/");
  const copy = /@(\d+(?:\.\d+)?x)(\.\w+)$/.exec(name);
  if (copy) return `${name.slice(0, copy.index)}${copy[2]} (@${copy[1]})`;
  return /\.(?:png|webp|jpe?g|avif|gif)$/i.test(name) ? `${name} (1x)` : name;
};

/**
 * An error's words for an entry: `Name: message`, or for Pixi's wrapped
 * loader errors only the cause (their last line, which names its own error),
 * with every address left out as `(url)`: the picture is named apart, and
 * `name@2x.png` in an address would be blanked as an email.
 */
export const errorWords = (error: unknown): string => {
  let words: string;
  if (error instanceof Error) {
    const lines = error.message.split("\n").filter((line) => line.trim() !== "" && !/^\s+at\s/.test(line));
    words = lines.length > 1 ? lines[lines.length - 1]! : `${error.name}: ${error.message}`;
  }
  else if (typeof error === "string") words = error;
  else if (error && typeof error === "object" && "type" in error) words = `${String((error as { type: unknown }).type)} event`;
  else words = String(error);
  return clip(tidy(words.replace(/(?:https?:\/\/|\/)\S*\.(?:png|webp|jpe?g|avif|gif|json)\S*?(?=:?\s|[.:]?$)|https?:\/\/\S+?(?=:?\s|[.:]?$)/gi, "(url)")), DETAIL_MAX);
};

/**
 * The system and browser in a few words (`Android 11 SM-A105F, Chrome 120`,
 * `iPhone iOS 15.8, Safari 15`): only major versions, as the server takes a
 * dotted four-number version for an address and blanks it.
 */
export const shortAgent = (ua: string): string => {
  let system = "";
  const apple = /\b(iPhone|iPad|iPod)\b.*?\bOS (\d+)[_.](\d+)/.exec(ua);
  const android = /\bAndroid (\d+(?:\.\d+)?)(?:; ([^;)]+))?/.exec(ua);
  if (apple) system = `${apple[1]} iOS ${apple[2]}.${apple[3]}`;
  else if (android) {
    const model = android[2]?.trim() ?? "";
    system = `Android ${android[1]}${model && model !== "K" && !/^(?:wv|Linux|U)$/.test(model) ? ` ${model}` : ""}`;
  } else if (/\bCrOS\b/.test(ua)) system = "ChromeOS";
  else if (/\bWindows\b/.test(ua)) system = "Windows";
  else if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) system = "Mac";
  else if (/\bLinux\b/.test(ua)) system = "Linux";

  const browsers: [RegExp, string][] = [
    [/\bSamsungBrowser\/(\d+)/, "Samsung Internet"],
    [/\bEdg(?:A|iOS)?\/(\d+)/, "Edge"],
    [/\bOPR\/(\d+)/, "Opera"],
    [/\b(?:Firefox|FxiOS)\/(\d+)/, "Firefox"],
    [/\bCriOS\/(\d+)/, "Chrome"],
    [/\bChrome\/(\d+)/, "Chrome"],
    [/\bVersion\/(\d+)(?:\.\d+)*.*\bSafari\//, "Safari"],
  ];
  let browser = "";
  for (const [pattern, name] of browsers) {
    const found = pattern.exec(ua);
    if (found) {
      browser = `${name} ${found[1]}`;
      break;
    }
  }
  return clip([system, browser].filter(Boolean).join(", ") || "unknown", AGENT_MAX);
};

/* ── The device ─────────────────────────────────────────────────────────── */

let gpuName: string | null = null;

/** The graphics card's name WebGL gives, unmasked where the browser allows; null with nothing to read. */
export const readGpuName = (gl: WebGLRenderingContext): string | null => {
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

/** This device's graphics details, as they are now. */
export const graphicsDevice = (): GraphicsDevice => {
  const screenSize =
    typeof screen === "undefined" || !screen ? null : { width: Math.round(screen.width), height: Math.round(screen.height) };
  return {
    gpu: gpuName,
    maxTexture: deviceTextureLimit(),
    memoryGb: deviceMemoryGb(),
    quality: quality(),
    qualityChosen: qualityChoice() !== null,
    dpr: typeof devicePixelRatio === "number" ? devicePixelRatio : null,
    screen: screenSize,
    agent: shortAgent(typeof navigator === "undefined" ? "" : navigator.userAgent ?? ""),
  };
};

const round2 = (value: number): string => String(Math.round(value * 100) / 100);

/**
 * One entry's text, the most telling first, as the server keeps 500
 * characters of it:
 * `Graphics: picture did not load: monsters/krallen_1_rev_65-repaint.png (@2x) (Error: …) | gpu Mali-G52 MC2 | max texture 4096 | memory 2 GB | quality medium (default) | dpr 2.75 | screen 393x873 | Android 11, Chrome 120`.
 * The server makes one row per kind of text with its numbers aside, so the
 * rows split by kind, picture, graphics card, Quality and system, and count
 * the devices that differ only in numbers together.
 */
export const graphicsMessage = (kind: GraphicsProblem, subject: string, detail: string, device: GraphicsDevice): string => {
  const head = [`Graphics: ${PROBLEM_WORDS[kind]}`, subject ? clip(tidy(subject), SUBJECT_MAX) : ""].filter(Boolean).join(": ");
  const what = detail ? `${head} (${clip(tidy(detail), DETAIL_MAX)})` : head;
  const line = [
    what,
    `gpu ${device.gpu ? clip(tidy(device.gpu), GPU_MAX) : "unknown"}`,
    `max texture ${device.maxTexture ?? "unknown"}`,
    `memory ${device.memoryGb === null ? "unknown" : `${round2(device.memoryGb)} GB`}`,
    `quality ${device.quality} (${device.qualityChosen ? "chosen" : "default"})`,
    `dpr ${device.dpr === null ? "unknown" : round2(device.dpr)}`,
    `screen ${device.screen ? `${device.screen.width}x${device.screen.height}` : "unknown"}`,
    clip(device.agent, AGENT_MAX),
  ].join(" | ");
  return clip(line, MESSAGE_MAX);
};

/* ── Throttle ───────────────────────────────────────────────────────────── */

const sessionStore = (): Storage | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
};

/** Lets through one entry per kind per picture, at most `loadMax` a page load and `sessionMax` a tab session. */
export class GraphicsLogThrottle {
  /** Kinds and pictures let through this page load, by budget. */
  private readonly seen = { shared: new Set<string>(), handled: new Set<string>() };

  constructor(
    private readonly loadMax = LOAD_MAX,
    private readonly sessionMax = SESSION_MAX,
    private readonly store: () => Storage | null = sessionStore,
    private readonly handledLoadMax = HANDLED_LOAD_MAX,
    private readonly handledSessionMax = HANDLED_SESSION_MAX,
  ) {}

  allow(kind: GraphicsProblem, subject: string): boolean {
    const handled = kind === "sheet-over-limit";
    const seen = handled ? this.seen.handled : this.seen.shared;
    const loadMax = handled ? this.handledLoadMax : this.loadMax;
    const sessionMax = handled ? this.handledSessionMax : this.sessionMax;
    const sessionKey = handled ? HANDLED_SESSION_KEY : SESSION_KEY;
    const key = `${kind}\n${subject}`;
    if (seen.has(key) || seen.size >= loadMax) return false;
    const store = this.store();
    let sent = 0;
    try {
      sent = Number(store?.getItem(sessionKey) ?? 0) || 0;
    } catch {
      sent = 0;
    }
    if (sent >= sessionMax) return false;
    seen.add(key);
    try {
      store?.setItem(sessionKey, String(sent + 1));
    } catch {
      // Site data blocked: the page load's own cap still holds.
    }
    return true;
  }
}

let throttle = new GraphicsLogThrottle();

/** Starts the page load's count again (tests). */
export const resetGraphicsLog = (next: GraphicsLogThrottle = new GraphicsLogThrottle()): void => {
  throttle = next;
  gpuName = null;
};

/**
 * Sends one graphics problem to the owner's dashboard, unless this kind for
 * this picture was sent already this page load, or the caps are reached.
 * Returns whether it went. Never throws.
 */
export const reportGraphicsProblem = (
  kind: GraphicsProblem,
  subject = "",
  detail = "",
  send: (message: string) => void = reportCaughtError,
  device: () => GraphicsDevice = graphicsDevice,
): boolean => {
  try {
    if (!throttle.allow(kind, subject)) return false;
    send(graphicsMessage(kind, subject, detail, device()));
    return true;
  } catch {
    return false;
  }
};

/* ── The renderer ───────────────────────────────────────────────────────── */

/** How long the page has been open, for a lost context: at the start, or deep into play. */
const timeOnPage = (): string =>
  `after ${Math.round((typeof performance === "undefined" ? 0 : performance.now()) / 1000)} s on the page`;

/**
 * Watches the game's renderer (the one canvas the yard, the fights and the
 * map are all drawn on, `app/App.ts`): reads the graphics card's name for
 * the entries, and sends a lost (and restored) context; WebGPU's lost device
 * too. Returns the function that stops watching.
 */
export const watchGraphics = (
  renderer: Renderer,
  canvas: EventTarget | null = renderer.canvas as unknown as EventTarget,
  report: (kind: GraphicsProblem, subject: string, detail: string) => unknown = reportGraphicsProblem,
): (() => void) => {
  const gl = (renderer as { gl?: WebGLRenderingContext }).gl;
  if (gl) gpuName = readGpuName(gl);
  const onLost = (): void => void report("context-lost", "game canvas", timeOnPage());
  const onRestored = (): void => void report("context-restored", "game canvas", timeOnPage());
  canvas?.addEventListener("webglcontextlost", onLost);
  canvas?.addEventListener("webglcontextrestored", onRestored);
  let watching = true;
  const lost = (renderer as { gpu?: { device?: { lost?: Promise<{ reason?: string; message?: string }> } } }).gpu?.device?.lost;
  void lost?.then((info) => {
    if (watching && info?.reason !== "destroyed") report("context-lost", "game canvas", `WebGPU device lost: ${info?.reason ?? ""} ${info?.message ?? ""}`);
  });
  return () => {
    watching = false;
    canvas?.removeEventListener("webglcontextlost", onLost);
    canvas?.removeEventListener("webglcontextrestored", onRestored);
  };
};
