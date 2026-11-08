import type { Renderer } from "pixi.js";
import type { Quality } from "@/game/quality";

/**
 * Gets Map Room 2 ready while the player is idle in their own yard (MR2 open speed, owner's go,
 * 7 Nov 2026): the painted look's code, its shaders compiled into the game's one renderer, and its
 * pictures in `Assets`' cache. The owner's first open took 15.7 s, 10.7 s of it compiling the
 * ground's High and Low programs; later opens, with all of that already done, took 1.4 s.
 *
 * Rules (the owner's): never compete with the yard's own loading or its requests, so it starts
 * only after the yard has been quiet for a while; follow the player's Quality; do nothing where it
 * would hurt (Low Quality, Classic, no painted look, no WebGL2, a yard without Map Room 2). It runs
 * at most once a page. `bymr.mr2Prewarm = off` in local storage turns it off (for measuring).
 */

/** What decides whether, and how much, to warm up. */
export interface PrewarmFacts {
  readonly level: Quality;
  readonly classic: boolean;
  /** The yard's Map button opens Map Room 2 (or this is an outpost, a Map Room 2 cell). */
  readonly mapRoom2: boolean;
  /** The painted look will show (`paintedSwitch.ts`, the server's `flags.mr2painted`). */
  readonly painted: boolean;
  /** The renderer is WebGL2: the painted look needs it, and the warm-up compiles in it. */
  readonly webGL2: boolean;
  /**
   * The browser compiles shaders in the background (`KHR_parallel_shader_compile`: Chrome, Edge).
   * Without it (Firefox) the warm-up froze the yard for seconds in the owner's test (7 Nov 2026,
   * RTX 3070), so there is no warm-up at all and the map does its own work when it opens.
   */
  readonly parallelCompile: boolean;
  /** The local-storage switch (`MR2_PREWARM_KEY`) said off. */
  readonly switchedOff?: boolean;
}

/** Where a tester can turn the warm-up off in their browser ("off"). */
export const MR2_PREWARM_KEY = "bymr.mr2Prewarm";

/** The Quality to warm for, or null for no warm-up at all. */
export const prewarmLevel = (facts: PrewarmFacts): Quality | null => {
  if (facts.switchedOff || facts.classic || !facts.mapRoom2 || !facts.painted || !facts.webGL2) return null;
  if (!facts.parallelCompile) return null;
  // Low is the player's word that the machine or the line is weak: the map pays its own way there.
  if (facts.level === "low") return null;
  return facts.level;
};

/** Reads the local-storage switch; never throws. */
export const prewarmSwitchedOff = (): boolean => {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(MR2_PREWARM_KEY)?.trim().toLowerCase() === "off";
  } catch {
    return false;
  }
};

/* ── When ─────────────────────────────────────────────────────────────── */

/** How long the yard must have been quiet (no request of its own, no download landing). */
export const QUIET_MS = 5_000;
/** How often the yard is looked at while waiting. */
export const CHECK_MS = 1_000;

export interface IdleWatchOptions {
  /** True while the yard is settled: no request in flight or waiting, the page on screen. */
  readonly settled: () => boolean;
  /** When a download last finished (performance.now() ms), or null for none yet. */
  readonly lastDownloadAt: () => number | null;
  readonly now: () => number;
  /** Runs once the yard has been quiet for `quietMs`. */
  readonly run: () => void;
  readonly quietMs?: number;
  readonly checkMs?: number;
  readonly every?: (callback: () => void, ms: number) => () => void;
}

const defaultEvery = (callback: () => void, ms: number): (() => void) => {
  const id = setInterval(callback, ms);
  return () => clearInterval(id);
};

/**
 * Calls `run` once, the first time the yard has stayed settled with no download landing for
 * `quietMs`. Any unsettled check starts the wait again. Returns a stop function (the yard closed).
 */
