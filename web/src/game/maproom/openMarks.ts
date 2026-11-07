import {
  browserOf,
  buildSummary,
  compactRecord,
  shaderName,
  summaryLine,
  summaryRows,
  type CompactRecord,
  type FinishReason,
  type InfoValue,
  type OpenState,
  type OpenSummary,
  type OpenType,
  type ResourceSample,
} from "./openTimingSummary";

/**
 * Timing of every step of opening Map Room 2 (the owner's slow-open report, 4 Nov 2026; "measure
 * first", 7 Nov 2026), so an open can be timed in any browser, dev or built, on our PCs and on
 * players' machines.
 *
 * - Each step is a `performance` mark named `mr2-<step>` (the first time only), and each step that
 *   takes time a measure named `mr2:<step>`, so they show in the browser's Performance panel and in
 *   `performance.getEntriesByType("mark")`. Each open clears the last open's.
 * - When the open is over (zones in view answered, a frame drawn, and the painted look at the
 *   player's Quality with its art, when it is on), one console line and a table are printed and the
 *   summary is kept on `window.__mr2Timing` (`last`, `history`, `record`, `current()`).
 * - {@link setOpenTimingSender} takes one compact record per open type (first, later) per page load.
 *
 * Nothing here may break the map: every browser call is guarded.
 */
export const MR2_OPEN = "mr2-open";
/** The painted look first shows (its Low program, or the player's own when already compiled). */
export const MR2_PAINTED = "mr2-painted";
/** The ground draws with the player's own Quality's program. */
export const MR2_FULL_LOOK = "mr2-full-look";
/** The own yard answered and the camera is on the home cell. */
export const MR2_OWN_CELL = "mr2-own-cell";
/** getarea requests may go (the own yard answered, or failed). */
export const MR2_READY = "mr2-ready";
/** The first frame the scene drew, and the first with any zone in it. */
export const MR2_FIRST_FRAME = "mr2-first-frame";
export const MR2_FIRST_ZONE_FRAME = "mr2-first-zone-frame";
export const MR2_AREA_FIRST_SENT = "mr2-area-first-sent";
export const MR2_AREA_FIRST_ANSWER = "mr2-area-first-answer";
/** The zones round the view's centre when fetching began (up to 3 x 3, those in view) all answered. */
export const MR2_CENTRE_ZONES = "mr2-centre-zones";
/** Every zone in view answered (or known to be all fog). */
export const MR2_VIEW_ZONES = "mr2-view-zones";
/** The painted look's code arrived (`import("./painted/paintedLook")`). */
export const MR2_PAINTED_CODE = "mr2-painted-code";
/** The painted look's art files (ground, sprites, cliffs, clouds) all arrived. */
export const MR2_PAINTED_ART = "mr2-painted-art";
/** The painted look will not show this open (no WebGL2, code not arriving, shader not linking). */
export const MR2_PAINTED_FAILED = "mr2-painted-failed";

/** After this long an open is summarised with what it has. */
export const OPEN_TIMEOUT_MS = 120_000;
/** Summaries kept on `window.__mr2Timing.history`. */
const HISTORY_MAX = 10;
const PREFIX = "mr2-";
const SPAN_PREFIX = "mr2:";

let opens = 0;
let current: OpenState | null = null;
let finished = true;
let timeout: ReturnType<typeof setTimeout> | null = null;
let observer: PerformanceObserver | null = null;
let gpu: string | null | undefined;
const history: OpenSummary[] = [];
let lastRecord: CompactRecord | null = null;
let sender: ((record: CompactRecord) => void) | null = null;
const sent = new Set<OpenType>();

const now = (): number => performance.now();

const safely = (run: () => void): void => {
  try {
    run();
  } catch {
    // Timing must never break the map.
  }
};

const since = (state: OpenState, at: number): number => at - state.startedAt;

/** The open still collecting, or null. */
const collecting = (): OpenState | null => (finished ? null : current);

const publish = (): void => {
  safely(() => {
    (globalThis as Record<string, unknown>)["__mr2Timing"] = {
      last: history[history.length - 1] ?? null,
      history: [...history],
      record: lastRecord,
      /** The open in progress, as a summary so far. */
      current: () => (current && !finished ? buildSummary(current, "left", since(current, now())) : null),
    };
  });
};

const clearEntries = (): void => {
  safely(() => {
    for (const entry of performance.getEntriesByType("mark")) if (entry.name.startsWith(PREFIX)) performance.clearMarks(entry.name);
    for (const entry of performance.getEntriesByType("measure")) {
      if (entry.name.startsWith(SPAN_PREFIX)) performance.clearMeasures(entry.name);
    }
  });
};