export const watchIdle = (options: IdleWatchOptions): (() => void) => {
  const quietMs = options.quietMs ?? QUIET_MS;
  let quietSince: number | null = null;
  let stopped = false;
  const stopTimer = (options.every ?? defaultEvery)(() => {
    if (stopped) return;
    const now = options.now();
    if (!options.settled()) {
      quietSince = null;
      return;
    }
    quietSince ??= now;
    const download = options.lastDownloadAt();
    const quietFrom = Math.max(quietSince, download ?? Number.NEGATIVE_INFINITY);
    if (now - quietFrom < quietMs) return;
    stop();
    options.run();
  }, options.checkMs ?? CHECK_MS);
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    stopTimer();
  };
  return stop;
};

/**
 * A file the yard itself loads (pictures, sounds, code), as opposed to a game request: the
 * periodic calls (presence, mail, chat) would otherwise never let the page look quiet, and the
 * yard's own requests are watched through its store instead.
 */
export const isYardDownload = (url: string): boolean => {
  const path = url.split(/[?#]/)[0] ?? "";
  return /\.(webp|png|jpe?g|gif|svg|mp3|ogg|m4a|wav|js|css|woff2?|json|atlas)$/i.test(path);
};

/** Tracks when the yard's last file download finished, from the browser's resource timing. */
export const watchDownloads = (): { lastAt: () => number | null; stop: () => void } => {
  let last: number | null = null;
  if (typeof PerformanceObserver === "undefined") return { lastAt: () => last, stop: () => {} };
  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (isYardDownload(entry.name)) last = Math.max(last ?? 0, entry.startTime + entry.duration);
      }
    });
    observer.observe({ type: "resource", buffered: true });
  } catch {
    observer = null;
  }
  return { lastAt: () => last, stop: () => observer?.disconnect() };
};

/* ── What ─────────────────────────────────────────────────────────────── */

/** The painted look's warm-up calls (`painted/paintedLook.ts`), injectable for the tests. */
export interface PaintedWarmup {
  warmAhead(renderer: Renderer, gl: WebGL2RenderingContext, level: Quality): Promise<boolean[]>;
  prefetchArt(level: Quality, go: () => boolean): Promise<number>;
}

const loadPaintedLook = (): Promise<PaintedWarmup> => import("./painted/paintedLook");

/** Once a page: a warm-up that started (whatever became of it) is not started again. */
let started = false;
/** For the map's open timing (`info.prewarm`): none, running, done (all of it) or partial. */
let status: "none" | "running" | "done" | "partial" = "none";

/** Whether a warm-up has started on this page. */
export const prewarmStarted = (): boolean => started;

/** Where this page's warm-up is, for Map Room 2's open timing. */
export const prewarmStatus = (): string => status;

/** Forgets that one started (tests). */
export const resetPrewarm = (): void => {
  started = false;
  status = "none";
};

/**
 * Fetches the painted look's code, starts its shaders compiling (no network; the browser compiles
 * them in the background, `shaderWarmup.ts`), then fetches its pictures one at a time while
 * `go()` holds (the yard is still settled and on screen; a map open counts as yes, since the map
 * wants the same pictures). Never throws: anything that fails is simply done by the map, as before.
 */
export const runPrewarm = async (
  renderer: Renderer,
  level: Quality,
  go: () => boolean,
  load: () => Promise<PaintedWarmup> = loadPaintedLook,
): Promise<{ programs: boolean; pictures: number }> => {
  if (started) return { programs: false, pictures: 0 };
  started = true;
  status = "running";
  const result = { programs: false, pictures: 0 };
  try {
    const gl = (renderer as { gl?: WebGL2RenderingContext }).gl;
    if (!gl || gl.isContextLost()) return result;
    const look = await load();
    if (!go()) return result;
    const programs = look.warmAhead(renderer, gl, level).then(
      (linked) => linked.every(Boolean),
      () => false,
    );
    result.pictures = await look.prefetchArt(level, go);
    result.programs = await programs;
  } catch (caught) {
    console.warn("Map Room 2's warm-up stopped; the map does it when it opens.", caught);
  } finally {
    status = result.programs && result.pictures > 0 ? "done" : "partial";
  }
  return result;
};