const sampleOf = (state: OpenState, entry: PerformanceResourceTiming): ResourceSample => ({
  name: entry.name,
  start: since(state, entry.startTime),
  responseEnd: since(state, entry.responseEnd),
  transferSize: entry.transferSize ?? 0,
  decodedBodySize: entry.decodedBodySize ?? 0,
});

/** Watches the page's downloads during the open (an observer sees them even when the buffer is full). */
const watchResources = (state: OpenState): void => {
  observer?.disconnect();
  observer = null;
  if (typeof PerformanceObserver === "undefined") return;
  safely(() => {
    const watcher = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.resources.push(sampleOf(state, entry as PerformanceResourceTiming));
    });
    watcher.observe({ type: "resource" });
    observer = watcher;
  });
};

const baseInfo = (): Record<string, InfoValue> => {
  const info: Record<string, InfoValue> = {};
  safely(() => {
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string } };
    info["browser"] = browserOf(nav.userAgent ?? "");
    info["cores"] = nav.hardwareConcurrency ?? null;
    info["memoryGb"] = nav.deviceMemory ?? null;
    info["network"] = nav.connection?.effectiveType ?? null;
  });
  safely(() => {
    info["viewport"] = `${window.innerWidth}x${window.innerHeight}`;
    info["dpr"] = window.devicePixelRatio;
  });
  if (gpu !== undefined) info["gpu"] = gpu;
  return info;
};

/** When the open's last wanted step arrived, or null while it has not. */
export const doneAt = (state: OpenState): number | null => {
  const { steps, info } = state;
  if (info["painted"] === undefined) return null;
  const wanted = ["view-zones", "first-frame"];
  if (info["painted"] === true && !("painted-failed" in steps)) wanted.push("full-look", "painted-art");
  let last = 0;
  for (const step of wanted) {
    const at = steps[step];
    if (at === undefined) return null;
    last = Math.max(last, at);
  }
  return last;
};

/**
 * Ends the open: the console line and table, `window.__mr2Timing`, and the record for the sender.
 * Called on its own when the open is done or times out, and by the scene when the player leaves.
 */
export const finishOpen = (reason: FinishReason, totalMs?: number): OpenSummary | null => {
  const state = collecting();
  if (!state) return null;
  finished = true;
  if (timeout !== null) clearTimeout(timeout);
  timeout = null;
  safely(() => {
    for (const entry of observer?.takeRecords() ?? []) state.resources.push(sampleOf(state, entry as PerformanceResourceTiming));
  });
  observer?.disconnect();
  observer = null;
  const summary = buildSummary(state, reason, totalMs ?? since(state, now()));
  history.push(summary);
  if (history.length > HISTORY_MAX) history.shift();
  const record = compactRecord(summary);
  lastRecord = record;
  safely(() => {
    // The open's summary is printed on purpose, for testers and players' bug reports.
    // eslint-disable-next-line no-console
    console.info(summaryLine(summary));
    // eslint-disable-next-line no-console
    console.table(summaryRows(summary));
  });
  publish();
  if (sender && !sent.has(summary.type)) {
    sent.add(summary.type);
    const send = sender;
    safely(() => send(record));
  }
  return summary;
};

const checkDone = (): void => {
  const state = collecting();
  if (!state) return;
  const at = doneAt(state);
  if (at !== null) finishOpen("done", at);
};

/** Marks the start of an open, forgetting the last one's marks (and summarising it if it never ended). */
export const markOpen = (info: Record<string, InfoValue> = {}): void => {
  finishOpen("left");
  clearEntries();
  opens += 1;
  const state: OpenState = {
    index: opens,
    startedAt: now(),
    steps: { open: 0 },
    spans: [],
    area: { calls: 0, answered: 0, failed: 0, totalMs: 0, maxMs: 0 },
    art: [],
    cuts: [],
    shaders: [],
    info: { ...baseInfo(), ...info },
    resources: [],
  };
  current = state;
  finished = false;
  watchResources(state);
  safely(() => performance.mark(MR2_OPEN));
  if (timeout !== null) clearTimeout(timeout);
  timeout = setTimeout(() => finishOpen("timeout"), OPEN_TIMEOUT_MS);
  publish();
};

/** Marks a step of this open, the first time only. */
export const markOnce = (name: string): void => {
  const state = collecting();
  if (!state) return;
  const step = name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name;
  if (step in state.steps) return;
  state.steps[step] = since(state, now());
  safely(() => performance.mark(`${PREFIX}${step}`));
  checkDone();
};

/** Whether this open has reached a step. */
export const hasMark = (name: string): boolean => {
  const step = name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name;
  return current !== null && step in current.steps;
};

/** Notes a fact about this open (Quality, painted on, where the own yard came from...). */
export const noteInfo = (key: string, value: InfoValue): void => {
  const state = collecting();
  if (!state) return;
  state.info[key] = value;
  if (key === "painted") checkDone();
};

const measure = (name: string, start: number, end: number): void => {
  safely(() => performance.measure(`${SPAN_PREFIX}${name}`, { start, end }));
};

/** Times something the open waits on (or starts and leaves running). Returns what it returns. */
export const timeSpan = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
  const state = collecting();
  if (!state) return run();
  const startAbs = now();
  const span = { name, start: since(state, startAbs), end: null as number | null, ok: false };
  state.spans.push(span);
  try {
    const result = await run();
    span.ok = true;
    return result;
  } finally {
    const endAbs = now();
    span.end = since(state, endAbs);
    measure(name, startAbs, endAbs);
  }
};

/** Times a step that runs on the spot (the atlas bake). */
export const timeSync = <T>(name: string, run: () => T): T => {
  const state = collecting();
  if (!state) return run();
  const startAbs = now();
  const span = { name, start: since(state, startAbs), end: null as number | null, ok: false };
  state.spans.push(span);
  try {
    const result = run();
    span.ok = true;
    return result;
  } finally {
    const endAbs = now();
    span.end = since(state, endAbs);
    measure(name, startAbs, endAbs);
  }
};

/** Times one getarea call: how many, how long, the first sent and answered. */
export const timeArea = async <T>(run: () => Promise<T>): Promise<T> => {
  const state = collecting();
  if (!state) return run();
  state.area.calls += 1;
  markOnce(MR2_AREA_FIRST_SENT);
  const start = now();
  try {
    const result = await run();
    const took = now() - start;
    state.area.answered += 1;
    state.area.totalMs += took;
    state.area.maxMs = Math.max(state.area.maxMs, took);
    if (state === current) markOnce(MR2_AREA_FIRST_ANSWER);
    return result;
  } catch (caught) {
    state.area.failed += 1;
    throw caught;
  }
};

/** Times one art file's `Assets.load` (download and decode). */
export const timeArt = async <T>(url: string, load: () => Promise<T>): Promise<T> => {
  const state = collecting();
  if (!state) return load();
  const startAbs = now();
  const entry = { url, start: since(state, startAbs), end: null as number | null, ok: false };
  state.art.push(entry);
  try {
    const result = await load();
    entry.ok = true;
    return result;
  } finally {
    const endAbs = now();
    entry.end = since(state, endAbs);
    measure(`art ${url.slice(url.lastIndexOf("/") + 1)}`, startAbs, endAbs);
  }
};

/** Times main-thread canvas cutting after an art file arrived. */
export const timeCut = <T>(name: string, run: () => T): T => {
  const state = collecting();
  if (!state) return run();
  const start = now();
  try {
    return run();
  } finally {
    state.cuts.push({ name, ms: now() - start });
  }
};

/** Notes one shader compile (absolute `performance.now()` times). */
export const noteShader = (
  source: { readonly vertex?: string; readonly fragment?: string },
  requested: number,
  start: number,
  end: number,
  ok: boolean,
): void => {
  const state = collecting();
  if (!state) return;
  const name = shaderName(source);
  // A compile the yard's warm-up started before this open (`mr2Prewarm.ts`) counts from the open:
  // the time this open spent on it.
  const from = (at: number): number => Math.max(0, since(state, at));
  state.shaders.push({ name, requested: from(requested), start: from(start), end: from(end), ok });
  measure(`shader ${name}`, Math.max(start, state.startedAt), end);
};

/** The GPU's name (WebGL's unmasked renderer where the browser gives it), read once per page. */
export const noteGpu = (gl: WebGLRenderingContext | WebGL2RenderingContext | null | undefined): void => {
  if (gpu === undefined && gl) {
    safely(() => {
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      const name: unknown = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      gpu = typeof name === "string" ? name : null;
    });
  }
  const state = collecting();
  if (state && gpu !== undefined) state.info["gpu"] = gpu;
};

/** Takes one compact record per open type (first, later) per page load, for players' numbers. */
export const setOpenTimingSender = (send: ((record: CompactRecord) => void) | null): void => {
  sender = send;
};

/** Forgets everything (tests). */
export const resetOpenTiming = (): void => {
  if (timeout !== null) clearTimeout(timeout);
  timeout = null;
  observer?.disconnect();
  observer = null;
  opens = 0;
  current = null;
  finished = true;
  gpu = undefined;
  history.length = 0;
  lastRecord = null;
  sender = null;
  sent.clear();
};
